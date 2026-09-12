import { BLOCK_TYPE, type BlockType } from "./blocks";
import type { TerrainConfig } from "./terrain-config";

export const CHUNK_SIZE = 16;
export const CHUNK_MIN_Y = -12;
export const CHUNK_HEIGHT = 40;
export const CHUNK_VOLUME = CHUNK_SIZE * CHUNK_SIZE * CHUNK_HEIGHT;

export interface ChunkCoordinate {
  x: number;
  z: number;
}

export interface VoxelChunk extends ChunkCoordinate {
  readonly blocks: Uint8Array;
}

export interface GeneratedChunkPayload extends ChunkCoordinate {
  readonly buffer: ArrayBuffer;
}

export interface TerrainWorkerGenerateRequest extends ChunkCoordinate {
  readonly type: "generate";
  readonly requestId: number;
  readonly config: TerrainConfig;
}

export interface TerrainWorkerResponse extends ChunkCoordinate {
  readonly type: "generated";
  readonly requestId: number;
  readonly buffer: ArrayBuffer;
}

export const chunkKey = ({ x, z }: ChunkCoordinate): string => `${x},${z}`;

export const createChunkWindow = (center: ChunkCoordinate, radius: number): ChunkCoordinate[] => {
  const coordinates: ChunkCoordinate[] = [];
  for (let z = center.z - radius; z <= center.z + radius; z += 1) {
    for (let x = center.x - radius; x <= center.x + radius; x += 1) {
      coordinates.push({ x, z });
    }
  }
  return coordinates;
};

export const chunkCoordinate = (worldCoordinate: number): number =>
  Math.floor(worldCoordinate / CHUNK_SIZE);

export const localCoordinate = (worldCoordinate: number): number =>
  ((worldCoordinate % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;

export const chunkIndex = (x: number, y: number, z: number): number =>
  x + z * CHUNK_SIZE + (y - CHUNK_MIN_Y) * CHUNK_SIZE * CHUNK_SIZE;

export const isValidBlockType = (value: number): value is BlockType =>
  Number.isInteger(value) && value >= BLOCK_TYPE.AIR && value <= BLOCK_TYPE.CRYSTAL;
