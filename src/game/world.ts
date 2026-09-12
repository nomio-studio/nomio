import * as THREE from "three";
import type { Aabb, BlockCell, BlockId, VoxelPosition } from "./types";
import { voxelKey } from "./types";

export class VoxelWorld {
  private readonly blocks = new Map<string, BlockId>();

  public constructor(cells: BlockCell[] = []) {
    for (const cell of cells) {
      this.set(cell, cell.id);
    }
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
      const [x, y, z] = key.split(",").map(Number);
      callback({ x, y, z, id });
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

  public static playerBounds(position: THREE.Vector3): Aabb {
    const halfWidth = 0.3;
    return {
      min: new THREE.Vector3(position.x - halfWidth, position.y, position.z - halfWidth),
      max: new THREE.Vector3(position.x + halfWidth, position.y + 1.8, position.z + halfWidth),
    };
  }
}
