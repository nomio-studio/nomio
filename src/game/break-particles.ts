import * as THREE from "three";
import type { VoxelPosition } from "./types";

/** Returns true when the integer voxel at these coordinates is solid. */
export type SolidSampler = (x: number, y: number, z: number) => boolean;

interface Shard {
  x: number;
  y: number;
  z: number;
  velocityX: number;
  velocityY: number;
  velocityZ: number;
  yaw: number;
  pitch: number;
  roll: number;
  spinYaw: number;
  spinPitch: number;
  spinRoll: number;
  life: number;
  maxLife: number;
  sizeX: number;
  sizeY: number;
  sizeZ: number;
  /** The block the shard was knocked from; collisions ignore it so chips escape. */
  sourceX: number;
  sourceY: number;
  sourceZ: number;
  active: boolean;
}

/** Downward acceleration on fragments, in blocks per second squared. */
const PARTICLE_GRAVITY = 24;
/** Fraction of speed a fragment keeps when it hits terrain. */
const BOUNCE = 0.34;
/** Horizontal speed retained per ground contact. */
const FRICTION = 0.66;
/** Vertical speed below which a contact stops bouncing and settles. */
const SETTLE_SPEED = 0.5;
/** Edge length of a fragment at spawn, in blocks. */
const PARTICLE_SIZE = 0.15;
/** Fragments thrown when a block finally breaks. */
const BURST_COUNT = 20;
/** Frames the spawn pop takes to reach full size, in seconds. */
const SPAWN_GROW = 0.07;

/**
 * Debris for block breaks. A single `InstancedMesh` of thin tetrahedral shards
 * carries every fragment, so a break costs one draw call regardless of how many
 * pieces fly. Shards spawn across the block volume and drift outward, tumble,
 * fall, and bounce off terrain before settling and fading; chips can also crumble
 * off while a block is still being mined. Per-instance colors come from the
 * broken block's texture palette, so wood splinters brown and stone chips grey.
 * Fragments are recycled round-robin, which keeps the pool bounded without
 * per-burst searches.
 */
export class BreakParticles {
  // Four-sided shards are cheaper than cubes and read less like duplicated dice.
  private readonly geometry = new THREE.TetrahedronGeometry(0.82, 0);
  private readonly material = new THREE.MeshLambertMaterial({
    flatShading: true,
    fog: false,
    vertexColors: true,
  });
  private readonly mesh: THREE.InstancedMesh;
  private readonly shards: Shard[] = [];
  private readonly matrix = new THREE.Matrix4();
  private readonly quaternion = new THREE.Quaternion();
  private readonly euler = new THREE.Euler();
  private readonly position = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();
  private readonly color = new THREE.Color();
  private cursor = 0;
  private alive = false;

