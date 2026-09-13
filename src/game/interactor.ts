import * as THREE from "three";
import type { Aabb, BlockId, BlockTarget, VoxelPosition } from "./types";
import { offsetVoxel, voxelKey } from "./types";
import type { VoxelWorld } from "./world";
import type { VoxelWorldRenderer } from "./world-renderer";

export interface InteractorOptions {
  getPlayerBounds: () => Aabb;
  maxDistance: number;
  onWorldChanged?: () => void;
}

export class VoxelInteractor {
  private readonly raycaster = new THREE.Raycaster();
  private readonly screenCenter = new THREE.Vector2(0, 0);
  private target: BlockTarget | null = null;
  private breakProgress = 0;
  private breakKey: string | null = null;

  public constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly world: VoxelWorld,
    private readonly renderer: VoxelWorldRenderer,
    private readonly options: InteractorOptions,
  ) {
    this.raycaster.far = options.maxDistance;
  }

  public update(): void {
    this.raycaster.setFromCamera(this.screenCenter, this.camera);
    this.target = this.renderer.pick(this.raycaster);
    this.renderer.showTarget(this.target);
    this.renderer.showBreakOverlay(this.target, this.breakProgress);
  }

  /**
   * Advances mining on the aimed block. Progress is per-target, so looking away
   * or releasing the button restarts the next block from a clean crack. Returns
   * true on the frame the block finally gives way.
   */
  public advanceMining(delta: number, duration: number): boolean {
    if (!this.target) {
      this.clearMining();
      return false;
    }

    const key = voxelKey(this.target.position);
    if (key !== this.breakKey) {
      this.breakKey = key;
      this.breakProgress = 0;
    }

    this.breakProgress = Math.min(1, this.breakProgress + delta / Math.max(duration, 0.01));
    if (this.breakProgress < 1) {
      this.renderer.showBreakOverlay(this.target, this.breakProgress);
      return false;
    }

    this.breakProgress = 0;
    this.breakKey = null;
    return this.breakTarget();
  }

  /** Drops any partial mining, e.g. when the break button is released. */
  public clearMining(): void {
    if (this.breakProgress === 0 && this.breakKey === null) {
      return;
    }
    this.breakProgress = 0;
    this.breakKey = null;
    this.renderer.showBreakOverlay(this.target, 0);
  }

  public get miningProgress(): number {
    return this.breakProgress;
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
    this.options.onWorldChanged?.();
    this.update();
  }
}
