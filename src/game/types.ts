import type * as THREE from "three";

export type BlockId =
  | "grass"
  | "dirt"
  | "stone"
  | "cobblestone"
  | "sand"
  | "oak_log"
  | "oak_planks"
  | "leaves"
  | "glass"
  | "bricks"
  | "snow"
  | "netherrack"
  | "obsidian"
  | "coal_ore"
  | "iron_ore"
  | "mossy_cobblestone"
  | "crystal";

export interface VoxelPosition {
  x: number;
  y: number;
  z: number;
}

export interface BlockCell extends VoxelPosition {
  id: BlockId;
}

export interface Aabb {
  min: THREE.Vector3;
  max: THREE.Vector3;
}

export interface BlockTarget {
  position: VoxelPosition;
  normal: VoxelPosition;
}

export const voxelKey = (position: VoxelPosition): string =>
  `${position.x},${position.y},${position.z}`;

export const sameVoxel = (first: VoxelPosition, second: VoxelPosition): boolean =>
  first.x === second.x && first.y === second.y && first.z === second.z;

export const offsetVoxel = (position: VoxelPosition, offset: VoxelPosition): VoxelPosition => ({
  x: position.x + offset.x,
  y: position.y + offset.y,
  z: position.z + offset.z,
});