  public constructor(
    private readonly scene: THREE.Scene,
    private readonly isSolid: SolidSampler,
    private readonly capacity = 192,
  ) {
    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.name = "break-particles";
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;

    for (let index = 0; index < capacity; index += 1) {
      const shard: Shard = {
        x: 0,
        y: 0,
        z: 0,
        velocityX: 0,
        velocityY: 0,
        velocityZ: 0,
        yaw: 0,
        pitch: 0,
        roll: 0,
        spinYaw: 0,
        spinPitch: 0,
        spinRoll: 0,
        life: 0,
        maxLife: 1,
        sizeX: 0,
        sizeY: 0,
        sizeZ: 0,
        sourceX: 0,
        sourceY: 0,
        sourceZ: 0,
        active: false,
      };
      this.shards.push(shard);
      this.writeTransform(shard, index, 0);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.scene.add(this.mesh);
  }

  /** Throws a full burst of tinted fragments from a freshly broken block. */
  public burst(
    position: VoxelPosition,
    palette: readonly number[],
    random: () => number = Math.random,
  ): void {
    this.emit(position, palette, BURST_COUNT, 3.1, 1, random);
  }

  /** Knocks a single small chip loose, e.g. while a block is still being mined. */
  public chip(
    position: VoxelPosition,
    palette: readonly number[],
    random: () => number = Math.random,
  ): void {
    this.emit(position, palette, 1, 1.7, 0.72, random);
  }

  /** Integrates live fragments and retires expired ones. */
  public update(delta: number): void {
    if (!this.alive) {
      return;
    }

    let anyAlive = false;
    for (let index = 0; index < this.capacity; index += 1) {
      const shard = this.shards[index] as Shard;
      if (!shard.active) {
        continue;
      }

      shard.life -= delta;
      if (shard.life <= 0) {
        shard.active = false;
        this.writeTransform(shard, index, 0);
        continue;
      }

      anyAlive = true;
      shard.velocityY -= PARTICLE_GRAVITY * delta;
      this.integrate(shard, delta);
      shard.yaw += shard.spinYaw * delta;
      shard.pitch += shard.spinPitch * delta;
      shard.roll += shard.spinRoll * delta;

      const elapsed = shard.maxLife - shard.life;
      const grow = Math.min(1, elapsed / SPAWN_GROW);
      const remaining = shard.life / shard.maxLife;
      const fade = remaining < 0.4 ? remaining / 0.4 : 1;
      this.writeTransform(shard, index, grow * fade);
    }

    this.mesh.instanceMatrix.needsUpdate = true;
    this.alive = anyAlive;
  }

  /** Retires every fragment, e.g. when the world resets. */
  public clear(): void {
    for (let index = 0; index < this.capacity; index += 1) {
      const shard = this.shards[index] as Shard;
      shard.active = false;
      this.writeTransform(shard, index, 0);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.alive = false;
  }

  public dispose(): void {
    this.scene.remove(this.mesh);
    this.mesh.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }

  private emit(
    position: VoxelPosition,
    palette: readonly number[],
    count: number,
    power: number,
    sizeScale: number,
    random: () => number,
  ): void {
    if (palette.length === 0) {
      return;
    }
    for (let piece = 0; piece < count; piece += 1) {
      const index = this.cursor;
      this.cursor = (this.cursor + 1) % this.capacity;
      this.spawn(this.shards[index] as Shard, index, position, palette, power, sizeScale, random);
    }
    this.alive = true;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) {
      this.mesh.instanceColor.needsUpdate = true;
    }
  }

  private spawn(
    shard: Shard,
    index: number,
    position: VoxelPosition,
    palette: readonly number[],
    power: number,
    sizeScale: number,
    random: () => number,
  ): void {
    const centreX = position.x + 0.5;
    const centreY = position.y + 0.5;
    const centreZ = position.z + 0.5;
    shard.x = position.x + 0.18 + random() * 0.64;
    shard.y = position.y + 0.18 + random() * 0.64;
    shard.z = position.z + 0.18 + random() * 0.64;
    shard.sourceX = position.x;
    shard.sourceY = position.y;
    shard.sourceZ = position.z;

    // Outward from the block centre, mostly along the ground plane, plus lift.
    let directionX = shard.x - centreX;
    let directionY = shard.y - centreY;
    let directionZ = shard.z - centreZ;
    const length = Math.hypot(directionX, directionY, directionZ) || 1;
    directionX /= length;
    directionY /= length;
    directionZ /= length;
    const speed = power * (0.55 + random() * 0.95);
    shard.velocityX = directionX * speed + (random() - 0.5) * 0.9;
    shard.velocityY = Math.abs(directionY) * speed * 0.5 + 1.2 + random() * 1.8;
    shard.velocityZ = directionZ * speed + (random() - 0.5) * 0.9;

    shard.yaw = random() * Math.PI * 2;
    shard.pitch = random() * Math.PI * 2;
    shard.roll = random() * Math.PI * 2;
    shard.spinYaw = (random() - 0.5) * 14;
    shard.spinPitch = (random() - 0.5) * 14;
    shard.spinRoll = (random() - 0.5) * 14;

    // Flat, irregular chips read as flakes rather than tumbling dice.
    const base = PARTICLE_SIZE * sizeScale * (0.5 + random() * 1.1);
    shard.sizeX = base;
    shard.sizeY = base * (0.55 + random() * 0.5);
    shard.sizeZ = base;
    const thinAxis = Math.floor(random() * 3);
    if (thinAxis === 0) {
      shard.sizeX *= 0.32;
    } else if (thinAxis === 1) {
      shard.sizeY *= 0.32;
    } else {
      shard.sizeZ *= 0.32;
    }

    shard.maxLife = 0.6 + random() * 0.55;
    shard.life = shard.maxLife;

    const tint = palette[Math.floor(random() * palette.length)] ?? palette[0] ?? 0x888888;
    this.color
      .setHex(tint)
      .offsetHSL((random() - 0.5) * 0.03, (random() - 0.5) * 0.12, (random() - 0.5) * 0.26);
    this.mesh.setColorAt(index, this.color);
    this.writeTransform(shard, index, 0);
  }

  /** Axis-separated integration so fragments slide and bounce off voxels. */
  private integrate(shard: Shard, delta: number): void {
    const nextX = shard.x + shard.velocityX * delta;
    if (this.blocked(shard, nextX, shard.y, shard.z)) {
      shard.velocityX = -shard.velocityX * BOUNCE;
    } else {
      shard.x = nextX;
    }

    const nextY = shard.y + shard.velocityY * delta;
    if (this.blocked(shard, shard.x, nextY, shard.z)) {
      if (shard.velocityY < 0) {
        shard.velocityY = Math.abs(shard.velocityY) < SETTLE_SPEED ? 0 : -shard.velocityY * BOUNCE;
        shard.velocityX *= FRICTION;
        shard.velocityZ *= FRICTION;
        shard.spinYaw *= FRICTION;
        shard.spinPitch *= FRICTION;
        shard.spinRoll *= FRICTION;
      } else {
        shard.velocityY = -shard.velocityY * BOUNCE;
      }
    } else {
      shard.y = nextY;
    }

    const nextZ = shard.z + shard.velocityZ * delta;
    if (this.blocked(shard, shard.x, shard.y, nextZ)) {
      shard.velocityZ = -shard.velocityZ * BOUNCE;
    } else {
      shard.z = nextZ;
    }
  }

  private blocked(shard: Shard, x: number, y: number, z: number): boolean {
    const cellX = Math.floor(x);
    const cellY = Math.floor(y);
    const cellZ = Math.floor(z);
    // The source block is ignored so chips can escape a block still being mined.
    if (cellX === shard.sourceX && cellY === shard.sourceY && cellZ === shard.sourceZ) {
      return false;
    }
    return this.isSolid(cellX, cellY, cellZ);
  }

  private writeTransform(shard: Shard, index: number, scale: number): void {
    this.position.set(shard.x, shard.y, shard.z);
    this.euler.set(shard.pitch, shard.yaw, shard.roll);
    this.quaternion.setFromEuler(this.euler);
    this.scale.set(
      Math.max(0, shard.sizeX * scale),
      Math.max(0, shard.sizeY * scale),
      Math.max(0, shard.sizeZ * scale),
    );
    this.matrix.compose(this.position, this.quaternion, this.scale);
    this.mesh.setMatrixAt(index, this.matrix);
  }
}
