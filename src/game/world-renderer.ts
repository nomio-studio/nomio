import * as THREE from "three";
import { BLOCK_DEFINITIONS } from "./blocks";
import { type BlockMaterialSet, ProceduralTextureFactory } from "./procedural-textures";
import type { BlockId, BlockTarget, VoxelPosition } from "./types";
import type { VoxelWorld } from "./world";

interface BlockMeshData {
  position: VoxelPosition;
}

export class VoxelWorldRenderer {
  private readonly group = new THREE.Group();
  private readonly blockGeometry = new THREE.BoxGeometry(1, 1, 1);
  private readonly highlight: THREE.LineSegments;
  private readonly textureFactory = new ProceduralTextureFactory();
  private readonly materialSets = new Map<BlockId, BlockMaterialSet>();

  public constructor(
    private readonly scene: THREE.Scene,
    private readonly world: VoxelWorld,
  ) {
    this.group.name = "voxel-world";
    this.scene.add(this.group);

    for (const definition of Object.values(BLOCK_DEFINITIONS)) {
      this.materialSets.set(definition.id, this.textureFactory.createMaterialSet(definition));
    }

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
    this.group.clear();

    this.world.forEach((cell) => {
      const materialSet = this.materialSets.get(cell.id);
      if (!materialSet) {
        return;
      }

      const mesh = new THREE.Mesh(this.blockGeometry, materialSet.materials);
      mesh.position.set(cell.x + 0.5, cell.y + 0.5, cell.z + 0.5);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData = { position: { x: cell.x, y: cell.y, z: cell.z } } satisfies BlockMeshData;
      this.group.add(mesh);
    });
  }

  public pick(raycaster: THREE.Raycaster): BlockTarget | null {
    const intersections = raycaster.intersectObjects(this.group.children, false);
    const hit = intersections[0];
    if (!hit || !(hit.object instanceof THREE.Mesh)) {
      return null;
    }

    const data = hit.object.userData as Partial<BlockMeshData>;
    if (!data.position || !hit.face) {
      return null;
    }

    return {
      position: { ...data.position },
      normal: {
        x: Math.round(hit.face.normal.x),
        y: Math.round(hit.face.normal.y),
        z: Math.round(hit.face.normal.z),
      },
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
    this.blockGeometry.dispose();
    this.highlight.geometry.dispose();
    (this.highlight.material as THREE.Material).dispose();
    for (const materialSet of this.materialSets.values()) {
      this.textureFactory.disposeMaterialSet(materialSet);
    }
    this.scene.remove(this.group, this.highlight);
  }
}
