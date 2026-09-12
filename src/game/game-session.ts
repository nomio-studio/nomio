import * as THREE from "three";
import { DEFAULT_BLOCK_REGISTRY, type BlockRegistry } from "./block-registry";
import { createGameConfig, type GameConfig, type GameConfigOverrides } from "./config";
import { InputManager } from "./input";
import { VoxelInteractor } from "./interactor";
import { PlayerController } from "./player";
import { SceneRuntime } from "./scene-runtime";
import type { BlockId } from "./types";
import { createStarterWorld } from "./world-generator";
import type { VoxelWorld } from "./world";
import { VoxelWorldRenderer } from "./world-renderer";
import type { GameShell } from "../ui/game-shell";
import { Hud } from "../ui/hud";

export interface GameSessionOptions {
  shell: GameShell;
  registry?: BlockRegistry;
  config?: GameConfigOverrides;
  worldFactory?: () => VoxelWorld;
}

export class GameSession {
  private readonly config: GameConfig;
  private readonly registry: BlockRegistry;
  private readonly runtime: SceneRuntime;
  private readonly world: VoxelWorld;
  private readonly worldFactory: () => VoxelWorld;
  private readonly worldRenderer: VoxelWorldRenderer;
  private readonly player: PlayerController;
  private readonly input: InputManager;
  private readonly hud: Hud;
  private readonly interactor: VoxelInteractor;
  private readonly timer = new THREE.Timer();
  private readonly frame = (timestamp: number): void => this.tick(timestamp);

  private frameHandle: number | null = null;
  private running = false;
  private selectedIndex = 0;
  private selectedBlock: BlockId;

  public constructor(options: GameSessionOptions) {
    this.config = createGameConfig(options.config);
    this.registry = options.registry ?? DEFAULT_BLOCK_REGISTRY;
    const initialBlock = this.registry.ids[0];
    if (!initialBlock) {
      throw new Error("A game session requires at least one registered block");
    }
    this.selectedBlock = initialBlock;
    this.worldFactory = options.worldFactory ?? createStarterWorld;
    this.world = this.worldFactory();

    this.runtime = new SceneRuntime({ canvas: options.shell.canvas, config: this.config });
    this.worldRenderer = new VoxelWorldRenderer(this.runtime.scene, this.world, this.registry);
    this.player = new PlayerController(this.runtime.camera, this.world, this.config.player);
    this.hud = new Hud(options.shell.ui, {
      registry: this.registry,
      onSelectBlock: (id) => this.selectBlock(id),
      onReset: () => this.resetWorld(),
      onStart: () => this.input.requestPointerLock(),
      onAction: (action) => this.input.queueAction(action),
      onMoveButton: (direction, active) => this.input.setVirtualMove(direction, active),
    });
    this.input = new InputManager(options.shell.canvas, {
      onBlockHotkey: (slot) => this.selectBlockByIndex(slot),
      onCycleBlock: (direction) =>
        this.selectBlockByIndex(
          (this.selectedIndex + direction + this.registry.size) % this.registry.size,
        ),
      onPointerLockChange: (locked) => this.hud.setPointerLocked(locked),
    });
    this.interactor = new VoxelInteractor(this.runtime.camera, this.world, this.worldRenderer, {
      getPlayerBounds: () => this.player.bounds,
      maxDistance: this.config.interaction.maxDistance,
      onWorldChanged: () => this.hud.setBlockCount(this.world.size),
    });

    this.timer.connect(document);
    this.hud.selectBlock(this.selectedBlock);
    this.hud.setBlockCount(this.world.size);
    this.interactor.update();
  }

  public start(): void {
    if (this.running) {
      return;
    }

    this.running = true;
    this.timer.reset();
    this.frameHandle = window.requestAnimationFrame(this.frame);
  }

  public dispose(): void {
    this.stop();
    this.timer.dispose();
    this.input.dispose();
    this.hud.dispose();
    this.worldRenderer.dispose();
    this.runtime.dispose();
  }

  private stop(): void {
    this.running = false;
    if (this.frameHandle !== null) {
      window.cancelAnimationFrame(this.frameHandle);
      this.frameHandle = null;
    }
  }

  private tick(timestamp: number): void {
    if (!this.running) {
      return;
    }

    this.timer.update(timestamp);
    const delta = Math.min(this.timer.getDelta(), 0.05);
    const inputState = this.input.consume();

    this.player.update(delta, inputState);
    if (this.player.position.y < this.config.player.fallResetY) {
      this.player.reset();
    }

    this.interactor.update();
    for (const action of inputState.actions) {
      if (action === "break") {
        this.interactor.breakTarget();
      } else {
        this.interactor.placeBlock(this.selectedBlock);
      }
    }

    const target = this.interactor.currentTarget;
    this.hud.setTarget(
      target
        ? `${target.position.x} / ${target.position.y} / ${target.position.z}`
        : "scan the island",
    );
    this.runtime.render();
    this.frameHandle = window.requestAnimationFrame(this.frame);
  }

  private selectBlock(id: BlockId): void {
    const index = this.registry.indexOf(id);
    if (index < 0) {
      return;
    }
    this.selectBlockByIndex(index);
  }

  private selectBlockByIndex(index: number): void {
    const id = this.registry.ids[index];
    if (!id) {
      return;
    }
    this.selectedIndex = index;
    this.selectedBlock = id;
    this.hud.selectBlock(id);
  }

  private resetWorld(): void {
    this.world.replace(this.worldFactory().toArray());
    this.worldRenderer.sync();
    this.player.reset();
    this.interactor.update();
    this.hud.setBlockCount(this.world.size);
  }
}
