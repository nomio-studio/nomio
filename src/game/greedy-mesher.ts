import { BLOCK_TYPE, type BlockType } from "./blocks";
import { CHUNK_HEIGHT, CHUNK_MIN_Y, CHUNK_SIZE, chunkIndex, type VoxelChunk } from "./chunk-types";
import type { TextureFace } from "./texture-types";

type Axis = 0 | 1 | 2;
type Vector3Tuple = readonly [number, number, number];
type Vector4Tuple = readonly [number, number, number, number];

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
  /** Per-vertex AO (0-3) in vertex order (0,0), (1,0), (1,1), (0,1). */
  readonly ao: Vector4Tuple;
  /** Per-vertex light (0-15), already combined sky/block. */
  readonly light: Vector4Tuple;
  /** Per-vertex indirect RGB, packed as (r<<8)|(g<<4)|b (4 bits per channel). */
  readonly indirect: Vector4Tuple;
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

const CORNER_U = [0, 1, 1, 0] as const;
const CORNER_V = [0, 0, 1, 1] as const;

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

// Encodes block type, the four corner AO values, and the four corner light
// values so greedy merging only combines cells that shade identically.
const encodeCell = (blockType: BlockType, ao: Vector4Tuple, light: Vector4Tuple): number =>
  blockType |
  (ao[0] << 5) |
  (ao[1] << 7) |
  (ao[2] << 9) |
  (ao[3] << 11) |
  (light[0] << 13) |
  (light[1] << 17) |
  (light[2] << 21) |
  (light[3] << 25);

const vertexAo = (side1: number, side2: number, corner: number): number =>
  side1 && side2 ? 0 : 3 - (side1 + side2 + corner);

