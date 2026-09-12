import { gzipSync } from "node:zlib";
import {
  CHUNK_CODEC,
  VOXEL_REGION_SIZE,
  crc32,
  decodeChunk,
  decodeVoxelArchive,
  decodeVoxelRegion,
  encodeChunk,
  encodeVoxelArchive,
  encodeVoxelRegion,
  measureChunkCodecs,
  type ChunkBaseProvider,
  type ChunkCodec,
  type VoxelFormatDimensions,
} from "../src/game/voxel-format.ts";

/**
 * Verifies the Nomio Voxel Storage Format and measures it against gzip.
 *
 * Run with:  node scripts/voxel-format-bench.ts
 */

const DIMENSIONS: VoxelFormatDimensions = { sizeX: 16, sizeY: 40, sizeZ: 16, minY: -12 };
const VOLUME = DIMENSIONS.sizeX * DIMENSIONS.sizeY * DIMENSIONS.sizeZ;
const AIR = 0;
const GRASS = 1;
const DIRT = 2;
const STONE = 3;
const PLANKS = 7;
const COBBLE = 4;

const indexOf = (x: number, y: number, z: number): number =>
  x + z * DIMENSIONS.sizeX + y * DIMENSIONS.sizeX * DIMENSIONS.sizeZ;

const mulberry32 = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
};

const hash2 = (x: number, z: number, seed: number): number => {
  let value =
    Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(z | 0, 0x165667b1) ^ Math.imul(seed, 0x9e3779b1);
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
};

const smooth = (t: number): number => t * t * (3 - 2 * t);

const valueNoise = (x: number, z: number, seed: number): number => {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const fx = smooth(x - x0);
  const fz = smooth(z - z0);
  const top = hash2(x0, z0, seed) * (1 - fx) + hash2(x0 + 1, z0, seed) * fx;
  const bottom = hash2(x0, z0 + 1, seed) * (1 - fx) + hash2(x0 + 1, z0 + 1, seed) * fx;
  return top * (1 - fz) + bottom * fz;
};

const terrainHeight = (worldX: number, worldZ: number): number => {
  let value = 0;
  let amplitude = 1;
  let frequency = 0.04;
  let total = 0;
  for (let octave = 0; octave < 4; octave += 1) {
    value += valueNoise(worldX * frequency, worldZ * frequency, 1337 + octave) * amplitude;
    total += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return Math.floor(6 + (value / total) * 7);
};

const generateTerrain = (chunkX: number, chunkZ: number): Uint8Array => {
  const blocks = new Uint8Array(VOLUME);
  for (let z = 0; z < DIMENSIONS.sizeZ; z += 1) {
    for (let x = 0; x < DIMENSIONS.sizeX; x += 1) {
      const surface = Math.min(
        DIMENSIONS.sizeY - 1,
        terrainHeight(chunkX * DIMENSIONS.sizeX + x, chunkZ * DIMENSIONS.sizeZ + z),
      );
      for (let y = 0; y <= surface; y += 1) {
        const block = y === surface ? GRASS : y >= surface - 2 ? DIRT : STONE;
        blocks[indexOf(x, y, z)] = block;
      }
    }
  }
  return blocks;
};

const applyEdits = (blocks: Uint8Array, seed: number, count: number): void => {
  const random = mulberry32(seed);
  for (let edit = 0; edit < count; edit += 1) {
    const x = Math.floor(random() * DIMENSIONS.sizeX);
    const z = Math.floor(random() * DIMENSIONS.sizeZ);
    let ground = -1;
    for (let y = DIMENSIONS.sizeY - 1; y >= 0; y -= 1) {
      if (blocks[indexOf(x, y, z)] !== 0) {
        ground = y;
        break;
      }
    }
    const y = Math.max(0, Math.min(DIMENSIONS.sizeY - 1, ground + Math.floor(random() * 7) - 3));
    blocks[indexOf(x, y, z)] = random() < 0.5 ? (random() < 0.5 ? PLANKS : COBBLE) : AIR;
  }
};

/** Places blocks anywhere in the volume, including mid-air, as a worst case. */
const applyScatteredEdits = (blocks: Uint8Array, seed: number, count: number): void => {
  const random = mulberry32(seed);
  for (let edit = 0; edit < count; edit += 1) {
    const x = Math.floor(random() * DIMENSIONS.sizeX);
    const z = Math.floor(random() * DIMENSIONS.sizeZ);
    const y = Math.floor(random() * DIMENSIONS.sizeY);
    blocks[indexOf(x, y, z)] = random() < 0.5 ? (random() < 0.5 ? PLANKS : COBBLE) : AIR;
  }
};

const carveCaves = (blocks: Uint8Array, seed: number, count: number): void => {
  const random = mulberry32(seed);
  for (let cave = 0; cave < count; cave += 1) {
    const cx = Math.floor(random() * DIMENSIONS.sizeX);
    const cz = Math.floor(random() * DIMENSIONS.sizeZ);
    const cy = Math.floor(random() * DIMENSIONS.sizeY);
    const radius = 1 + Math.floor(random() * 3);
    for (let z = cz - radius; z <= cz + radius; z += 1) {
      for (let x = cx - radius; x <= cx + radius; x += 1) {
        for (let y = cy - radius; y <= cy + radius; y += 1) {
          if (x < 0 || z < 0 || y < 0 || x >= DIMENSIONS.sizeX || z >= DIMENSIONS.sizeZ) {
            continue;
          }
          if (y >= DIMENSIONS.sizeY) {
            continue;
          }
          blocks[indexOf(x, y, z)] = AIR;
        }
      }
    }
  }
};

const randomChunk = (seed: number): Uint8Array => {
  const random = mulberry32(seed);
  const blocks = new Uint8Array(VOLUME);
  for (let index = 0; index < VOLUME; index += 1) {
    blocks[index] = Math.floor(random() * 18);
  }
  return blocks;
};

const uniformChunk = (value: number): Uint8Array => new Uint8Array(VOLUME).fill(value);

const assertEqual = (a: Uint8Array, b: Uint8Array, label: string): void => {
  if (a.length !== b.length) {
    throw new Error(`${label}: length mismatch`);
  }
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) {
      throw new Error(`${label}: mismatch at ${index} (${a[index]} !== ${b[index]})`);
    }
  }
};

