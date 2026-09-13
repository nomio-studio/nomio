import * as THREE from "three";
import type { PlayerConfig } from "./config";
import type { InputState } from "./input";
import type { Aabb } from "./types";
import type { VoxelWorld } from "./world";

export class PlayerController {
  public readonly position = new THREE.Vector3();
  public readonly spawnPoint = new THREE.Vector3();
  public grounded = false;
  /** Multiplier over the configured look sensitivity, tuned from settings. */
  public lookSensitivity: number;
  public invertLook = false;

  private yaw = 0;
  private pitch = -0.08;
  private verticalVelocity = 0;
  private readonly movement = new THREE.Vector3();
  private readonly forward = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly direction = new THREE.Vector3();
  private readonly nextPosition = new THREE.Vector3();
  private readonly boundsValue: Aabb = {
    min: new THREE.Vector3(),
    max: new THREE.Vector3(),
  };

  public constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly world: VoxelWorld,
    private readonly config: PlayerConfig,
  ) {
    this.spawnPoint.fromArray(config.spawn);
    this.position.copy(this.spawnPoint);
    this.lookSensitivity = config.lookSensitivity;
    this.camera.rotation.order = "YXZ";
    this.syncCamera();
  }

  public get bounds(): Aabb {
    return this.boundsFor(this.position);
  }

  public update(delta: number, input: InputState): void {
    this.yaw -= input.lookX * this.lookSensitivity;
    const pitchDelta = input.lookY * this.lookSensitivity * (this.invertLook ? 1 : -1);
    this.pitch = THREE.MathUtils.clamp(this.pitch + pitchDelta, -1.35, 1.35);

    this.movement.set(input.moveX, 0, input.moveZ);
    if (this.movement.lengthSq() > 1) {
      this.movement.normalize();
    }

    // Camera-relative basis. A Three.js camera looks down -Z, so after a yaw
    // rotation the ground-plane forward is (-sin, 0, -cos) and right is
    // (cos, 0, -sin). Deriving both from the same yaw keeps W/A/S/D aligned
    // with where the camera actually points at every heading.
    const sinYaw = Math.sin(this.yaw);
    const cosYaw = Math.cos(this.yaw);
    this.forward.set(-sinYaw, 0, -cosYaw);
    this.right.set(cosYaw, 0, -sinYaw);
    this.direction
      .set(0, 0, 0)
      .addScaledVector(this.right, this.movement.x)
      .addScaledVector(this.forward, this.movement.z);

    this.moveHorizontal(
      this.direction.x * this.config.speed * delta,
      this.direction.z * this.config.speed * delta,
    );

    if (input.jump && this.grounded) {
      this.verticalVelocity = this.config.jumpVelocity;
      this.grounded = false;
    }

    this.verticalVelocity -= this.config.gravity * delta;
    this.moveVertical(this.verticalVelocity * delta);
    this.syncCamera();
  }

  public reset(): void {
    this.position.copy(this.spawnPoint);
    this.verticalVelocity = 0;
    this.grounded = false;
    this.syncCamera();
  }

  private moveHorizontal(deltaX: number, deltaZ: number): void {
    if (deltaX !== 0) {
      this.nextPosition.copy(this.position);
      this.nextPosition.x += deltaX;
      if (this.world.canOccupy(this.boundsFor(this.nextPosition))) {
        this.position.x = this.nextPosition.x;
      } else {
        this.tryAutoJump(deltaX, 0);
      }
    }

    if (deltaZ !== 0) {
      this.nextPosition.copy(this.position);
      this.nextPosition.z += deltaZ;
      if (this.world.canOccupy(this.boundsFor(this.nextPosition))) {
        this.position.z = this.nextPosition.z;
      } else {
        this.tryAutoJump(0, deltaZ);
      }
    }
  }

  /**
   * Hops automatically when a horizontal step is blocked by an obstacle no taller
   * than `stepHeight`, so walking into a one-block ledge never stalls the player.
   * The raised probe also proves there is headroom, so a two-block wall still
   * simply blocks instead of triggering a hopeless jump.
   */
  private tryAutoJump(deltaX: number, deltaZ: number): void {
    if (!this.config.autoJump || !this.grounded) {
      return;
    }

    this.nextPosition.set(
      this.position.x + deltaX,
      this.position.y + this.config.stepHeight,
      this.position.z + deltaZ,
    );
    if (!this.world.canOccupy(this.boundsFor(this.nextPosition))) {
      return;
    }

    this.verticalVelocity = this.config.jumpVelocity;
    this.grounded = false;
  }

  private moveVertical(deltaY: number): void {
    this.nextPosition.copy(this.position);
    this.nextPosition.y += deltaY;
    if (this.world.canOccupy(this.boundsFor(this.nextPosition))) {
      this.position.y = this.nextPosition.y;
      this.grounded = false;
      return;
    }

    if (this.verticalVelocity < 0) {
      this.grounded = true;
    }
    this.verticalVelocity = 0;
  }

  private syncCamera(): void {
    this.camera.position.set(
      this.position.x,
      this.position.y + this.config.eyeHeight,
      this.position.z,
    );
    this.camera.rotation.set(this.pitch, this.yaw, 0);
  }

  private boundsFor(position: THREE.Vector3): Aabb {
    const halfWidth = this.config.width / 2;
    this.boundsValue.min.set(position.x - halfWidth, position.y, position.z - halfWidth);
    this.boundsValue.max.set(
      position.x + halfWidth,
      position.y + this.config.height,
      position.z + halfWidth,
    );
    return this.boundsValue;
  }
}
