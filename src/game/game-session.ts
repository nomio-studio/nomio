import * as THREE from "three";
import { DEFAULT_BLOCK_REGISTRY, type BlockRegistry } from "./block-registry";
import { ChunkStreamer } from "./chunk-streamer";
import { createGameConfig, type GameConfig, type GameConfigOverrides } from "./config";
import { InputManager } from "./input";
import { VoxelInteractor } from "./interactor";
import { PlayerController } from "./player";
import { SceneRuntime } from "./scene-runtime";
import { TerrainWorker } from "./terrain-worker";
import type { BlockId } from "./types";
import { VoxelWorld } from "./world";
import { VoxelWorldRenderer } from "./world-renderer";
import type { GameShell } from "../ui/game-shell";
import { GameUi } from "../ui/ui";
import { loadUiSettings, type UiSettings } from "../ui/settings";

export interface GameSessionOptions {
  shell: GameShell;
  registry?: BlockRegistry;
  config?: GameConfigOverrides;
}

export class GameSession {
  private readonly config: GameConfig;
  private readonly registry: BlockRegistry;
  private readonly runtime: SceneRuntime;
  private readonly world = new VoxelWorld();
  private readonly worldRenderer: VoxelWorldRenderer;
  private readonly player: PlayerController;
  private readonly input: InputManager;
  private readonly ui: GameUi;
  private readonly interactor: VoxelInteractor;
  private readonly terrain: TerrainWorker;
  private readonly streamer: ChunkStreamer;
  private readonly timer = new THREE.Timer();
  private readonly frame = (timestamp: number): void => this.tick(timestamp);

  private frameHandle: number | null = null;
  private running = false;
  private disposed = false;
  private terrainReady = false;
  private booted = false;
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
    this.terrain = new TerrainWorker(this.config.terrain, undefined, this.config.lighting);

    this.runtime = new SceneRuntime({ canvas: options.shell.canvas, config: this.config });
    this.worldRenderer = new VoxelWorldRenderer(this.runtime.scene, this.registry, {
      shadowChunkRadius: this.config.render.shadowChunkRadius,
      fog: this.runtime.fog,
      gi: this.runtime.gi,
    });
    this.player = new PlayerController(this.runtime.camera, this.world, this.config.player);
    this.input = new InputManager(options.shell.canvas, {
      onBlockHotkey: (slot) => this.selectBlockByIndex(slot),
      onCycleBlock: (direction) =>
        this.selectBlockByIndex(
          (this.selectedIndex + direction + this.registry.size) % this.registry.size,
        ),
      onPointerLockChange: (locked) => this.ui.setPointerLocked(locked),
    });
    this.ui = new GameUi(options.shell.ui, {
      registry: this.registry,
      settings: loadUiSettings(),
      onStart: () => this.handleStart(),
      onPause: () => this.handlePause(),
      onResume: () => this.handleResume(),
      onQuitToTitle: () => this.handleQuitToTitle(),
      onReset: () => this.resetWorld(),
      onSettingsChange: (settings) => this.applySettings(settings),
      onStateChange: (state) => this.input.setInteractive(state === "playing"),
      onSelectBlock: (id) => this.selectBlock(id),
      onAction: (action) => this.input.queueAction(action),
      onMoveButton: (direction, active) => this.input.setVirtualMove(direction, active),
    });
    this.interactor = new VoxelInteractor(this.runtime.camera, this.world, this.worldRenderer, {
      getPlayerBounds: () => this.player.bounds,
      maxDistance: this.config.interaction.maxDistance,
      onWorldChanged: () => this.ui.setBlockCount(this.world.size),
    });
    this.streamer = new ChunkStreamer({
      world: this.world,
      renderer: this.worldRenderer,
      worker: this.terrain,
      viewDistance: this.config.terrain.viewDistance,
      meshBudgetMs: this.config.render.meshBudgetMs,
      onChunkCountChanged: () => this.ui.setBlockCount(this.world.size),
      onGeometryChanged: () => this.runtime.invalidateShadows(),
    });

