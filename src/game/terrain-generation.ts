import { BLOCK_TYPE, type BlockType } from "./blocks";
import {
  CHUNK_HEIGHT,
  CHUNK_MIN_Y,
  CHUNK_SIZE,
  CHUNK_VOLUME,
  chunkIndex,
  type ChunkCoordinate,
  type VoxelChunk,
} from "./chunk-types";
import { OpenSimplex2 } from "./open-simplex2";
import type { TerrainConfig } from "./terrain-config";

/** A broad surface family, used for both strata and landmark placement. */
export type TerrainBiome = "basin" | "meadow" | "forest" | "badlands" | "alpine" | "snow";

/** All deterministic signals needed to fill one world column. */
export interface TerrainColumn {
  surfaceY: number;
  biome: TerrainBiome;
  land: number;
  moisture: number;
  dryness: number;
  river: number;
  mountain: number;
}

const MIN_SURFACE_Y = CHUNK_MIN_Y + 2;
// Leave two clear cells at the top of the vertical window for landmark caps.
const MAX_SURFACE_Y = CHUNK_MIN_Y + CHUNK_HEIGHT - 4;
const TREE_CELL_SIZE = 7;
const CRYSTAL_CELL_SIZE = 23;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const clamp01 = (value: number): number => clamp(value, 0, 1);

const smoothstep = (edge0: number, edge1: number, value: number): number => {
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};

const lerp = (from: number, to: number, amount: number): number => from + (to - from) * amount;

const ridge = (value: number): number => 1 - Math.abs(value);

/** Small deterministic hash in `[0, 1)` for world-space feature placement. */
const hash2 = (x: number, z: number, seed: number): number => {
  let value = Math.imul(x, 0x45d9f3b) ^ Math.imul(z, 0x119de1f3) ^ seed;
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
};

const hash3 = (x: number, y: number, z: number, seed: number): number =>
  hash2(x + y * 251, z - y * 199, seed ^ 0x6d2b79f5);

/** Flexible fBm sampler used by the macro, detail, and climate fields. */
const sampleLayer = (
  noise: OpenSimplex2,
  worldX: number,
  worldZ: number,
  frequency: number,
  octaves: number,
  lacunarity = 2,
  gain = 0.5,
): number => {
  let amplitude = 1;
  let currentFrequency = frequency;
  let total = 0;
  let amplitudeTotal = 0;

  for (let octave = 0; octave < octaves; octave += 1) {
    total += noise.noise2(worldX * currentFrequency, worldZ * currentFrequency) * amplitude;
    amplitudeTotal += amplitude;
    currentFrequency *= lacunarity;
    amplitude *= gain;
  }

  return amplitudeTotal > 0 ? total / amplitudeTotal : 0;
};

/** Public legacy fBm contract, retained for callers and terrain diagnostics. */
export const sampleFbm = (
  noise: OpenSimplex2,
  worldX: number,
  worldZ: number,
  config: TerrainConfig,
): number =>
  sampleLayer(
    noise,
    worldX,
    worldZ,
    config.frequency,
    config.octaves,
    config.lacunarity,
    config.gain,
  );

/**
 * Samples the landscape as a coordinate-only function. Warped continents set
 * the silhouette, folded ridges make mountain chains, dry fields flatten into
 * terraced badlands, and a narrow field cuts riverbeds through the result.
 */
