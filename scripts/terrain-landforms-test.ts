import assert from "node:assert/strict";
import { BLOCK_TYPE, BLOCK_TYPE_TO_ID } from "../src/game/blocks.ts";
import { CHUNK_SIZE } from "../src/game/chunk-types.ts";
import { DEFAULT_TERRAIN_CONFIG } from "../src/game/terrain-config.ts";
import {
  generateTerrainChunk,
  sampleTerrainColumn,
  type TerrainBiome,
} from "../src/game/terrain-generation.ts";
import { OpenSimplex2 } from "../src/game/open-simplex2.ts";

let passed = 0;

const check = (label: string, condition: boolean): void => {
  assert.ok(condition, `FAIL: ${label}`);
  passed += 1;
  console.log(`  ok  ${label}`);
};

const sameBlocks = (first: Uint8Array, second: Uint8Array): boolean =>
  first.length === second.length && first.every((value, index) => value === second[index]);

const main = (): void => {
  const config = { ...DEFAULT_TERRAIN_CONFIG };
  const noise = new OpenSimplex2(config.seed);

  console.log("== Determinism ==");
  const first = generateTerrainChunk({ x: -3, z: 5 }, config);
  const second = generateTerrainChunk({ x: -3, z: 5 }, config);
  check("same seed and chunk produce identical voxels", sameBlocks(first.blocks, second.blocks));
  check(
    "every generated voxel uses a registered numeric block type",
    first.blocks.every((value) => value >= BLOCK_TYPE.AIR && value <= BLOCK_TYPE.CRYSTAL),
  );

  console.log("== Landform field ==");
  const biomes = new Set<TerrainBiome>();
  let minHeight = Number.POSITIVE_INFINITY;
  let maxHeight = Number.NEGATIVE_INFINITY;
  let maxStep = 0;
  for (let z = -256; z <= 256; z += 4) {
    for (let x = -256; x <= 256; x += 4) {
      const column = sampleTerrainColumn(noise, x, z, config);
      const east = sampleTerrainColumn(noise, x + 1, z, config);
      const south = sampleTerrainColumn(noise, x, z + 1, config);
      biomes.add(column.biome);
      minHeight = Math.min(minHeight, column.surfaceY);
      maxHeight = Math.max(maxHeight, column.surfaceY);
      maxStep = Math.max(
        maxStep,
        Math.abs(column.surfaceY - east.surfaceY),
        Math.abs(column.surfaceY - south.surfaceY),
      );
    }
  }
  check("terrain spans at least 72 vertical blocks", maxHeight - minHeight >= 72);
  check("terrain includes deep basins", minHeight <= -20);
  check("terrain includes monumental alpine peaks", maxHeight >= 45);
  check("all six biome families appear in a regional sample", biomes.size === 6);
  check("adjacent columns keep even extreme cliff faces bounded", maxStep <= 20);

  console.log("== Surface vocabulary ==");
  const blockCounts = new Uint32Array(BLOCK_TYPE.CRYSTAL + 1);
  const started = performance.now();
  for (let chunkZ = -7; chunkZ <= 7; chunkZ += 1) {
    for (let chunkX = -7; chunkX <= 7; chunkX += 1) {
      const chunk = generateTerrainChunk({ x: chunkX, z: chunkZ }, config);
      for (const block of chunk.blocks) {
        blockCounts[block] += 1;
      }
    }
  }
  const elapsed = performance.now() - started;
  check("sand basins are generated", blockCounts[BLOCK_TYPE.SAND] > 0);
  check("forest landmarks are generated", blockCounts[BLOCK_TYPE.LEAVES] > 0);
  check("snow caps are generated", blockCounts[BLOCK_TYPE.SNOW] > 0);
  check("badland strata are generated", blockCounts[BLOCK_TYPE.NETHERRACK] > 0);
  check("crystal spires are generated", blockCounts[BLOCK_TYPE.CRYSTAL] > 0);
  check("forest rock variation is generated", blockCounts[BLOCK_TYPE.MOSSY_COBBLESTONE] > 0);
  check("alpine talus variation is generated", blockCounts[BLOCK_TYPE.COBBLESTONE] > 0);
  check("generation stays below 3 milliseconds per chunk", elapsed / 225 < 3);

  const materials = Object.fromEntries(
    BLOCK_TYPE_TO_ID.map((id, type) => [id ?? "air", blockCounts[type]]),
  );
  console.log(
    `  sampled ${CHUNK_SIZE * CHUNK_SIZE * 225} columns in ${elapsed.toFixed(1)} ms ` +
      `(${(elapsed / 225).toFixed(2)} ms/chunk)`,
  );
  console.log(`  materials ${JSON.stringify(materials)}`);
  console.log(`\nAll terrain landform checks passed (${passed}).`);
};

main();
