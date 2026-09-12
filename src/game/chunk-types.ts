import { BLOCK_TYPE, type BlockType } from "./blocks";
import type { LightingConfig } from "./config";
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

/**
 * Compact, transferable representation of a chunk mesh. One entry per greedy
 * quad: origins/uv/normals are per-vector triples (3 entries per quad).
 */
export interface ChunkMeshBuffers {
  readonly quadCount: number;
  readonly blockType: Uint8Array;
  readonly textureFace: Uint8Array;
  readonly origin: Float32Array;
  readonly u: Int8Array;
  readonly v: Int8Array;
  readonly normal: Int8Array;
  readonly width: Uint8Array;
  readonly height: Uint8Array;
  /** Per-vertex ambient occlusion (0-3), four entries per quad. */
  readonly ao: Uint8Array;
  /** Per-vertex light (0-15), four entries per quad. */
  readonly light: Uint8Array;
  /** Per-vertex indirect RGB (4 bits per channel, packed), four per quad. */
  readonly indirect: Uint16Array;
}

/** Block data for the eight neighbors around a chunk, keyed by `"dx,dz"`. */
export type ChunkMeshNeighbors = ReadonlyMap<string, Uint8Array>;

export interface TerrainWorkerGenerateRequest extends ChunkCoordinate {
  readonly type: "generate";
  readonly requestId: number;
  readonly config: TerrainConfig;
}

export interface TerrainWorkerMeshRequest extends ChunkCoordinate {
  readonly type: "mesh";
  readonly requestId: number;
  readonly blocks: Uint8Array;
  readonly neighbors: ChunkMeshNeighbors;
  readonly lighting: LightingConfig;
}

export type TerrainWorkerRequest = TerrainWorkerGenerateRequest | TerrainWorkerMeshRequest;

export interface TerrainWorkerGeneratedResponse extends ChunkCoordinate {
  readonly type: "generated";
  readonly requestId: number;
  readonly buffer: ArrayBuffer;
}

export interface TerrainWorkerMeshedResponse extends ChunkCoordinate {
  readonly type: "meshed";
  readonly requestId: number;
  readonly mesh: ChunkMeshBuffers;
}

export type TerrainWorkerResponse = TerrainWorkerGeneratedResponse | TerrainWorkerMeshedResponse;

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

export const createChunkCircle = (center: ChunkCoordinate, radius: number): ChunkCoordinate[] => {
  const coordinates: ChunkCoordinate[] = [];
  const radiusSquared = radius * radius;
  for (let z = center.z - radius; z <= center.z + radius; z += 1) {
    for (let x = center.x - radius; x <= center.x + radius; x += 1) {
      const dx = x - center.x;
      const dz = z - center.z;
      if (dx * dx + dz * dz <= radiusSquared) {
        coordinates.push({ x, z });
      }
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
