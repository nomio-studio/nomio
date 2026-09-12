import {
  BLOCK_TYPE,
  BLOCK_TYPE_ALBEDO,
  BLOCK_TYPE_EMISSION_COLOR,
  BLOCK_TYPE_LIGHT,
} from "./blocks";
import { DEFAULT_LIGHTING, BOUNCE_GAIN, type LightingConfig } from "./config";
import {
  CHUNK_HEIGHT,
  CHUNK_MIN_Y,
  CHUNK_SIZE,
  chunkIndex,
  type ChunkMeshNeighbors,
  type VoxelChunk,
} from "./chunk-types";

/** Chunk plus a one-block border used for neighbor sampling and light bleed. */
export const PADDED_SIZE = CHUNK_SIZE + 2;
const PADDED_VOLUME = PADDED_SIZE * PADDED_SIZE * CHUNK_HEIGHT;

const NEIGHBOR_OFFSETS: readonly [number, number, number][] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

export const paddedIndex = (px: number, py: number, pz: number): number =>
  px + pz * PADDED_SIZE + py * PADDED_SIZE * PADDED_SIZE;

/**
 * Growable integer FIFO. A typed array queue avoids the per-cell boxing and GC
 * churn of `number[]`, and the buffer is reused across chunk meshes.
 */
class IndexQueue {
  private data = new Int32Array(1024);
  private head = 0;
  private tail = 0;

  public reset(): void {
    this.head = 0;
    this.tail = 0;
  }

  public push(value: number): void {
    if (this.tail === this.data.length) {
      if (this.head > 0) {
        this.data.copyWithin(0, this.head, this.tail);
        this.tail -= this.head;
        this.head = 0;
      } else {
        const grown = new Int32Array(this.data.length * 2);
        grown.set(this.data);
        this.data = grown;
      }
    }
    this.data[this.tail] = value;
    this.tail += 1;
  }

  public shift(): number {
    const value = this.data[this.head];
    this.head += 1;
    return value;
  }

  public get isEmpty(): boolean {
    return this.head >= this.tail;
  }
}

/** Reused by the workers, which mesh chunks sequentially. */
const queue = new IndexQueue();

/**
 * Copies a chunk and its eight horizontal neighbors into one padded volume so
 * the mesher can sample AO and lighting across chunk seams without special cases.
 */
