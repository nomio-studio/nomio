import { BLOCK_ID_TO_TYPE, BLOCK_TYPE, BLOCK_TYPE_TO_ID, type BlockType } from "./blocks";
import {
  CHUNK_HEIGHT,
  CHUNK_MIN_Y,
  CHUNK_SIZE,
  CHUNK_VOLUME,
  chunkCoordinate,
  chunkIndex,
  chunkKey,
  isValidBlockType,
  localCoordinate,
  type ChunkCoordinate,
  type VoxelChunk,
} from "./chunk-types";
import type { Aabb, BlockCell, BlockId, VoxelPosition } from "./types";

const countSolidBlocks = (blocks: Uint8Array): number => {
  let count = 0;
  for (const value of blocks) {
    if (value !== BLOCK_TYPE.AIR) {
      count += 1;
    }
  }
  return count;
};

export class VoxelWorld {
  private readonly chunks = new Map<string, VoxelChunk>();
  private readonly editedChunks = new Map<string, Uint8Array>();
  private readonly dirtyChunks = new Set<string>();
  private blockCount = 0;

  public constructor(cells: Iterable<BlockCell> = []) {
    this.replace(cells);
  }

  public replace(cells: Iterable<BlockCell>): void {
    this.clear();
    for (const cell of cells) {
      this.set(cell, cell.id);
    }
  }

  public clear(): void {
    this.chunks.clear();
    this.editedChunks.clear();
    this.dirtyChunks.clear();
    this.blockCount = 0;
  }

  public setChunk(chunk: VoxelChunk): void {
    const key = chunkKey(chunk);
    const edited = this.editedChunks.get(key);
    const blocks = edited ?? chunk.blocks;
    if (blocks.length !== CHUNK_VOLUME) {
      throw new Error(`Chunk ${chunk.x},${chunk.z} has an invalid buffer length`);
    }
    for (const value of blocks) {
      if (!isValidBlockType(value)) {
        throw new Error(`Chunk ${chunk.x},${chunk.z} contains an invalid block type`);
      }
    }

    const previous = this.chunks.get(key);
    if (previous) {
      this.blockCount -= countSolidBlocks(previous.blocks);
    }
    this.chunks.set(key, { x: chunk.x, z: chunk.z, blocks });
    this.blockCount += countSolidBlocks(blocks);
  }

  public removeChunk(coordinate: { x: number; z: number }): boolean {
    const key = chunkKey(coordinate);
    const chunk = this.chunks.get(key);
    if (!chunk) {
      return false;
    }
    this.blockCount -= countSolidBlocks(chunk.blocks);
    this.chunks.delete(key);
    return true;
  }

  public getEditedChunk(coordinate: { x: number; z: number }): VoxelChunk | null {
    const blocks = this.editedChunks.get(chunkKey(coordinate));
    if (!blocks) {
      return null;
    }
    return { x: coordinate.x, z: coordinate.z, blocks };
  }

  /** Returns and clears the chunks changed since the last call. */
  public consumeDirtyChunks(): ChunkCoordinate[] {
    if (this.dirtyChunks.size === 0) {
      return [];
    }
    const coordinates: ChunkCoordinate[] = [];
    for (const key of this.dirtyChunks) {
      const [x, z] = key.split(",").map(Number);
      coordinates.push({ x, z });
    }
    this.dirtyChunks.clear();
    return coordinates;
  }

  public forEachChunk(callback: (chunk: VoxelChunk) => void): void {
    for (const chunk of this.chunks.values()) {
      callback(chunk);
    }
  }

  public getChunk(coordinate: { x: number; z: number }): VoxelChunk | null {
    return this.chunks.get(chunkKey(coordinate)) ?? null;
  }

  public get(position: VoxelPosition): BlockId | null {
    return BLOCK_TYPE_TO_ID[this.getBlockType(position)] ?? null;
  }

  public getBlockType(position: VoxelPosition): BlockType {
    if (position.y < CHUNK_MIN_Y || position.y >= CHUNK_MIN_Y + CHUNK_HEIGHT) {
      return BLOCK_TYPE.AIR;
    }

    const chunkX = chunkCoordinate(position.x);
    const chunkZ = chunkCoordinate(position.z);
    const chunk = this.chunks.get(chunkKey({ x: chunkX, z: chunkZ }));
    if (!chunk) {
      return BLOCK_TYPE.AIR;
    }

    return chunk.blocks[
      chunkIndex(localCoordinate(position.x), position.y, localCoordinate(position.z))
    ] as BlockType;
  }

  public has(position: VoxelPosition): boolean {
    return this.getBlockType(position) !== BLOCK_TYPE.AIR;
  }

