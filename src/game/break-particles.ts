import * as THREE from "three";
import type { VoxelPosition } from "./types";

interface Particle {
  x: number;
  y: number;
  z: number;
  velocityX: number;
  velocityY: number;
  velocityZ: number;
  yaw: number;
  pitch: number;
  spinYaw: number;
  spinPitch: number;
  life: number;
  maxLife: number;
  scale: number;
  active: boolean;
}

/** Downward acceleration on fragments, in blocks per second squared. */
const PARTICLE_GRAVITY = 16;
/** Edge length of a fragment at spawn, in blocks. */
const PARTICLE_SIZE = 0.15;
/** Fragments thrown per broken block. */
const BURST_SIZE = 12;

/**
 * Cheap pooled debris for block breaks. A single `InstancedMesh` of small cubes
 * carries every fragment; per-instance colors take the broken block's tint, so a
 * break costs one draw call regardless of how many pieces fly. Fragments are
 * recycled round-robin, which keeps the pool bounded without per-burst searches.
 */
export class BreakParticles {
  private readonly geometry = new THREE.BoxGeometry(1, 1, 1);
  private readonly material = new THREE.MeshLambertMaterial({ fog: false });
  private readonly mesh: THREE.InstancedMesh;
  private readonly particles: Particle[] = [];
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
    private readonly capacity = 96,
  ) {
    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.name = "break-particles";
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;

    for (let index = 0; index < capacity; index += 1) {
      const particle: Particle = {
        x: 0,
        y: 0,
        z: 0,
        velocityX: 0,
        velocityY: 0,
        velocityZ: 0,
        yaw: 0,
        pitch: 0,
        spinYaw: 0,
        spinPitch: 0,
        life: 0,
        maxLife: 1,
        scale: 0,
        active: false,
      };
      this.particles.push(particle);
      this.writeTransform(particle, index, 0);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.scene.add(this.mesh);
  }

  /** Throws a burst of tinted fragments from the broken block's centre. */
  public burst(position: VoxelPosition, color: number, random: () => number = Math.random): void {
    for (let count = 0; count < BURST_SIZE; count += 1) {
      const index = this.cursor;
      this.cursor = (this.cursor + 1) % this.capacity;
      this.spawn(this.particles[index] as Particle, index, position, color, random);
    }
    this.alive = true;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) {
      this.mesh.instanceColor.needsUpdate = true;
    }
  }

  /** Integrates live fragments and retires expired ones. */
  public update(delta: number): void {
    if (!this.alive) {
      return;
    }

    let anyAlive = false;
    for (let index = 0; index < this.capacity; index += 1) {
      const particle = this.particles[index] as Particle;
      if (!particle.active) {
        continue;
      }

      particle.life -= delta;
      if (particle.life <= 0) {
        particle.active = false;
        this.writeTransform(particle, index, 0);
        continue;
      }

      anyAlive = true;
      particle.velocityY -= PARTICLE_GRAVITY * delta;
      particle.x += particle.velocityX * delta;
      particle.y += particle.velocityY * delta;
      particle.z += particle.velocityZ * delta;
      particle.yaw += particle.spinYaw * delta;
      particle.pitch += particle.spinPitch * delta;

      const remaining = particle.life / particle.maxLife;
      const fade = remaining < 0.35 ? remaining / 0.35 : 1;
      this.writeTransform(particle, index, particle.scale * fade);
    }

    this.mesh.instanceMatrix.needsUpdate = true;
    this.alive = anyAlive;
  }

  /** Retires every fragment, e.g. when the world resets. */
  public clear(): void {
    for (let index = 0; index < this.capacity; index += 1) {
      const particle = this.particles[index] as Particle;
      particle.active = false;
      this.writeTransform(particle, index, 0);
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

  private spawn(
    particle: Particle,
    index: number,
    position: VoxelPosition,
    color: number,
    random: () => number,
  ): void {
    particle.active = true;
    particle.x = position.x + 0.5 + (random() - 0.5) * 0.7;
    particle.y = position.y + 0.5 + (random() - 0.5) * 0.7;
    particle.z = position.z + 0.5 + (random() - 0.5) * 0.7;

    const angle = random() * Math.PI * 2;
    const speed = 0.8 + random() * 1.8;
    particle.velocityX = Math.cos(angle) * speed;
    particle.velocityZ = Math.sin(angle) * speed;
    particle.velocityY = 1.6 + random() * 2.4;

    particle.yaw = random() * Math.PI * 2;
    particle.pitch = random() * Math.PI * 2;
    particle.spinYaw = (random() - 0.5) * 12;
    particle.spinPitch = (random() - 0.5) * 12;
    particle.maxLife = 0.45 + random() * 0.4;
    particle.life = particle.maxLife;
    particle.scale = PARTICLE_SIZE * (0.5 + random() * 0.9);

    // A little lightness spread keeps the debris from reading as one flat color.
    this.color.setHex(color).multiplyScalar(0.75 + random() * 0.5);
    this.mesh.setColorAt(index, this.color);
    this.writeTransform(particle, index, particle.scale);
  }

  private writeTransform(particle: Particle, index: number, scale: number): void {
    this.position.set(particle.x, particle.y, particle.z);
    this.euler.set(particle.pitch, particle.yaw, 0);
    this.quaternion.setFromEuler(this.euler);
    this.scale.setScalar(Math.max(0, scale));
    this.matrix.compose(this.position, this.quaternion, this.scale);
    this.mesh.setMatrixAt(index, this.matrix);
  }
}
