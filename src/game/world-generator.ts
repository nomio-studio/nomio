import type { BlockCell, VoxelPosition } from "./types";
import { VoxelWorld } from "./world";

const putColumn = (cells: BlockCell[], position: VoxelPosition, depth: number): void => {
  for (let y = -depth; y <= 0; y += 1) {
    const id = y === 0 ? "grass" : y === -1 ? "dirt" : "stone";
    cells.push({
      x: position.x,
      y: position.y + y,
      z: position.z,
      id,
    });
  }
};

const putTree = (cells: BlockCell[], x: number, z: number): void => {
  for (let y = 1; y <= 3; y += 1) {
    cells.push({ x, y, z, id: "oak_log" });
  }

  for (let leafX = -2; leafX <= 2; leafX += 1) {
    for (let leafZ = -2; leafZ <= 2; leafZ += 1) {
      if (Math.abs(leafX) + Math.abs(leafZ) > 3) {
        continue;
      }
      cells.push({ x: x + leafX, y: 3, z: z + leafZ, id: "leaves" });
    }
  }
  cells.push({ x, y: 4, z, id: "leaves" });
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

  putTree(cells, -4, 2);
  cells.push({ x: 2, y: 1, z: 3, id: "cobblestone" });
  cells.push({ x: 3, y: 1, z: 3, id: "mossy_cobblestone" });
  cells.push({ x: 2, y: 1, z: 4, id: "oak_planks" });

  return new VoxelWorld(cells);
};