const codecName = (codec: ChunkCodec): string =>
  Object.entries(CHUNK_CODEC).find(([, value]) => value === codec)?.[0] ?? "?";

const gzipSize = (blocks: Uint8Array): number => gzipSync(Buffer.from(blocks), { level: 9 }).length;

interface Sample {
  readonly label: string;
  readonly blocks: Uint8Array;
  readonly base?: Uint8Array | null;
  /** Adversarial samples are entropy-dominated and favor generic compressors. */
  readonly adversarial?: boolean;
}

const runChunkSuite = (samples: readonly Sample[]): void => {
  console.log("\n== Per-chunk codec ==");
  console.log(
    ["sample", "best codec", "encoded", "gzip", "ratio", "raw"].map((h) => h.padEnd(16)).join(""),
  );
  let encodedTotal = 0;
  let gzipTotal = 0;
  let rawTotal = 0;
  let structuredEncoded = 0;
  let structuredGzip = 0;

  for (const sample of samples) {
    const encoded = encodeChunk(sample.blocks, DIMENSIONS, { base: sample.base ?? null });
    const decoded = decodeChunk(encoded, DIMENSIONS, { x: 0, z: 0 }, () => sample.base ?? null);
    assertEqual(decoded, sample.blocks, sample.label);

    const gz = gzipSize(sample.blocks);
    encodedTotal += encoded.length;
    gzipTotal += gz;
    rawTotal += sample.blocks.length;

    if (!sample.adversarial) {
      structuredEncoded += encoded.length;
      structuredGzip += gz;
    }

    const best = measureChunkCodecs(sample.blocks, DIMENSIONS, { base: sample.base ?? null })[0];
    console.log(
      [
        sample.label,
        `${codecName(best.codec)}`,
        `${encoded.length}`,
        `${gz}`,
        `${(gz / encoded.length).toFixed(1)}x`,
        `${sample.blocks.length}`,
      ]
        .map((value) => value.padEnd(16))
        .join(""),
    );
  }

  console.log(
    `structured (voxel) data: ${structuredEncoded} B vs gzip ${structuredGzip} B  ` +
      `(format ${(structuredGzip / structuredEncoded).toFixed(2)}x smaller)`,
  );
  console.log(
    `all samples incl. adversarial: ${encodedTotal} B vs gzip ${gzipTotal} B vs raw ${rawTotal} B  ` +
      `(format ${(gzipTotal / encodedTotal).toFixed(2)}x smaller than gzip)`,
  );
};