export const sampleTerrainColumn = (
  noise: OpenSimplex2,
  worldX: number,
  worldZ: number,
  config: TerrainConfig,
): TerrainColumn => {
  const macroFrequency = Math.max(0.0018, config.frequency * 0.14);
  const detailFrequency = Math.max(0.009, config.frequency * 0.82);

  // Domain warping breaks up the axial look that simple height fields produce.
  const warpX = noise.noise2(
    (worldX + 173.3) * macroFrequency * 2.15,
    (worldZ - 211.7) * macroFrequency * 2.15,
  );
  const warpZ = noise.noise2(
    (worldX - 491.1) * macroFrequency * 2.15,
    (worldZ + 87.9) * macroFrequency * 2.15,
  );
  const x = worldX + warpX * 26;
  const z = worldZ + warpZ * 26;

  const continental = sampleLayer(noise, x, z, macroFrequency, 2, 2.05, 0.52);
  const land = smoothstep(-0.48, 0.3, continental);
  const rolling = sampleLayer(noise, x, z, detailFrequency, 3, 2.03, 0.5);
  const rangeSignal =
    (noise.noise2(x * macroFrequency * 2.4 + 71.2, z * macroFrequency * 2.4) + 1) * 0.5;
  const foldedRidge = ridge(
    noise.noise2(x * detailFrequency * 0.46 - 39.4, z * detailFrequency * 0.46 + 154.6),
  );
  const temperature =
    (noise.noise2(x * macroFrequency * 1.55 + 912.8, z * macroFrequency * 1.55 - 504.2) + 1) * 0.5;
  const moisture =
    (noise.noise2(x * macroFrequency * 1.82 - 277.4, z * macroFrequency * 1.82 + 703.1) + 1) * 0.5;
  const dryness = clamp01(1 - moisture + (1 - temperature) * 0.1);
  const river =
    1 -
    smoothstep(
      0.025,
      0.17,
      Math.abs(noise.noise2(x * macroFrequency * 4.1 + 104.7, z * macroFrequency * 4.1 - 318.8)),
    );

  const mountains = land * smoothstep(0.44, 0.74, rangeSignal);
  const badlands = land * smoothstep(0.54, 0.78, dryness) * smoothstep(0.26, 0.76, rangeSignal);
  const amplitude = config.heightAmplitude;
  const lowlands = config.baseHeight - 4 + land * (amplitude + 5);
  const foothills = rolling * (1.9 + amplitude * 0.34) * (0.45 + land * 0.55);
  const mountainHeight =
    mountains * (Math.pow(foldedRidge, 2.7) * (amplitude * 1.7 + 6.5) + rangeSignal * 2.4);
  const mesaHeight = badlands * (4.4 + Math.max(0, rolling) * 4.2);
  const riverCut = river * land * (1.8 + mountains * 3.2);

  let height = lowlands + foothills + mountainHeight + mesaHeight - riverCut;
  // Dry plateaus resolve into deliberate shelves while the rest stays naturally folded.
  if (badlands > 0.18) {
    const terrace = Math.floor(height / 3) * 3 + 1.3;
    height = lerp(height, terrace, smoothstep(0.18, 0.78, badlands) * 0.72);
  }

  const surfaceY = Math.floor(clamp(height, MIN_SURFACE_Y, MAX_SURFACE_Y));
  let biome: TerrainBiome;
  if (land < 0.28 || (river > 0.72 && surfaceY < 8)) {
    biome = "basin";
  } else if (surfaceY >= 19 || (surfaceY >= 15 && temperature < 0.31)) {
    biome = "snow";
  } else if (surfaceY >= 14 || mountains > 0.52) {
    biome = "alpine";
  } else if (badlands > 0.34) {
    biome = "badlands";
  } else if (moisture > 0.58 && temperature > 0.3) {
    biome = "forest";
  } else {
    biome = "meadow";
  }

  return { surfaceY, biome, land, moisture, dryness, river, mountain: mountains };
};

export const sampleTerrainHeight = (
  noise: OpenSimplex2,
  worldX: number,
  worldZ: number,
  config: TerrainConfig,
): number => sampleTerrainColumn(noise, worldX, worldZ, config).surfaceY;

const surfaceBlock = (column: TerrainColumn): BlockType => {
  switch (column.biome) {
    case "basin":
      return BLOCK_TYPE.SAND;
    case "badlands":
      return BLOCK_TYPE.NETHERRACK;
    case "alpine":
      return BLOCK_TYPE.STONE;
    case "snow":
      return BLOCK_TYPE.SNOW;
    default:
      return BLOCK_TYPE.GRASS;
  }
};

