import { BLOCK_TYPE, type BlockType } from "./blocks";
import { CHUNK_HEIGHT, CHUNK_MIN_Y, CHUNK_SIZE, chunkIndex, type VoxelChunk } from "./chunk-types";
import type { TextureFace } from "./texture-types";

type Axis = 0 | 1 | 2;
type Vector3Tuple = readonly [number, number, number];

interface FaceDefinition {
  readonly axis: Axis;
  readonly sign: -1 | 1;
  readonly uAxis: Axis;
  readonly vAxis: Axis;
  readonly normal: Vector3Tuple;
  readonly textureFace: TextureFace;
}

export interface GreedyQuad {
  readonly blockType: BlockType;
  readonly origin: Vector3Tuple;
  readonly u: Vector3Tuple;
  readonly v: Vector3Tuple;
  readonly normal: Vector3Tuple;
  readonly width: number;
  readonly height: number;
  readonly textureFace: TextureFace;
}

export interface GreedyMesh {
  readonly quads: readonly GreedyQuad[];
}

const FACE_DEFINITIONS: readonly FaceDefinition[] = [
  { axis: 0, sign: 1, uAxis: 1, vAxis: 2, normal: [1, 0, 0], textureFace: "side" },
  { axis: 0, sign: -1, uAxis: 2, vAxis: 1, normal: [-1, 0, 0], textureFace: "side" },
  { axis: 1, sign: 1, uAxis: 2, vAxis: 0, normal: [0, 1, 0], textureFace: "top" },
  { axis: 1, sign: -1, uAxis: 0, vAxis: 2, normal: [0, -1, 0], textureFace: "bottom" },
  { axis: 2, sign: 1, uAxis: 0, vAxis: 1, normal: [0, 0, 1], textureFace: "side" },
  { axis: 2, sign: -1, uAxis: 1, vAxis: 0, normal: [0, 0, -1], textureFace: "side" },
];

const axisSize = (axis: Axis): number => (axis === 1 ? CHUNK_HEIGHT : CHUNK_SIZE);

const axisVector = (axis: Axis): Vector3Tuple => {
  if (axis === 0) {
    return [1, 0, 0];
  }
  if (axis === 1) {
    return [0, 1, 0];
  }
  return [0, 0, 1];
};

const localToWorld = (
  chunk: VoxelChunk,
  local: readonly [number, number, number],
): Vector3Tuple => [
  chunk.x * CHUNK_SIZE + local[0],
  CHUNK_MIN_Y + local[1],
  chunk.z * CHUNK_SIZE + local[2],
];

export const buildGreedyMesh = (
  chunk: VoxelChunk,
  getVoxel: (x: number, y: number, z: number) => BlockType,
): GreedyMesh => {
  const quads: GreedyQuad[] = [];

  for (const face of FACE_DEFINITIONS) {
    const depth = axisSize(face.axis);
    const widthSize = axisSize(face.uAxis);
    const heightSize = axisSize(face.vAxis);
    const mask = new Uint8Array(widthSize * heightSize);

    for (let slice = 0; slice < depth; slice += 1) {
      mask.fill(BLOCK_TYPE.AIR);
      for (let v = 0; v < heightSize; v += 1) {
        for (let u = 0; u < widthSize; u += 1) {
          const local: [number, number, number] = [0, 0, 0];
          local[face.axis] = slice;
          local[face.uAxis] = u;
          local[face.vAxis] = v;
          const [worldX, worldY, worldZ] = localToWorld(chunk, local);
          const current = chunk.blocks[chunkIndex(local[0], worldY, local[2])] as BlockType;
          const neighbor = getVoxel(
            worldX + face.normal[0],
            worldY + face.normal[1],
            worldZ + face.normal[2],
          );
          if (current !== BLOCK_TYPE.AIR && neighbor === BLOCK_TYPE.AIR) {
            mask[v * widthSize + u] = current;
          }
        }
      }

      for (let v = 0; v < heightSize; v += 1) {
        for (let u = 0; u < widthSize; u += 1) {
          const maskIndex = v * widthSize + u;
          const blockType = mask[maskIndex] as BlockType;
          if (blockType === BLOCK_TYPE.AIR) {
            continue;
          }

          let quadWidth = 1;
          while (u + quadWidth < widthSize && mask[v * widthSize + u + quadWidth] === blockType) {
            quadWidth += 1;
          }

          let quadHeight = 1;
          let canExtend = true;
          while (v + quadHeight < heightSize && canExtend) {
            for (let offset = 0; offset < quadWidth; offset += 1) {
              if (mask[(v + quadHeight) * widthSize + u + offset] !== blockType) {
                canExtend = false;
                break;
              }
            }
            if (canExtend) {
              quadHeight += 1;
            }
          }

          for (let offsetY = 0; offsetY < quadHeight; offsetY += 1) {
            for (let offsetX = 0; offsetX < quadWidth; offsetX += 1) {
              mask[(v + offsetY) * widthSize + u + offsetX] = BLOCK_TYPE.AIR;
            }
          }

          const localOrigin: [number, number, number] = [0, 0, 0];
          localOrigin[face.axis] = slice + (face.sign > 0 ? 1 : 0);
          localOrigin[face.uAxis] = u;
          localOrigin[face.vAxis] = v;
          quads.push({
            blockType,
            origin: localOrigin,
            u: axisVector(face.uAxis),
            v: axisVector(face.vAxis),
            normal: face.normal,
            width: quadWidth,
            height: quadHeight,
            textureFace: face.textureFace,
          });
        }
      }
    }
  }

  return { quads };
};
