import * as THREE from "three";
import type { BlockId, BlockTarget, VoxelPosition } from "./types";
import { offsetVoxel } from "./types";
import type { VoxelWorld } from "./world";
import type { VoxelWorldRenderer } from "./world-renderer";

export interface InteractorOptions {
  getPlayerBounds: () => { min: THREE.Vector3; max: THREE.Vector3 };
  onWorldChanged?: () => void;
}

export class VoxelInteractor {
  private readonly raycaster = new THREE.Raycaster();
  private readonly screenCenter = new THREE.Vector2(0, 0);
  private target: BlockTarget | null = null;

  public constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly world: VoxelWorld,
    private readonly renderer: VoxelWorldRenderer,
    private readonly options: InteractorOptions,
  ) {
    this.raycaster.far = 7;
  }

  public update(): void {
    this.raycaster.setFromCamera(this.screenCenter, this.camera);
    this.target = this.renderer.pick(this.raycaster);
    this.renderer.showTarget(this.target);
  }

  public breakTarget(): boolean {
    if (!this.target || this.world.remove(this.target.position) === null) {
      return false;
    }

    this.changed();
    return true;
  }

  public placeBlock(id: BlockId): boolean {
    if (!this.target) {
      return false;
    }

    const position = offsetVoxel(this.target.position, this.target.normal);
    if (this.world.has(position) || this.isInsidePlayer(position)) {
      return false;
    }

    this.world.set(position, id);
    this.changed();
    return true;
  }

  public get currentTarget(): BlockTarget | null {
    return this.target;
  }

  private isInsidePlayer(position: VoxelPosition): boolean {
    const player = this.options.getPlayerBounds();
    const blockMin = new THREE.Vector3(position.x, position.y, position.z);
    const blockMax = blockMin.clone().addScalar(1);
    return (
      player.max.x > blockMin.x &&
      player.min.x < blockMax.x &&
      player.max.y > blockMin.y &&
      player.min.y < blockMax.y &&
      player.max.z > blockMin.z &&
      player.min.z < blockMax.z
    );
  }

  private changed(): void {
    this.renderer.sync();
    this.options.onWorldChanged?.();
    this.update();
  }
}