const blockAtDepth = (
  column: TerrainColumn,
  depth: number,
  worldX: number,
  worldY: number,
  worldZ: number,
  seed: number,
): BlockType => {
  if (depth === 0) {
    return surfaceBlock(column);
  }

  const soilDepth = column.biome === "basin" ? 4 : column.biome === "badlands" ? 5 : 3;
  if (depth < soilDepth) {
    if (column.biome === "basin" || (column.river > 0.56 && depth < 2)) {
      return BLOCK_TYPE.SAND;
    }
    if (column.biome === "badlands") {
      return BLOCK_TYPE.NETHERRACK;
    }
    return BLOCK_TYPE.DIRT;
  }

  // Rare mineral seams break up cliffs and reward deep exploration without
  // needing a separate cave system.
  const mineral = hash3(worldX, worldY, worldZ, seed);
  if (depth > 5 && mineral > 0.987) {
    return BLOCK_TYPE.IRON_ORE;
  }
  if (depth > 3 && mineral < 0.016) {
    return BLOCK_TYPE.COAL_ORE;
  }
  if (column.biome === "badlands" && depth > 8 && mineral > 0.975) {
    return BLOCK_TYPE.OBSIDIAN;
  }
  if (column.biome === "forest" && depth < 8 && mineral > 0.965) {
    return BLOCK_TYPE.MOSSY_COBBLESTONE;
  }
  if (column.biome === "alpine" && depth < 7 && mineral > 0.972) {
    return BLOCK_TYPE.COBBLESTONE;
  }
  return BLOCK_TYPE.STONE;
};

const writeFeatureBlock = (
  blocks: Uint8Array,
  coordinate: ChunkCoordinate,
  worldX: number,
  worldY: number,
  worldZ: number,
  block: BlockType,
  replace = false,
): void => {
  const minX = coordinate.x * CHUNK_SIZE;
  const minZ = coordinate.z * CHUNK_SIZE;
  const localX = worldX - minX;
  const localZ = worldZ - minZ;
  if (
    localX < 0 ||
    localX >= CHUNK_SIZE ||
    localZ < 0 ||
    localZ >= CHUNK_SIZE ||
    worldY < CHUNK_MIN_Y ||
    worldY >= CHUNK_MIN_Y + CHUNK_HEIGHT
  ) {
    return;
  }
  const index = chunkIndex(localX, worldY, localZ);
  if (replace || blocks[index] === BLOCK_TYPE.AIR) {
    blocks[index] = block;
  }
};

/** Stamps cross-chunk-safe trees from a small world-space feature lattice. */
const stampTrees = (
  blocks: Uint8Array,
  coordinate: ChunkCoordinate,
  noise: OpenSimplex2,
  config: TerrainConfig,
): void => {
  const minX = coordinate.x * CHUNK_SIZE;
  const minZ = coordinate.z * CHUNK_SIZE;
  const maxX = minX + CHUNK_SIZE - 1;
  const maxZ = minZ + CHUNK_SIZE - 1;
  const minCellX = Math.floor((minX - 3) / TREE_CELL_SIZE);
  const maxCellX = Math.floor((maxX + 3) / TREE_CELL_SIZE);
  const minCellZ = Math.floor((minZ - 3) / TREE_CELL_SIZE);
  const maxCellZ = Math.floor((maxZ + 3) / TREE_CELL_SIZE);

  for (let cellZ = minCellZ; cellZ <= maxCellZ; cellZ += 1) {
    for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
      const x =
        cellX * TREE_CELL_SIZE +
        1 +
        Math.floor(hash2(cellX, cellZ, config.seed ^ 0x4f1bbcdc) * (TREE_CELL_SIZE - 2));
      const z =
        cellZ * TREE_CELL_SIZE +
        1 +
        Math.floor(hash2(cellX, cellZ, config.seed ^ 0x1b873593) * (TREE_CELL_SIZE - 2));
      const column = sampleTerrainColumn(noise, x, z, config);
      const density = column.biome === "forest" ? 0.62 : column.biome === "meadow" ? 0.16 : 0;
      if (
        density === 0 ||
        hash2(cellX, cellZ, config.seed ^ 0x7f4a7c15) > density ||
        column.surfaceY > MAX_SURFACE_Y - 7 ||
        column.river > 0.55
      ) {
        continue;
      }

      const trunkHeight = 3 + Math.floor(hash2(cellX, cellZ, config.seed ^ 0x9e3779b9) * 3);
      const crownY = column.surfaceY + trunkHeight;
      for (let y = column.surfaceY + 1; y <= crownY; y += 1) {
        writeFeatureBlock(blocks, coordinate, x, y, z, BLOCK_TYPE.OAK_LOG);
      }

      for (let y = crownY - 2; y <= crownY + 1; y += 1) {
        const radius = y === crownY + 1 ? 1 : y === crownY - 2 ? 1 : 2;
        for (let dz = -radius; dz <= radius; dz += 1) {
          for (let dx = -radius; dx <= radius; dx += 1) {
            if (dx * dx + dz * dz > radius * radius + (y === crownY ? 1 : 0)) {
              continue;
            }
            if (hash3(x + dx, y, z + dz, config.seed) < 0.1) {
              continue;
            }
            writeFeatureBlock(blocks, coordinate, x + dx, y, z + dz, BLOCK_TYPE.LEAVES);
          }
        }
      }
    }
  }
};

