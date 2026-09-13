import * as THREE from "three";
import { DEFAULT_BLOCK_REGISTRY, type BlockRegistry } from "./block-registry";
import { BLOCK_TYPE_TO_ID } from "./blocks";
import {
  CHUNK_MIN_Y,
  CHUNK_SIZE,
  chunkCoordinate,
  chunkKey,
  type ChunkCoordinate,
  type ChunkMeshBuffers,
} from "./chunk-types";
import { BlockTextureAtlas } from "./texture-atlas";
import { BREAK_STAGES, createBreakStageTexture } from "./procedural-textures";
import type { TextureFace } from "./texture-types";
import { voxelKey, type BlockTarget } from "./types";
import type { FogController } from "./fog";
import type { GlobalIllumination } from "./global-illumination";
import { ACCENT_COLOR } from "../ui/tokens";

const TARGET_EPSILON = 0.001;
const FACE_BY_INDEX: readonly TextureFace[] = ["side", "top", "bottom"];
// Ambient occlusion brightness per AO level (0 = most occluded). Kept gentle so
// creases read as soft contact shadows instead of black trenches.
const AO_SHADE: readonly number[] = [0.72, 0.83, 0.93, 1.0];
// Baked sky/block light is applied to indirect (ambient) light only, so direct
// sunlight never goes pitch black; this sets the darkest ambient fraction.
const AMBIENT_FLOOR = 0.6;
// Quad corners are emitted in (u, v) parameter order: (0,0), (1,0), (1,1), (0,1).
const CORNER_U = [0, 1, 1, 0] as const;
const CORNER_V = [0, 0, 1, 1] as const;

export interface VoxelWorldRendererOptions {
  shadowChunkRadius?: number;
  fog?: FogController | null;
  gi?: GlobalIllumination | null;
}

export class VoxelWorldRenderer {
  private readonly group = new THREE.Group();
  private readonly blockGeometry = new THREE.BoxGeometry(1, 1, 1);
  private readonly highlight: THREE.LineSegments;
  private readonly breakOverlay: THREE.Mesh;
  private readonly breakTextures: THREE.CanvasTexture[];
  private readonly textureAtlas: BlockTextureAtlas;
  private readonly chunkMeshes = new Map<string, THREE.Mesh>();
  private readonly materials: THREE.MeshStandardMaterial[];
  private readonly shadowChunkRadius: number;
  private breakTargetKey: string | null = null;
  private breakStage = -1;
  private breakPulse = 0;
  private focus: ChunkCoordinate | null = null;

  public constructor(
    private readonly scene: THREE.Scene,
    private readonly registry: BlockRegistry = DEFAULT_BLOCK_REGISTRY,
    options: VoxelWorldRendererOptions = {},
  ) {
    this.shadowChunkRadius = options.shadowChunkRadius ?? 3;
    this.group.name = "voxel-world";
    this.scene.add(this.group);

    this.textureAtlas = new BlockTextureAtlas(
      this.registry,
      options.fog ?? null,
      options.gi ?? null,
    );
    this.materials = [...this.textureAtlas.materials];

    const highlightMaterial = new THREE.LineBasicMaterial({
      color: ACCENT_COLOR,
      transparent: true,
    });
    this.highlight = new THREE.LineSegments(
      new THREE.EdgesGeometry(this.blockGeometry),
      highlightMaterial,
    );
    this.highlight.name = "target-highlight";
    this.highlight.scale.setScalar(1.04);
    this.highlight.visible = false;
    this.scene.add(this.highlight);

    // The destroy overlay is a hair larger than the block so the crack texture
    // sits on the surface without z-fighting; alpha keeps the block showing
    // through between the fissures.
    this.breakTextures = Array.from({ length: BREAK_STAGES }, (_, stage) =>
      createBreakStageTexture(stage),
    );
    this.breakOverlay = new THREE.Mesh(
      new THREE.BoxGeometry(1.01, 1.01, 1.01),
      new THREE.MeshBasicMaterial({
        map: this.breakTextures[0] ?? null,
        transparent: true,
        depthWrite: false,
        alphaTest: 0.02,
        fog: false,
        side: THREE.DoubleSide,
      }),
    );
    this.breakOverlay.name = "break-overlay";
    this.breakOverlay.visible = false;
    this.breakOverlay.renderOrder = 2;
    this.scene.add(this.breakOverlay);
  }

