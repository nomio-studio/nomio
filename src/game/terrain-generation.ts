import { BLOCK_TYPE } from "./blocks";
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

export const sampleFbm = (
  noise: OpenSimplex2,
  worldX: number,
  worldZ: number,
  config: TerrainConfig,
): number => {
  let amplitude = 1;
  let frequency = config.frequency;
  let total = 0;
  let amplitudeTotal = 0;

  for (let octave = 0; octave < config.octaves; octave += 1) {
    total += noise.noise2(worldX * frequency, worldZ * frequency) * amplitude;
    amplitudeTotal += amplitude;
    frequency *= config.lacunarity;
    amplitude *= config.gain;
  }

  const normalized = amplitudeTotal > 0 ? total / amplitudeTotal : 0;
  return normalized;
};

export const sampleTerrainHeight = (
  noise: OpenSimplex2,
  worldX: number,
  worldZ: number,
  config: TerrainConfig,
): number => {
  const normalized = sampleFbm(noise, worldX, worldZ, config);
  return Math.floor(config.baseHeight + normalized * config.heightAmplitude);
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
      const surfaceY = sampleTerrainHeight(noise, worldX, worldZ, config);
      const clampedSurfaceY = Math.min(CHUNK_MIN_Y + CHUNK_HEIGHT - 1, surfaceY);

      for (let worldY = CHUNK_MIN_Y; worldY <= clampedSurfaceY; worldY += 1) {
        const blockType =
          worldY === clampedSurfaceY
            ? BLOCK_TYPE.GRASS
            : worldY >= clampedSurfaceY - 2
              ? BLOCK_TYPE.DIRT
              : BLOCK_TYPE.STONE;
        blocks[chunkIndex(localX, worldY, localZ)] = blockType;
      }
    }
  }

  return { x: coordinate.x, z: coordinate.z, blocks };
};
