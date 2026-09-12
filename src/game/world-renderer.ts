import * as THREE from "three";
import { DEFAULT_BLOCK_REGISTRY, type BlockRegistry } from "./block-registry";
import { BLOCK_TYPE_TO_ID } from "./blocks";
import { CHUNK_MIN_Y, CHUNK_SIZE, chunkKey, type VoxelChunk } from "./chunk-types";
import { buildGreedyMesh, type GreedyQuad } from "./greedy-mesher";
import { BlockTextureAtlas } from "./texture-atlas";
import type { BlockTarget } from "./types";
import type { VoxelWorld } from "./world";

const TARGET_EPSILON = 0.001;

export class VoxelWorldRenderer {
  private readonly group = new THREE.Group();
  private readonly blockGeometry = new THREE.BoxGeometry(1, 1, 1);
  private readonly highlight: THREE.LineSegments;
  private readonly textureAtlas: BlockTextureAtlas;
  private readonly chunkMeshes = new Map<string, THREE.Mesh>();
  private readonly materials: THREE.MeshStandardMaterial[];

  public constructor(
    private readonly scene: THREE.Scene,
    private readonly world: VoxelWorld,
    private readonly registry: BlockRegistry = DEFAULT_BLOCK_REGISTRY,
  ) {
    this.group.name = "voxel-world";
    this.scene.add(this.group);

    this.textureAtlas = new BlockTextureAtlas(registry);
    this.materials = registry.ids.map((id) => this.textureAtlas.getMaterial(id));

    const highlightMaterial = new THREE.LineBasicMaterial({ color: 0xf27b63, transparent: true });
    this.highlight = new THREE.LineSegments(
      new THREE.EdgesGeometry(this.blockGeometry),
      highlightMaterial,
    );
    this.highlight.name = "target-highlight";
    this.highlight.scale.setScalar(1.04);
    this.highlight.visible = false;
    this.scene.add(this.highlight);

    this.sync();
  }

  public sync(): void {
    for (const mesh of this.chunkMeshes.values()) {
      mesh.geometry.dispose();
      this.group.remove(mesh);
    }
    this.chunkMeshes.clear();

    this.world.forEachChunk((chunk) => {
      const geometry = this.createChunkGeometry(chunk);
      if (!geometry) {
        return;
      }

      const mesh = new THREE.Mesh(geometry, this.materials);
      mesh.position.set(chunk.x * CHUNK_SIZE, CHUNK_MIN_Y, chunk.z * CHUNK_SIZE);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      this.chunkMeshes.set(chunkKey(chunk), mesh);
    });
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

  public dispose(): void {
    for (const mesh of this.chunkMeshes.values()) {
      mesh.geometry.dispose();
    }
    this.chunkMeshes.clear();
    this.blockGeometry.dispose();
    this.highlight.geometry.dispose();
    (this.highlight.material as THREE.Material).dispose();
    this.textureAtlas.dispose();
    this.scene.remove(this.group, this.highlight);
  }

  private createChunkGeometry(chunk: VoxelChunk): THREE.BufferGeometry | null {
    const mesh = buildGreedyMesh(chunk, (x, y, z) => this.world.getBlockType({ x, y, z }));
    if (mesh.quads.length === 0) {
      return null;
    }

    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    const groups = new Map<number, { start: number; count: number }>();
    const quadsByMaterial = new Map<number, GreedyQuad[]>();

    for (const quad of mesh.quads) {
      const id = BLOCK_TYPE_TO_ID[quad.blockType];
      if (!id) {
        continue;
      }
      const materialIndex = this.registry.indexOf(id);
      if (materialIndex < 0) {
        throw new Error(`Block ${id} is missing from the renderer registry`);
      }
      const bucket = quadsByMaterial.get(materialIndex) ?? [];
      bucket.push(quad);
      quadsByMaterial.set(materialIndex, bucket);
    }

    for (const [materialIndex, quads] of quadsByMaterial) {
      const start = indices.length;
      for (const quad of quads) {
        this.appendQuad(quad, BLOCK_TYPE_TO_ID[quad.blockType]!, positions, normals, uvs, indices);
      }
      groups.set(materialIndex, { start, count: indices.length - start });
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    for (const [materialIndex, group] of groups) {
      geometry.addGroup(group.start, group.count, materialIndex);
    }
    geometry.computeBoundingSphere();
    return geometry;
  }

  private appendQuad(
    quad: GreedyQuad,
    id: NonNullable<(typeof BLOCK_TYPE_TO_ID)[number]>,
    positions: number[],
    normals: number[],
    uvs: number[],
    indices: number[],
  ): void {
    const tile = this.textureAtlas.getFaceUv(id, quad.textureFace);
    const baseIndex = positions.length / 3;
    const vertices: readonly [number, number, number][] = [
      this.quadVertex(quad, 0, 0),
      this.quadVertex(quad, 1, 0),
      this.quadVertex(quad, 1, 1),
      this.quadVertex(quad, 0, 1),
    ];
    for (const vertex of vertices) {
      positions.push(...vertex);
      normals.push(...quad.normal);
    }

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
    indices.push(baseIndex, baseIndex + 1, baseIndex + 2, baseIndex, baseIndex + 2, baseIndex + 3);
  }

  private quadVertex(quad: GreedyQuad, u: number, v: number): [number, number, number] {
    return [
      quad.origin[0] + quad.u[0] * quad.width * u + quad.v[0] * quad.height * v,
      quad.origin[1] + quad.u[1] * quad.width * u + quad.v[1] * quad.height * v,
      quad.origin[2] + quad.u[2] * quad.width * u + quad.v[2] * quad.height * v,
    ];
  }
}