  /** Applies a precomputed chunk mesh, building its GPU geometry on the main thread. */
  public applyMesh(coordinate: ChunkCoordinate, mesh: ChunkMeshBuffers): void {
    const key = chunkKey(coordinate);
    const geometry = this.createGeometry(mesh);
    const existing = this.chunkMeshes.get(key);

    if (existing) {
      existing.geometry.dispose();
      if (geometry) {
        existing.geometry = geometry;
      } else {
        this.group.remove(existing);
        this.chunkMeshes.delete(key);
      }
      return;
    }

    if (!geometry) {
      return;
    }

    const object = new THREE.Mesh(geometry, this.materials);
    object.position.set(coordinate.x * CHUNK_SIZE, CHUNK_MIN_Y, coordinate.z * CHUNK_SIZE);
    object.castShadow = this.isShadowCaster(coordinate);
    object.receiveShadow = true;
    object.frustumCulled = true;
    object.matrixAutoUpdate = false;
    object.updateMatrix();
    this.group.add(object);
    this.chunkMeshes.set(key, object);
  }

  public removeChunk(coordinate: ChunkCoordinate): void {
    const key = chunkKey(coordinate);
    const mesh = this.chunkMeshes.get(key);
    if (!mesh) {
      return;
    }
    mesh.geometry.dispose();
    this.group.remove(mesh);
    this.chunkMeshes.delete(key);
  }

  public clear(): void {
    for (const mesh of this.chunkMeshes.values()) {
      mesh.geometry.dispose();
      this.group.remove(mesh);
    }
    this.chunkMeshes.clear();
  }

  /** Moves the shadow-casting band and returns true when the focus chunk changed. */
  public setShadowFocus(position: { x: number; z: number }): boolean {
    const next = { x: chunkCoordinate(position.x), z: chunkCoordinate(position.z) };
    if (this.focus && this.focus.x === next.x && this.focus.z === next.z) {
      return false;
    }
    this.focus = next;
    for (const [key, mesh] of this.chunkMeshes) {
      mesh.castShadow = this.isShadowCaster(parseChunkKey(key));
    }
    return true;
  }

  public pick(raycaster: THREE.Raycaster): BlockTarget | null {
    const intersections = raycaster.intersectObjects(this.group.children, false);
    const hit = intersections[0];
    if (!hit || !(hit.object instanceof THREE.Mesh) || !hit.face) {
      return null;
    }

    const normal = {
      x: Math.round(hit.face.normal.x),
      y: Math.round(hit.face.normal.y),
      z: Math.round(hit.face.normal.z),
    };
    return {
      position: {
        x: Math.floor(hit.point.x - normal.x * TARGET_EPSILON),
        y: Math.floor(hit.point.y - normal.y * TARGET_EPSILON),
        z: Math.floor(hit.point.z - normal.z * TARGET_EPSILON),
      },
      normal,
    };
  }

  public showTarget(target: BlockTarget | null): void {
    if (!target) {
      this.highlight.visible = false;
      return;
    }

    this.highlight.position.set(
      target.position.x + 0.5,
      target.position.y + 0.5,
      target.position.z + 0.5,
    );
    this.highlight.visible = true;
  }

