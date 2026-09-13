import * as THREE from "three";
import type { AimPoint } from "./input";
import type { Aabb, BlockId, BlockTarget, VoxelPosition } from "./types";
import { offsetVoxel, sameVoxel, voxelKey } from "./types";
import type { VoxelWorld } from "./world";
import type { VoxelWorldRenderer } from "./world-renderer";

export interface InteractorOptions {
  getPlayerBounds: () => Aabb;
  maxDistance: number;
  onWorldChanged?: () => void;
}

export class VoxelInteractor {
  private readonly raycaster = new THREE.Raycaster();
  private readonly screenPoint = new THREE.Vector2(0, 0);
  private aim: AimPoint | null = null;
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

  /**
   * Re-picks the aimed block from a normalized-device-coordinate point. Passing
   * null means nothing is aimed (an idle touch device), which clears the target
   * highlight and any break overlay rather than falling back to screen centre.
   */
  public update(aim: AimPoint | null = null): void {
    this.aim = aim;
    if (!aim) {
      this.target = null;
      this.renderer.showTarget(null);
      this.renderer.showBreakOverlay(null, 0);
      return;
    }

    const nextTarget = this.pickAt(aim);
    const targetChanged =
      Boolean(this.target) !== Boolean(nextTarget) ||
      (this.target !== null &&
        nextTarget !== null &&
        !sameVoxel(this.target.position, nextTarget.position));
    if (targetChanged) {
      this.breakProgress = 0;
      this.breakKey = null;
    }
    this.target = nextTarget;
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

  /** Places `id` against the block currently aimed at (pointer-lock mice). */
  public placeBlock(id: BlockId): boolean {
    return this.placeAgainst(this.target, id);
  }

  /** Places `id` against the block under a tapped point (touch and pen). */
  public placeBlockAt(aim: AimPoint, id: BlockId): boolean {
    return this.placeAgainst(this.pickAt(aim), id);
  }

  public get currentTarget(): BlockTarget | null {
    return this.target;
  }

  private pickAt(aim: AimPoint): BlockTarget | null {
    this.screenPoint.set(aim.x, aim.y);
    this.raycaster.setFromCamera(this.screenPoint, this.camera);
    return this.renderer.pick(this.raycaster);
  }

  private placeAgainst(target: BlockTarget | null, id: BlockId): boolean {
    if (!target) {
      return false;
    }

    const position = offsetVoxel(target.position, target.normal);
    if (this.world.has(position) || this.isInsidePlayer(position)) {
      return false;
    }

    this.world.set(position, id);
    this.changed();
    return true;
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
    this.update(this.aim);
  }
}
