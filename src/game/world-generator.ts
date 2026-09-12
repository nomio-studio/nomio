import type { BlockCell, VoxelPosition } from "./types";
import { VoxelWorld } from "./world";

const putColumn = (cells: BlockCell[], position: VoxelPosition, depth: number): void => {
  for (let y = -depth; y <= 0; y += 1) {
    cells.push({
      x: position.x,
      y: position.y + y,
      z: position.z,
      id: y === 0 ? "grass" : "stone",
    });
  }
};

export const createStarterWorld = (): VoxelWorld => {
  const cells: BlockCell[] = [];

  for (let x = -7; x <= 7; x += 1) {
    for (let z = -7; z <= 7; z += 1) {
      const distance = Math.sqrt(x * x + z * z);
      if (distance > 7.15) {
        continue;
      }

      const depth = distance > 5.6 ? 0 : distance > 3.7 ? 1 : 2;
      putColumn(cells, { x, y: 0, z }, depth);
    }
  }

  const crystalSpots: VoxelPosition[] = [
    { x: -4, y: 1, z: -2 },
    { x: 3, y: 1, z: -3 },
    { x: 4, y: 1, z: 2 },
    { x: -2, y: 1, z: 4 },
  ];

  for (const spot of crystalSpots) {
    cells.push({ ...spot, id: "crystal" });
  }

  return new VoxelWorld(cells);
};