  /** Draws the destroy-stage crack overlay on the aimed block at `progress` 0..1. */
  public showBreakOverlay(target: BlockTarget | null, progress: number): void {
    const material = this.breakOverlay.material as THREE.MeshBasicMaterial;
    if (!target || progress <= 0) {
      this.breakOverlay.visible = false;
      this.breakOverlay.scale.setScalar(1);
      this.breakTargetKey = null;
      this.breakStage = -1;
      this.breakPulse = 0;
      material.opacity = 0;
      return;
    }

    const stage = Math.min(BREAK_STAGES - 1, Math.max(0, Math.floor(progress * BREAK_STAGES)));
    const targetKey = voxelKey(target.position);
    if (targetKey !== this.breakTargetKey || stage !== this.breakStage) {
      this.breakTargetKey = targetKey;
      this.breakStage = stage;
      this.breakPulse = 1;
    }
    const texture = this.breakTextures[stage];
    if (texture && material.map !== texture) {
      material.map = texture;
      material.needsUpdate = true;
    }

    this.breakOverlay.position.set(
      target.position.x + 0.5,
      target.position.y + 0.5,
      target.position.z + 0.5,
    );
    material.opacity = 0.28 + Math.min(1, progress) * 0.58;
    this.breakOverlay.visible = true;
  }

  /** Eases the short impact pulse applied whenever a crack stage advances. */
  public updateBreakFeedback(delta: number): void {
    if (!this.breakOverlay.visible) {
      return;
    }
    this.breakPulse = Math.max(0, this.breakPulse - delta * 8);
    this.breakOverlay.scale.setScalar(1 + this.breakPulse * 0.018);
  }

  public dispose(): void {
    this.clear();
    this.blockGeometry.dispose();
    this.highlight.geometry.dispose();
    (this.highlight.material as THREE.Material).dispose();
    this.breakOverlay.geometry.dispose();
    (this.breakOverlay.material as THREE.Material).dispose();
    for (const texture of this.breakTextures) {
      texture.dispose();
    }
    this.textureAtlas.dispose();
    this.scene.remove(this.group, this.highlight, this.breakOverlay);
  }

  private isShadowCaster(coordinate: ChunkCoordinate): boolean {
    if (!this.focus) {
      return true;
    }
    return (
      Math.max(Math.abs(coordinate.x - this.focus.x), Math.abs(coordinate.z - this.focus.z)) <=
      this.shadowChunkRadius
    );
  }

  private createGeometry(mesh: ChunkMeshBuffers): THREE.BufferGeometry | null {
    if (mesh.quadCount === 0) {
      return null;
    }

    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const lights: number[] = [];
    const indirects: number[] = [];
    const indices: number[] = [];
    const buckets = new Map<number, number[]>();

    for (let quad = 0; quad < mesh.quadCount; quad += 1) {
      const id = BLOCK_TYPE_TO_ID[mesh.blockType[quad]];
      if (!id) {
        continue;
      }
      const materialIndex = this.textureAtlas.getMaterialIndex(id);
      const bucket = buckets.get(materialIndex);
      if (bucket) {
        bucket.push(quad);
      } else {
        buckets.set(materialIndex, [quad]);
      }
    }

    const geometry = new THREE.BufferGeometry();
    for (const [materialIndex, quads] of buckets) {
      const start = indices.length;
      for (const quad of quads) {
        this.appendQuad(quad, mesh, positions, normals, uvs, lights, indirects, indices);
      }
      geometry.addGroup(start, indices.length - start, materialIndex);
    }

    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setAttribute("aLight", new THREE.Float32BufferAttribute(lights, 2));
    geometry.setAttribute("aIndirect", new THREE.Float32BufferAttribute(indirects, 3));
    geometry.setIndex(indices);
    geometry.computeBoundingSphere();
    return geometry;
  }