export const buildGreedyMesh = (
  chunk: VoxelChunk,
  getVoxel: (x: number, y: number, z: number) => BlockType,
  getLight: (x: number, y: number, z: number) => number,
  getIndirect: (x: number, y: number, z: number) => number,
): GreedyMesh => {
  const quads: GreedyQuad[] = [];

  for (const face of FACE_DEFINITIONS) {
    const depth = axisSize(face.axis);
    const widthSize = axisSize(face.uAxis);
    const heightSize = axisSize(face.vAxis);
    const mask = new Array<number>(widthSize * heightSize).fill(0);
    const tangentU = axisVector(face.uAxis);
    const tangentV = axisVector(face.vAxis);
    const [normalX, normalY, normalZ] = face.normal;

    for (let slice = 0; slice < depth; slice += 1) {
      for (let v = 0; v < heightSize; v += 1) {
        for (let u = 0; u < widthSize; u += 1) {
          const local: [number, number, number] = [0, 0, 0];
          local[face.axis] = slice;
          local[face.uAxis] = u;
          local[face.vAxis] = v;
          const [worldX, worldY, worldZ] = localToWorld(chunk, local);
          const current = chunk.blocks[chunkIndex(local[0], worldY, local[2])] as BlockType;
          if (
            current === BLOCK_TYPE.AIR ||
            getVoxel(worldX + normalX, worldY + normalY, worldZ + normalZ) !== BLOCK_TYPE.AIR
          ) {
            continue;
          }

          const airX = worldX + normalX;
          const airY = worldY + normalY;
          const airZ = worldZ + normalZ;
          const ao: [number, number, number, number] = [0, 0, 0, 0];
          const light: [number, number, number, number] = [0, 0, 0, 0];

          for (let corner = 0; corner < 4; corner += 1) {
            const du = CORNER_U[corner] === 0 ? -1 : 1;
            const dv = CORNER_V[corner] === 0 ? -1 : 1;

            const ax = airX + tangentU[0] * du;
            const ay = airY + tangentU[1] * du;
            const az = airZ + tangentU[2] * du;
            const bx = airX + tangentV[0] * dv;
            const by = airY + tangentV[1] * dv;
            const bz = airZ + tangentV[2] * dv;
            const cx = ax + tangentV[0] * dv;
            const cy = ay + tangentV[1] * dv;
            const cz = az + tangentV[2] * dv;

            const side1 = getVoxel(ax, ay, az) !== BLOCK_TYPE.AIR ? 1 : 0;
            const side2 = getVoxel(bx, by, bz) !== BLOCK_TYPE.AIR ? 1 : 0;
            const cornerSolid = getVoxel(cx, cy, cz) !== BLOCK_TYPE.AIR ? 1 : 0;
            ao[corner] = vertexAo(side1, side2, cornerSolid);

            let skySum = 0;
            let blockSum = 0;
            let count = 0;
            const base = getLight(airX, airY, airZ);
            skySum += base >> 4;
            blockSum += base & 15;
            count += 1;
            if (!side1) {
              const packed = getLight(ax, ay, az);
              skySum += packed >> 4;
              blockSum += packed & 15;
              count += 1;
            }
            if (!side2) {
              const packed = getLight(bx, by, bz);
              skySum += packed >> 4;
              blockSum += packed & 15;
              count += 1;
            }
            if (!cornerSolid && side1 === 0 && side2 === 0) {
              const packed = getLight(cx, cy, cz);
              skySum += packed >> 4;
              blockSum += packed & 15;
              count += 1;
            }
            light[corner] = Math.max(Math.round(skySum / count), Math.round(blockSum / count));
          }

          mask[v * widthSize + u] = encodeCell(current, ao, light);
        }
      }

      for (let v = 0; v < heightSize; v += 1) {
        for (let u = 0; u < widthSize; u += 1) {
          const maskIndex = v * widthSize + u;
          const encoded = mask[maskIndex];
          if (encoded === 0) {
            continue;
          }

          let quadWidth = 1;
          while (u + quadWidth < widthSize && mask[v * widthSize + u + quadWidth] === encoded) {
            quadWidth += 1;
          }

          let quadHeight = 1;
          let canExtend = true;
          while (v + quadHeight < heightSize && canExtend) {
            for (let offset = 0; offset < quadWidth; offset += 1) {
              if (mask[(v + quadHeight) * widthSize + u + offset] !== encoded) {
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
              mask[(v + offsetY) * widthSize + u + offsetX] = 0;
            }
          }

          const localOrigin: [number, number, number] = [0, 0, 0];
          localOrigin[face.axis] = slice + (face.sign > 0 ? 1 : 0);
          localOrigin[face.uAxis] = u;
          localOrigin[face.vAxis] = v;

          // Sample the indirect light at the quad's anchor cell. It is not part
          // of the merge key, so it is only computed for emitted quads; merged
          // cells share the anchor's smooth gradient.
          const anchor: [number, number, number] = [0, 0, 0];
          anchor[face.axis] = slice;
          anchor[face.uAxis] = u;
          anchor[face.vAxis] = v;
          const [anchorX, anchorY, anchorZ] = localToWorld(chunk, anchor);
          const indirectAirX = anchorX + normalX;
          const indirectAirY = anchorY + normalY;
          const indirectAirZ = anchorZ + normalZ;
          const indirect: [number, number, number, number] = [0, 0, 0, 0];
          for (let corner = 0; corner < 4; corner += 1) {
            const du = CORNER_U[corner] === 0 ? -1 : 1;
            const dv = CORNER_V[corner] === 0 ? -1 : 1;
            const ax = indirectAirX + tangentU[0] * du;
            const ay = indirectAirY + tangentU[1] * du;
            const az = indirectAirZ + tangentU[2] * du;
            const bx = indirectAirX + tangentV[0] * dv;
            const by = indirectAirY + tangentV[1] * dv;
            const bz = indirectAirZ + tangentV[2] * dv;
            const cx = ax + tangentV[0] * dv;
            const cy = ay + tangentV[1] * dv;
            const cz = az + tangentV[2] * dv;

            const side1 = getVoxel(ax, ay, az) !== BLOCK_TYPE.AIR ? 1 : 0;
            const side2 = getVoxel(bx, by, bz) !== BLOCK_TYPE.AIR ? 1 : 0;
            const cornerSolid = getVoxel(cx, cy, cz) !== BLOCK_TYPE.AIR ? 1 : 0;

            let red = 0;
            let green = 0;
            let blue = 0;
            let count = 0;
            const add = (packed: number): void => {
              red += (packed >> 8) & 15;
              green += (packed >> 4) & 15;
              blue += packed & 15;
              count += 1;
            };
            add(getIndirect(indirectAirX, indirectAirY, indirectAirZ));
            if (!side1) {
              add(getIndirect(ax, ay, az));
            }
            if (!side2) {
              add(getIndirect(bx, by, bz));
            }
            if (!cornerSolid && side1 === 0 && side2 === 0) {
              add(getIndirect(cx, cy, cz));
            }
            indirect[corner] =
              (Math.round(red / count) << 8) |
              (Math.round(green / count) << 4) |
              Math.round(blue / count);
          }

          quads.push({
            blockType: (encoded & 31) as BlockType,
            origin: localOrigin,
            u: tangentU,
            v: tangentV,
            normal: face.normal,
            width: quadWidth,
            height: quadHeight,
            textureFace: face.textureFace,
            ao: [(encoded >> 5) & 3, (encoded >> 7) & 3, (encoded >> 9) & 3, (encoded >> 11) & 3],
            light: [
              (encoded >> 13) & 15,
              (encoded >> 17) & 15,
              (encoded >> 21) & 15,
              (encoded >> 25) & 15,
            ],
            indirect,
          });
        }
      }
    }
  }

  return { quads };
};