export const buildPaddedBlocks = (chunk: VoxelChunk, neighbors: ChunkMeshNeighbors): Uint8Array => {
  const padded = new Uint8Array(PADDED_VOLUME);

  for (let pz = 0; pz < PADDED_SIZE; pz += 1) {
    const localZ = pz - 1;
    const dz = localZ < 0 ? -1 : localZ > CHUNK_SIZE - 1 ? 1 : 0;
    const sampleZ = ((localZ % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;

    for (let px = 0; px < PADDED_SIZE; px += 1) {
      const localX = px - 1;
      const dx = localX < 0 ? -1 : localX > CHUNK_SIZE - 1 ? 1 : 0;
      const sampleX = ((localX % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
      const source = dx === 0 && dz === 0 ? chunk.blocks : (neighbors.get(`${dx},${dz}`) ?? null);
      if (!source) {
        continue;
      }

      for (let py = 0; py < CHUNK_HEIGHT; py += 1) {
        const worldY = CHUNK_MIN_Y + py;
        padded[paddedIndex(px, py, pz)] = source[chunkIndex(sampleX, worldY, sampleZ)];
      }
    }
  }

  return padded;
};

/** Floods a scalar light field through air, losing one level per step. */
const propagateScalar = (light: Uint8Array, blocks: Uint8Array): void => {
  while (!queue.isEmpty) {
    const index = queue.shift();
    const level = light[index];
    if (level <= 1) {
      continue;
    }

    const px = index % PADDED_SIZE;
    const pz = Math.floor(index / PADDED_SIZE) % PADDED_SIZE;
    const py = Math.floor(index / (PADDED_SIZE * PADDED_SIZE));

    for (const [dx, dy, dz] of NEIGHBOR_OFFSETS) {
      const nx = px + dx;
      const ny = py + dy;
      const nz = pz + dz;
      if (nx < 0 || nx >= PADDED_SIZE || nz < 0 || nz >= PADDED_SIZE) {
        continue;
      }
      if (ny < 0 || ny >= CHUNK_HEIGHT) {
        continue;
      }

      const neighborIndex = paddedIndex(nx, ny, nz);
      if (blocks[neighborIndex] !== BLOCK_TYPE.AIR) {
        continue;
      }
      const next = level - 1;
      if (light[neighborIndex] < next) {
        light[neighborIndex] = next;
        queue.push(neighborIndex);
      }
    }
  }
};

/**
 * Floods an interleaved RGB light field through air. Each channel decays
 * independently so warm and cool emitters keep their color as light spreads.
 */
const propagateRgb = (light: Uint8Array, blocks: Uint8Array): void => {
  while (!queue.isEmpty) {
    const index = queue.shift();
    const base = index * 3;
    const r = light[base];
    const g = light[base + 1];
    const b = light[base + 2];
    if (r <= 1 && g <= 1 && b <= 1) {
      continue;
    }

    const px = index % PADDED_SIZE;
    const pz = Math.floor(index / PADDED_SIZE) % PADDED_SIZE;
    const py = Math.floor(index / (PADDED_SIZE * PADDED_SIZE));

    for (const [dx, dy, dz] of NEIGHBOR_OFFSETS) {
      const nx = px + dx;
      const ny = py + dy;
      const nz = pz + dz;
      if (nx < 0 || nx >= PADDED_SIZE || nz < 0 || nz >= PADDED_SIZE) {
        continue;
      }
      if (ny < 0 || ny >= CHUNK_HEIGHT) {
        continue;
      }

      const neighborIndex = paddedIndex(nx, ny, nz);
      if (blocks[neighborIndex] !== BLOCK_TYPE.AIR) {
        continue;
      }

      const neighborBase = neighborIndex * 3;
      let improved = false;
      const nr = r - 1;
      if (nr > 0 && light[neighborBase] < nr) {
        light[neighborBase] = nr;
        improved = true;
      }
      const ng = g - 1;
      if (ng > 0 && light[neighborBase + 1] < ng) {
        light[neighborBase + 1] = ng;
        improved = true;
      }
      const nb = b - 1;
      if (nb > 0 && light[neighborBase + 2] < nb) {
        light[neighborBase + 2] = nb;
        improved = true;
      }
      if (improved) {
        queue.push(neighborIndex);
      }
    }
  }
};

export interface PaddedLight {
  /** Scalar skylight (0-15). */
  readonly sky: Uint8Array;
  /** Scalar light luminance (0-15), used for AO shading and greedy merging. */
  readonly block: Uint8Array;
  /** Interleaved RGB indirect light (0-15 per channel), three entries per cell. */
  readonly indirect: Uint8Array;
}

/**
 * Computes skylight, colored emissive light, and one bounce of colored global
 * illumination. Emissive light propagates from glowing blocks; the bounce pass
 * reflects skylight and emissive light off surfaces using each block's albedo,
 * which produces color bleeding (sunlit grass tints nearby walls green).
 */
export const computePaddedLight = (
  blocks: Uint8Array,
  lighting: LightingConfig = DEFAULT_LIGHTING,
): PaddedLight => {
  const volume = blocks.length;
  const sky = new Uint8Array(volume);
  const block = new Uint8Array(volume);
  const indirect = new Uint8Array(volume * 3);
  queue.reset();

  // Skylight: vertical exposure, then horizontal bleed.
  for (let pz = 0; pz < PADDED_SIZE; pz += 1) {
    for (let px = 0; px < PADDED_SIZE; px += 1) {
      let open = true;
      for (let py = CHUNK_HEIGHT - 1; py >= 0; py -= 1) {
        const index = paddedIndex(px, py, pz);
        if (blocks[index] !== BLOCK_TYPE.AIR) {
          open = false;
        }
        if (open) {
          sky[index] = 15;
          queue.push(index);
        }
      }
    }
  }
  propagateScalar(sky, blocks);

  // Colored emissive light.
  let hasEmitter = false;
  for (let index = 0; index < volume; index += 1) {
    const level = BLOCK_TYPE_LIGHT[blocks[index]] ?? 0;
    if (level <= 0) {
      continue;
    }
    const color = BLOCK_TYPE_EMISSION_COLOR[blocks[index]] ?? 0xffffff;
    const base = index * 3;
    indirect[base] = Math.round((((color >> 16) & 255) / 255) * level);
    indirect[base + 1] = Math.round((((color >> 8) & 255) / 255) * level);
    indirect[base + 2] = Math.round(((color & 255) / 255) * level);
    queue.push(index);
    hasEmitter = true;
  }
  if (hasEmitter) {
    propagateRgb(indirect, blocks);
  }

  // One bounce: reflect skylight and emissive light off nearby surfaces using
  // the surface albedo, then let that colored light spread through the air.
  if (lighting.globalIllumination) {
    const bounceSeed = new Uint8Array(volume * 3);
    const skyBounce = lighting.skyBounce;
    const strength = lighting.bounceStrength * BOUNCE_GAIN;
    let hasBounce = false;

    for (let index = 0; index < volume; index += 1) {
      const type = blocks[index];
      if (type === BLOCK_TYPE.AIR) {
        continue;
      }
      // Emitters already seed the direct light field; reflecting their own
      // glow would double-count it and wash the color out to white.
      if ((BLOCK_TYPE_LIGHT[type] ?? 0) > 0) {
        continue;
      }
      const albedo = BLOCK_TYPE_ALBEDO[type] ?? 0;
      const ar = ((albedo >> 16) & 255) / 255;
      const ag = ((albedo >> 8) & 255) / 255;
      const ab = (albedo & 255) / 255;
      if (ar + ag + ab <= 0) {
        continue;
      }

      const px = index % PADDED_SIZE;
      const pz = Math.floor(index / PADDED_SIZE) % PADDED_SIZE;
      const py = Math.floor(index / (PADDED_SIZE * PADDED_SIZE));

      for (const [dx, dy, dz] of NEIGHBOR_OFFSETS) {
        const nx = px + dx;
        const ny = py + dy;
        const nz = pz + dz;
        if (nx < 0 || nx >= PADDED_SIZE || nz < 0 || nz >= PADDED_SIZE) {
          continue;
        }
        if (ny < 0 || ny >= CHUNK_HEIGHT) {
          continue;
        }
        const neighborIndex = paddedIndex(nx, ny, nz);
        if (blocks[neighborIndex] !== BLOCK_TYPE.AIR) {
          continue;
        }

        const neighborBase = neighborIndex * 3;
        const emissive =
          (indirect[neighborBase] + indirect[neighborBase + 1] + indirect[neighborBase + 2]) / 3;
        const incoming = sky[neighborIndex] * skyBounce + emissive;
        if (incoming <= 0) {
          continue;
        }

        const seedR = Math.min(15, Math.round(ar * incoming * strength));
        const seedG = Math.min(15, Math.round(ag * incoming * strength));
        const seedB = Math.min(15, Math.round(ab * incoming * strength));
        if (seedR === 0 && seedG === 0 && seedB === 0) {
          continue;
        }
        if (bounceSeed[neighborBase] < seedR) {
          bounceSeed[neighborBase] = seedR;
        }
        if (bounceSeed[neighborBase + 1] < seedG) {
          bounceSeed[neighborBase + 1] = seedG;
        }
        if (bounceSeed[neighborBase + 2] < seedB) {
          bounceSeed[neighborBase + 2] = seedB;
        }
        hasBounce = true;
      }
    }

    if (hasBounce) {
      queue.reset();
      for (let index = 0; index < volume; index += 1) {
        const base = index * 3;
        const r = bounceSeed[base];
        const g = bounceSeed[base + 1];
        const b = bounceSeed[base + 2];
        if (r === 0 && g === 0 && b === 0) {
          continue;
        }
        if (indirect[base] < r) {
          indirect[base] = r;
        }
        if (indirect[base + 1] < g) {
          indirect[base + 1] = g;
        }
        if (indirect[base + 2] < b) {
          indirect[base + 2] = b;
        }
        queue.push(index);
      }
      propagateRgb(indirect, blocks);
    }
  }

  // Scalar luminance of the colored indirect field, used for the existing
  // occlusion shading and the greedy merge key.
  for (let index = 0; index < volume; index += 1) {
    const base = index * 3;
    const r = indirect[base];
    const g = indirect[base + 1];
    const b = indirect[base + 2];
    block[index] = r >= g ? (r >= b ? r : b) : g >= b ? g : b;
  }

  return { sky, block, indirect };
};