  private appendQuad(
    quad: number,
    mesh: ChunkMeshBuffers,
    positions: number[],
    normals: number[],
    uvs: number[],
    lights: number[],
    indirects: number[],
    indices: number[],
  ): void {
    const id = BLOCK_TYPE_TO_ID[mesh.blockType[quad]];
    if (!id) {
      return;
    }
    const tile = this.textureAtlas.getFaceUv(id, FACE_BY_INDEX[mesh.textureFace[quad]]);

    const o = quad * 3;
    const originX = mesh.origin[o];
    const originY = mesh.origin[o + 1];
    const originZ = mesh.origin[o + 2];
    const uX = mesh.u[o] * mesh.width[quad];
    const uY = mesh.u[o + 1] * mesh.width[quad];
    const uZ = mesh.u[o + 2] * mesh.width[quad];
    const vX = mesh.v[o] * mesh.height[quad];
    const vY = mesh.v[o + 1] * mesh.height[quad];
    const vZ = mesh.v[o + 2] * mesh.height[quad];

    const baseIndex = positions.length / 3;
    positions.push(
      originX,
      originY,
      originZ,
      originX + uX,
      originY + uY,
      originZ + uZ,
      originX + uX + vX,
      originY + uY + vY,
      originZ + uZ + vZ,
      originX + vX,
      originY + vY,
      originZ + vZ,
    );

    const normalX = mesh.normal[o];
    const normalY = mesh.normal[o + 1];
    const normalZ = mesh.normal[o + 2];
    normals.push(
      normalX,
      normalY,
      normalZ,
      normalX,
      normalY,
      normalZ,
      normalX,
      normalY,
      normalZ,
      normalX,
      normalY,
      normalZ,
    );

    if (normalY === 0) {
      // Vertical faces must show the texture upright and unmirrored: its vertical
      // axis follows world up and its horizontal axis follows the viewer's right.
      // Which tangent is the vertical one, and whether the horizontal one points
      // right, depends on the face normal, so derive the corner UVs from the
      // tangents rather than assuming a fixed order. (For +X and -Z the mesher's
      // v tangent is horizontal, which otherwise draws the texture sideways.)
      const uIsVertical = Math.abs(mesh.u[o + 1]) > Math.abs(mesh.v[o + 1]);
      const vertical = uIsVertical ? CORNER_U : CORNER_V;
      const horizontal = uIsVertical ? CORNER_V : CORNER_U;
      const tangentX = uIsVertical ? mesh.v[o] : mesh.u[o];
      const tangentZ = uIsVertical ? mesh.v[o + 2] : mesh.u[o + 2];
      // Viewer-right across a vertical face is (normalZ, 0, -normalX).
      const pointsRight = tangentX * normalZ - tangentZ * normalX > 0;
      for (let corner = 0; corner < 4; corner += 1) {
        const s = pointsRight ? horizontal[corner] : 1 - horizontal[corner];
        uvs.push(tile.u + s * tile.width, tile.v + vertical[corner] * tile.height);
      }
    } else {
      uvs.push(
        tile.u,
        tile.v,
        tile.u + tile.width,
        tile.v,
        tile.u + tile.width,
        tile.v + tile.height,
        tile.u,
        tile.v + tile.height,
      );
    }

    // Per-vertex smooth lighting: AO darkness and propagated light, applied to
    // indirect light in the shader so direct sun stays bright and shadows soften.
    for (let corner = 0; corner < 4; corner += 1) {
      const ao = AO_SHADE[mesh.ao[quad * 4 + corner]];
      const light = AMBIENT_FLOOR + (1 - AMBIENT_FLOOR) * (mesh.light[quad * 4 + corner] / 15);
      lights.push(ao, light);

      const packed = mesh.indirect[quad * 4 + corner];
      indirects.push(((packed >> 8) & 15) / 15, ((packed >> 4) & 15) / 15, (packed & 15) / 15);
    }

    indices.push(baseIndex, baseIndex + 1, baseIndex + 2, baseIndex, baseIndex + 2, baseIndex + 3);
  }
}

const parseChunkKey = (key: string): ChunkCoordinate => {
  const [x, z] = key.split(",").map(Number);
  return { x, z };
};
