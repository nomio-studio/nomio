import * as THREE from "three";
import type { InputState } from "./input";
import { VoxelWorld } from "./world";

export class PlayerController {
  public readonly position = new THREE.Vector3(0.5, 1, 5.5);
  public readonly spawnPoint = new THREE.Vector3(0.5, 1, 5.5);
  public grounded = false;

  private yaw = 0;
  private pitch = -0.08;
  private verticalVelocity = 0;

  public constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly world: VoxelWorld,
  ) {
    this.camera.rotation.order = "YXZ";
    this.syncCamera();
  }

  public update(delta: number, input: InputState): void {
    this.yaw -= input.lookX * 0.0022;
    this.pitch = THREE.MathUtils.clamp(this.pitch - input.lookY * 0.0022, -1.35, 1.35);

    const movement = new THREE.Vector3(input.moveX, 0, -input.moveZ);
    if (movement.lengthSq() > 1) {
      movement.normalize();
    }

    const forward = new THREE.Vector3(Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, Math.sin(this.yaw));
    const direction = new THREE.Vector3()
      .addScaledVector(right, movement.x)
      .addScaledVector(forward, movement.z);

    const speed = 4.2;
    this.moveHorizontal(direction.x * speed * delta, direction.z * speed * delta);

    if (input.jump && this.grounded) {
      this.verticalVelocity = 6.4;
      this.grounded = false;
    }

    this.verticalVelocity -= 18 * delta;
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
    const nextX = this.position.clone();
    nextX.x += deltaX;
    if (this.world.canOccupy(VoxelWorld.playerBounds(nextX))) {
      this.position.x = nextX.x;
    }

    const nextZ = this.position.clone();
    nextZ.z += deltaZ;
    if (this.world.canOccupy(VoxelWorld.playerBounds(nextZ))) {
      this.position.z = nextZ.z;
    }
  }

  private moveVertical(deltaY: number): void {
    const next = this.position.clone();
    next.y += deltaY;
    if (this.world.canOccupy(VoxelWorld.playerBounds(next))) {
      this.position.y = next.y;
      this.grounded = false;
      return;
    }

    if (this.verticalVelocity < 0) {
      this.grounded = true;
    }
    this.verticalVelocity = 0;
  }

  private syncCamera(): void {
    this.camera.position.set(this.position.x, this.position.y + 1.62, this.position.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0);
  }
}
