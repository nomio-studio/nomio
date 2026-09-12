import type { Aabb, BlockCell, BlockId, VoxelPosition } from "./types";
import { parseVoxelKey, voxelKey } from "./types";

export class VoxelWorld {
  private readonly blocks = new Map<string, BlockId>();

  public constructor(cells: Iterable<BlockCell> = []) {
    this.replace(cells);
  }

  public replace(cells: Iterable<BlockCell>): void {
    this.blocks.clear();
    for (const cell of cells) {
      this.set(cell, cell.id);
    }
  }

  public toArray(): BlockCell[] {
    const cells: BlockCell[] = [];
    this.forEach((cell) => cells.push(cell));
    return cells;
  }

  public get(position: VoxelPosition): BlockId | null {
    return this.blocks.get(voxelKey(position)) ?? null;
  }

  public has(position: VoxelPosition): boolean {
    return this.blocks.has(voxelKey(position));
  }

  public set(position: VoxelPosition, id: BlockId): void {
    this.blocks.set(voxelKey(position), id);
  }

  public remove(position: VoxelPosition): BlockId | null {
    const key = voxelKey(position);
    const block = this.blocks.get(key) ?? null;
    this.blocks.delete(key);
    return block;
  }

  public forEach(callback: (cell: BlockCell) => void): void {
    for (const [key, id] of this.blocks) {
      callback({ ...parseVoxelKey(key), id });
    }
  }

  public get size(): number {
    return this.blocks.size;
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
          if (!this.has({ x, y, z })) {
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
}