const runWorldSuite = (): void => {
  console.log("\n== Edited-world save (only edits persisted) ==");
  const chunkCount = 256;
  const editedCount = 16;
  const baseByKey = new Map<string, Uint8Array>();
  const baseProvider: ChunkBaseProvider = (coordinate) =>
    baseByKey.get(`${coordinate.x},${coordinate.z}`) ?? null;

  const allChunks: { x: number; z: number; blocks: Uint8Array }[] = [];
  const editedChunks: { x: number; z: number; blocks: Uint8Array }[] = [];

  for (let index = 0; index < chunkCount; index += 1) {
    const x = index % 16;
    const z = Math.floor(index / 16);
    const base = generateTerrain(x, z);
    baseByKey.set(`${x},${z}`, base);
    const blocks = base.slice();
    if (index < editedCount) {
      applyEdits(blocks, 9000 + index, 7);
      editedChunks.push({ x, z, blocks });
    }
    allChunks.push({ x, z, blocks });
  }

  const archive = encodeVoxelArchive(editedChunks, {
    dimensions: DIMENSIONS,
    blockFingerprint: 1,
    generatorFingerprint: 2,
    baseProvider,
  });
  const restored = decodeVoxelArchive(archive, baseProvider);
  if (restored.length !== editedCount) {
    throw new Error(`Archive restored ${restored.length} of ${editedCount} chunks`);
  }
  for (const chunk of restored) {
    const original = editedChunks.find((entry) => entry.x === chunk.x && entry.z === chunk.z);
    if (!original) {
      throw new Error("Restored an unexpected chunk");
    }
    assertEqual(chunk.blocks, original.blocks, `archive ${chunk.x},${chunk.z}`);
  }

  const rawWorld = Buffer.concat(allChunks.map((chunk) => Buffer.from(chunk.blocks)));
  const gzippedWorld = gzipSync(rawWorld, { level: 9 }).length;
  console.log(`chunks                 ${chunkCount} (${editedCount} edited)`);
  console.log(`raw world              ${rawWorld.length} B`);
  console.log(`gzip world             ${gzippedWorld} B`);
  console.log(`NSVF world (edits)     ${archive.length} B`);
  console.log(`  vs gzip              ${(gzippedWorld / archive.length).toFixed(1)}x smaller`);
  console.log(`  vs raw               ${(rawWorld.length / archive.length).toFixed(1)}x smaller`);

  // Region round-trip with negative coordinates and integrity checking.
  const regionChunks = [
    { x: -1, z: -1, blocks: generateTerrain(-1, -1) },
    { x: -31, z: -32, blocks: generateTerrain(-31, -32) },
    { x: -2, z: -3, blocks: generateTerrain(-2, -3) },
  ];
  const region = encodeVoxelRegion(regionChunks, {
    dimensions: DIMENSIONS,
    blockFingerprint: 77,
    generatorFingerprint: 88,
    regionX: -1,
    regionZ: -1,
  });
  const decodedRegion = decodeVoxelRegion(region, baseProvider);
  if (decodedRegion.length !== regionChunks.length) {
    throw new Error("Region chunk count mismatch");
  }
  for (const chunk of decodedRegion) {
    const original = regionChunks.find((entry) => entry.x === chunk.x && entry.z === chunk.z);
    assertEqual(chunk.blocks, original!.blocks, `region ${chunk.x},${chunk.z}`);
  }
  const corrupted = region.slice();
  corrupted[corrupted.length - 1] ^= 0xff;
  let caught = false;
  try {
    decodeVoxelRegion(corrupted, baseProvider);
  } catch {
    caught = true;
  }
  if (!caught) {
    throw new Error("Corrupt region was not detected");
  }
  console.log("region round-trip       ok (negative coords + CRC detection)");
};

const runTiming = (): void => {
  console.log("\n== Timing ==");
  const chunks: Uint8Array[] = [];
  for (let index = 0; index < 200; index += 1) {
    const blocks = generateTerrain(index % 20, Math.floor(index / 20) - 5);
    applyEdits(blocks, index, 5);
    chunks.push(blocks);
  }
  const start = performance.now();
  let bytes = 0;
  for (const blocks of chunks) {
    bytes += encodeChunk(blocks, DIMENSIONS).length;
  }
  const elapsed = performance.now() - start;
  console.log(
    `encoded ${chunks.length} chunks (${bytes} B) in ${elapsed.toFixed(1)} ms ` +
      `(${((elapsed / chunks.length) * 1000).toFixed(0)} us/chunk)`,
  );
  // Reference the fingerprint helper so the import is exercised.
  console.log(
    `block fingerprint of [0..17] = ${crc32(Uint8Array.from({ length: 18 }, (_, i) => i))}`,
  );
};

const sampleSet: Sample[] = [
  { label: "flat terrain", blocks: generateTerrain(0, 0) },
  { label: "terrain far", blocks: generateTerrain(7, -3) },
  {
    label: "terrain edited",
    blocks: (() => {
      const blocks = generateTerrain(2, 2);
      applyEdits(blocks, 42, 12);
      return blocks;
    })(),
  },
  {
    label: "terrain scattered",
    blocks: (() => {
      const blocks = generateTerrain(2, 3);
      applyScatteredEdits(blocks, 43, 12);
      return blocks;
    })(),
  },
  {
    label: "terrain cave",
    blocks: (() => {
      const blocks = generateTerrain(4, 4);
      carveCaves(blocks, 7, 6);
      return blocks;
    })(),
  },
  {
    label: "delta vs base",
    blocks: (() => {
      const blocks = generateTerrain(3, 3);
      applyEdits(blocks, 55, 6);
      return blocks;
    })(),
    base: generateTerrain(3, 3),
  },
  { label: "uniform stone", blocks: uniformChunk(STONE) },
  { label: "empty air", blocks: uniformChunk(AIR) },
  { label: "random noise", blocks: randomChunk(1234), adversarial: true },
];

console.log("Nomio Voxel Storage Format verification");
console.log(
  `dims ${DIMENSIONS.sizeX}x${DIMENSIONS.sizeY}x${DIMENSIONS.sizeZ}, minY ${DIMENSIONS.minY}, region ${VOXEL_REGION_SIZE}`,
);
console.log(`volume ${VOLUME} B/chunk`);
runChunkSuite(sampleSet);
runWorldSuite();
runTiming();
console.log("\nAll voxel format checks passed.");
