import { BLOCK_TYPE, type BlockType } from "./blocks";
import { buildPaddedBlocks, computePaddedLight, PADDED_SIZE, paddedIndex } from "./chunk-lighting";
import { DEFAULT_LIGHTING, type LightingConfig } from "./config";
import {
  CHUNK_HEIGHT,
  CHUNK_MIN_Y,
  CHUNK_SIZE,
  type ChunkMeshBuffers,
  type ChunkMeshNeighbors,
  type VoxelChunk,
} from "./chunk-types";
import { buildGreedyMesh } from "./greedy-mesher";
import type { TextureFace } from "./texture-types";

const FACE_INDEX: Readonly<Record<TextureFace, number>> = { side: 0, top: 1, bottom: 2 };

/**
 * Builds a padded block volume, propagates sky/colored/indirect light through
 * it, then runs the greedy mesher with per-vertex AO, light, and indirect RGB.
 * Everything returned is transferable so the work stays off the main thread.
 */
export const meshVoxelChunk = (
  chunk: VoxelChunk,
  neighbors: ChunkMeshNeighbors,
  lighting: LightingConfig = DEFAULT_LIGHTING,
): ChunkMeshBuffers => {
  const padded = buildPaddedBlocks(chunk, neighbors);
  const light = computePaddedLight(padded, lighting);
  const originX = chunk.x * CHUNK_SIZE;
  const originZ = chunk.z * CHUNK_SIZE;

  const localIndex = (worldX: number, worldY: number, worldZ: number): number => {
    const px = worldX - originX + 1;
    const pz = worldZ - originZ + 1;
    const py = worldY - CHUNK_MIN_Y;
    if (px < 0 || px >= PADDED_SIZE || pz < 0 || pz >= PADDED_SIZE) {
      return -1;
    }
    if (py < 0 || py >= CHUNK_HEIGHT) {
      return -1;
    }
    return paddedIndex(px, py, pz);
  };

  const getVoxel = (worldX: number, worldY: number, worldZ: number): BlockType => {
    const index = localIndex(worldX, worldY, worldZ);
    return index < 0 ? BLOCK_TYPE.AIR : (padded[index] as BlockType);
  };

  const getLight = (worldX: number, worldY: number, worldZ: number): number => {
    const index = localIndex(worldX, worldY, worldZ);
    return index < 0 ? 0 : (light.sky[index] << 4) | light.block[index];
  };

  const getIndirect = (worldX: number, worldY: number, worldZ: number): number => {
    const index = localIndex(worldX, worldY, worldZ);
    if (index < 0) {
      return 0;
    }
    const base = index * 3;
    return (light.indirect[base] << 8) | (light.indirect[base + 1] << 4) | light.indirect[base + 2];
  };

  const { quads } = buildGreedyMesh(chunk, getVoxel, getLight, getIndirect);
  const quadCount = quads.length;
  const buffers: ChunkMeshBuffers = {
    quadCount,
    blockType: new Uint8Array(quadCount),
    textureFace: new Uint8Array(quadCount),
    origin: new Float32Array(quadCount * 3),
    u: new Int8Array(quadCount * 3),
    v: new Int8Array(quadCount * 3),
    normal: new Int8Array(quadCount * 3),
    width: new Uint8Array(quadCount),
    height: new Uint8Array(quadCount),
    ao: new Uint8Array(quadCount * 4),
    light: new Uint8Array(quadCount * 4),
    indirect: new Uint16Array(quadCount * 4),
  };

  for (let i = 0; i < quadCount; i += 1) {
    const quad = quads[i];
    buffers.blockType[i] = quad.blockType;
    buffers.textureFace[i] = FACE_INDEX[quad.textureFace];
    buffers.origin[i * 3] = quad.origin[0];
    buffers.origin[i * 3 + 1] = quad.origin[1];
    buffers.origin[i * 3 + 2] = quad.origin[2];
    buffers.u[i * 3] = quad.u[0];
    buffers.u[i * 3 + 1] = quad.u[1];
    buffers.u[i * 3 + 2] = quad.u[2];
    buffers.v[i * 3] = quad.v[0];
    buffers.v[i * 3 + 1] = quad.v[1];
    buffers.v[i * 3 + 2] = quad.v[2];
    buffers.normal[i * 3] = quad.normal[0];
    buffers.normal[i * 3 + 1] = quad.normal[1];
    buffers.normal[i * 3 + 2] = quad.normal[2];
    buffers.width[i] = quad.width;
    buffers.height[i] = quad.height;
    for (let corner = 0; corner < 4; corner += 1) {
      buffers.ao[i * 4 + corner] = quad.ao[corner];
      buffers.light[i * 4 + corner] = quad.light[corner];
      buffers.indirect[i * 4 + corner] = quad.indirect[corner];
    }
  }

  return buffers;
};

export const meshTransferables = (mesh: ChunkMeshBuffers): ArrayBuffer[] => [
  mesh.blockType.buffer as ArrayBuffer,
  mesh.textureFace.buffer as ArrayBuffer,
  mesh.origin.buffer as ArrayBuffer,
  mesh.u.buffer as ArrayBuffer,
  mesh.v.buffer as ArrayBuffer,
  mesh.normal.buffer as ArrayBuffer,
  mesh.width.buffer as ArrayBuffer,
  mesh.height.buffer as ArrayBuffer,
  mesh.ao.buffer as ArrayBuffer,
  mesh.light.buffer as ArrayBuffer,
  mesh.indirect.buffer as ArrayBuffer,
];