/** Rare luminous spires give alpine and badland horizons a distant focal point. */
const stampCrystalSpires = (
  blocks: Uint8Array,
  coordinate: ChunkCoordinate,
  noise: OpenSimplex2,
  config: TerrainConfig,
): void => {
  const minX = coordinate.x * CHUNK_SIZE;
  const minZ = coordinate.z * CHUNK_SIZE;
  const maxX = minX + CHUNK_SIZE - 1;
  const maxZ = minZ + CHUNK_SIZE - 1;
  const minCellX = Math.floor((minX - 2) / CRYSTAL_CELL_SIZE);
  const maxCellX = Math.floor((maxX + 2) / CRYSTAL_CELL_SIZE);
  const minCellZ = Math.floor((minZ - 2) / CRYSTAL_CELL_SIZE);
  const maxCellZ = Math.floor((maxZ + 2) / CRYSTAL_CELL_SIZE);

  for (let cellZ = minCellZ; cellZ <= maxCellZ; cellZ += 1) {
    for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
      if (hash2(cellX, cellZ, config.seed ^ 0x85ebca6b) > 0.3) {
        continue;
      }
      const x =
        cellX * CRYSTAL_CELL_SIZE +
        2 +
        Math.floor(hash2(cellX, cellZ, config.seed ^ 0xc2b2ae35) * (CRYSTAL_CELL_SIZE - 4));
      const z =
        cellZ * CRYSTAL_CELL_SIZE +
        2 +
        Math.floor(hash2(cellX, cellZ, config.seed ^ 0x27d4eb2f) * (CRYSTAL_CELL_SIZE - 4));
      const column = sampleTerrainColumn(noise, x, z, config);
      if (
        (column.biome !== "alpine" && column.biome !== "badlands" && column.biome !== "snow") ||
        column.surfaceY > MAX_SURFACE_Y - 8 ||
        column.river > 0.35
      ) {
        continue;
      }

      const height = 3 + Math.floor(hash2(cellX, cellZ, config.seed ^ 0x165667b1) * 4);
      const baseY = column.surfaceY + 1;
      writeFeatureBlock(blocks, coordinate, x, baseY, z, BLOCK_TYPE.OBSIDIAN);
      for (let y = baseY + 1; y <= baseY + height; y += 1) {
        writeFeatureBlock(blocks, coordinate, x, y, z, BLOCK_TYPE.CRYSTAL);
      }
      if (height >= 5) {
        writeFeatureBlock(blocks, coordinate, x + 1, baseY + 1, z, BLOCK_TYPE.CRYSTAL);
        writeFeatureBlock(blocks, coordinate, x - 1, baseY + 1, z, BLOCK_TYPE.CRYSTAL);
      }
    }
  }
};

export const generateTerrainChunk = (
  coordinate: ChunkCoordinate,
  config: TerrainConfig,
): VoxelChunk => {
  const noise = new OpenSimplex2(config.seed);
  const blocks = new Uint8Array(CHUNK_VOLUME);

  for (let localX = 0; localX < CHUNK_SIZE; localX += 1) {
    for (let localZ = 0; localZ < CHUNK_SIZE; localZ += 1) {
      const worldX = coordinate.x * CHUNK_SIZE + localX;
      const worldZ = coordinate.z * CHUNK_SIZE + localZ;
      const column = sampleTerrainColumn(noise, worldX, worldZ, config);

      for (let worldY = CHUNK_MIN_Y; worldY <= column.surfaceY; worldY += 1) {
        const depth = column.surfaceY - worldY;
        blocks[chunkIndex(localX, worldY, localZ)] = blockAtDepth(
          column,
          depth,
          worldX,
          worldY,
          worldZ,
          config.seed,
        );
      }
    }
  }

  stampTrees(blocks, coordinate, noise, config);
  stampCrystalSpires(blocks, coordinate, noise, config);
  return { x: coordinate.x, z: coordinate.z, blocks };
};