  public set(position: VoxelPosition, id: BlockId): void {
    const blockType = BLOCK_ID_TO_TYPE[id];
    if (position.y < CHUNK_MIN_Y || position.y >= CHUNK_MIN_Y + CHUNK_HEIGHT) {
      return;
    }

    const coordinate = { x: chunkCoordinate(position.x), z: chunkCoordinate(position.z) };
    const key = chunkKey(coordinate);
    let chunk = this.chunks.get(key);
    if (!chunk) {
      chunk = { ...coordinate, blocks: new Uint8Array(CHUNK_VOLUME) };
      this.chunks.set(key, chunk);
    }

    const index = chunkIndex(localCoordinate(position.x), position.y, localCoordinate(position.z));
    const previous = chunk.blocks[index] as BlockType;
    if (previous === blockType) {
      return;
    }
    this.markEdited(key, chunk.blocks);
    if (previous === BLOCK_TYPE.AIR && blockType !== BLOCK_TYPE.AIR) {
      this.blockCount += 1;
    } else if (previous !== BLOCK_TYPE.AIR && blockType === BLOCK_TYPE.AIR) {
      this.blockCount -= 1;
    }
    chunk.blocks[index] = blockType;
  }

  public remove(position: VoxelPosition): BlockId | null {
    const previous = this.get(position);
    if (previous) {
      this.setBlockType(position, BLOCK_TYPE.AIR);
    }
    return previous;
  }

  public forEach(callback: (cell: BlockCell) => void): void {
    this.forEachChunk((chunk) => {
      for (let localY = 0; localY < CHUNK_HEIGHT; localY += 1) {
        for (let localZ = 0; localZ < CHUNK_SIZE; localZ += 1) {
          for (let localX = 0; localX < CHUNK_SIZE; localX += 1) {
            const blockType = chunk.blocks[
              chunkIndex(localX, CHUNK_MIN_Y + localY, localZ)
            ] as BlockType;
            const id = BLOCK_TYPE_TO_ID[blockType];
            if (!id) {
              continue;
            }
            callback({
              x: chunk.x * CHUNK_SIZE + localX,
              y: CHUNK_MIN_Y + localY,
              z: chunk.z * CHUNK_SIZE + localZ,
              id,
            });
          }
        }
      }
    });
  }

  public toArray(): BlockCell[] {
    const cells: BlockCell[] = [];
    this.forEach((cell) => cells.push(cell));
    return cells;
  }

  public get size(): number {
    return this.blockCount;
  }

  public canOccupy(bounds: Aabb): boolean {
    const minX = Math.floor(bounds.min.x);
    const maxX = Math.ceil(bounds.max.x);
    const minY = Math.floor(bounds.min.y);
    const maxY = Math.ceil(bounds.max.y);
    const minZ = Math.floor(bounds.min.z);
    const maxZ = Math.ceil(bounds.max.z);

    for (let x = minX; x < maxX; x += 1) {
      for (let y = minY; y < maxY; y += 1) {
        for (let z = minZ; z < maxZ; z += 1) {
          if (this.getBlockType({ x, y, z }) === BLOCK_TYPE.AIR) {
            continue;
          }

          const overlapsX = bounds.max.x > x + 0.001 && bounds.min.x < x + 0.999;
          const overlapsY = bounds.max.y > y + 0.001 && bounds.min.y < y + 0.999;
          const overlapsZ = bounds.max.z > z + 0.001 && bounds.min.z < z + 0.999;
          if (overlapsX && overlapsY && overlapsZ) {
            return false;
          }
        }
      }
    }

    return true;
  }

  private setBlockType(position: VoxelPosition, blockType: BlockType): void {
    const id = BLOCK_TYPE_TO_ID[blockType];
    if (id) {
      this.set(position, id);
      return;
    }

    if (position.y < CHUNK_MIN_Y || position.y >= CHUNK_MIN_Y + CHUNK_HEIGHT) {
      return;
    }
    const chunk = this.chunks.get(
      chunkKey({ x: chunkCoordinate(position.x), z: chunkCoordinate(position.z) }),
    );
    if (!chunk) {
      return;
    }
    const index = chunkIndex(localCoordinate(position.x), position.y, localCoordinate(position.z));
    if (chunk.blocks[index] !== BLOCK_TYPE.AIR) {
      this.markEdited(chunkKey(chunk), chunk.blocks);
      chunk.blocks[index] = BLOCK_TYPE.AIR;
      this.blockCount -= 1;
    }
  }

  private markEdited(key: string, blocks: Uint8Array): void {
    if (!this.editedChunks.has(key)) {
      this.editedChunks.set(key, blocks);
    }
    this.dirtyChunks.add(key);
  }
}