    this.applySettings(this.ui.settings);
    this.timer.connect(document);
    this.ui.selectBlock(this.selectedBlock);
    this.ui.setBlockCount(this.world.size);
    this.ui.setLoadingStatus("Carving the island…");
    this.runtime.setShadowFocus(this.player.position.x, this.player.position.z);
    this.interactor.update();
  }

  public start(): void {
    if (this.running || this.disposed) {
      return;
    }

    this.running = true;
    this.timer.reset();
    this.beginStreaming();
    this.frameHandle = window.requestAnimationFrame(this.frame);
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.stop();
    this.timer.dispose();
    this.input.dispose();
    this.ui.dispose();
    this.streamer.dispose();
    this.terrain.dispose();
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
    this.runtime.update(delta);
    this.streamer.update(this.player.position);

    if (!this.terrainReady) {
      this.ui.setLoadingProgress(this.streamer.loadProgress);
      this.runtime.render();
      this.frameHandle = window.requestAnimationFrame(this.frame);
      return;
    }

    this.player.update(delta, inputState);
    if (this.player.position.y < this.config.player.fallResetY) {
      this.player.reset();
      this.runtime.resetTemporal();
      this.ui.pushToast("Lifted back to the spawn point", "info");
    }
    if (this.worldRenderer.setShadowFocus(this.player.position)) {
      this.runtime.invalidateShadows();
    }
    this.runtime.setFocus(this.player.position.x, this.player.position.z);

    this.interactor.update();
    for (const action of inputState.actions) {
      if (action === "break") {
        this.handleBreak();
      } else {
        this.handlePlace();
      }
    }

    const target = this.interactor.currentTarget;
    this.ui.setTarget(
      target
        ? `${target.position.x} / ${target.position.y} / ${target.position.z}`
        : "scan the island",
    );
    this.runtime.render();
    this.frameHandle = window.requestAnimationFrame(this.frame);
  }

  private handleBreak(): void {
    const target = this.interactor.currentTarget;
    const id = target ? this.world.get(target.position) : null;
    if (this.interactor.breakTarget() && id) {
      this.runtime.resetTemporal();
      this.ui.pushToast(`Mined ${this.registry.get(id).label}`, "info");
    }
  }

  private handlePlace(): void {
    if (this.interactor.placeBlock(this.selectedBlock)) {
      this.runtime.resetTemporal();
      this.ui.pushToast(`Placed ${this.registry.get(this.selectedBlock).label}`, "success");
    }
  }

  private handleStart(): void {
    if (this.usesPointerLock()) {
      void this.input.requestPointerLock().then((locked) => {
        if (!locked && this.ui.currentState === "title") {
          this.ui.setState("playing");
        }
      });
    } else {
      this.ui.setState("playing");
    }
  }

  private handlePause(): void {
    if (this.input.isLocked) {
      this.input.exitPointerLock();
    } else {
      this.ui.setState("paused");
    }
  }

  private handleResume(): void {
    if (this.usesPointerLock()) {
      void this.input.requestPointerLock().then((locked) => {
        if (!locked && this.ui.currentState === "paused") {
          this.ui.setState("playing");
        }
      });
    } else {
      this.ui.setState("playing");
    }
  }

  private handleQuitToTitle(): void {
    this.ui.setState("title");
    this.input.exitPointerLock();
  }

  private usesPointerLock(): boolean {
    return !window.matchMedia("(pointer: coarse)").matches;
  }

  private applySettings(settings: UiSettings): void {
    this.player.lookSensitivity = this.config.player.lookSensitivity * settings.lookSensitivity;
    this.player.invertLook = settings.invertLook;
    this.runtime.setFieldOfView(settings.fieldOfView);
    this.runtime.setGrading({
      toneMapping: settings.toneMapping,
      exposure: settings.exposure,
      contrast: settings.contrast,
      saturation: settings.saturation,
      temperature: settings.temperature,
    });
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
    this.ui.selectBlock(id);
  }

  private beginStreaming(): void {
    this.streamer.update(this.player.position);
    void this.streamer.whenReady().then(() => {
      if (this.disposed) {
        return;
      }
      this.terrainReady = true;
      this.ui.setLoadingProgress(1);
      this.interactor.update();
      this.ui.setTarget("scan the island");
      if (!this.booted) {
        this.booted = true;
        this.ui.setState("title");
      }
    });
  }

  private resetWorld(): void {
    this.terrainReady = false;
    this.world.clear();
    this.worldRenderer.clear();
    this.player.reset();
    this.streamer.reset();
    this.interactor.update();
    this.ui.setBlockCount(this.world.size);
    this.ui.setTarget("generating terrain…");
    this.runtime.setShadowFocus(this.player.position.x, this.player.position.z);
    this.runtime.resetTemporal();
    this.beginStreaming();
  }
}
