import * as THREE from "three";
import { DEFAULT_BLOCK_REGISTRY, type BlockRegistry } from "./block-registry";
import { BreakParticles } from "./break-particles";
import { ChunkStreamer } from "./chunk-streamer";
import { createGameConfig, type GameConfig, type GameConfigOverrides } from "./config";
import { InputManager, type AimPoint } from "./input";
import { VoxelInteractor } from "./interactor";
import { PlayerController } from "./player";
import { SceneRuntime } from "./scene-runtime";
import type { StorageDriver } from "./storage";
import { generateTerrainChunk } from "./terrain-generation";
import { TerrainWorker } from "./terrain-worker";
import type { BlockId } from "./types";
import { VoxelWorld } from "./world";
import { VoxelWorldRenderer } from "./world-renderer";
import {
  fingerprintBlocks,
  fingerprintTerrain,
  WorldPersistence,
  type WorldSaveStats,
} from "./voxel-store";
import type { GameShell } from "../ui/game-shell";
import type { GameUi } from "../ui/ui";
import type { UiSettings } from "../ui/settings";

/** Progress milestones (as a fraction of the whole) at which a block sheds a chip. */
const MINING_CHIP_STAGES = 6;

export interface GameSessionOptions {
  shell: GameShell;
  /** Application-owned UI. The session posts state but never disposes it. */
  ui: GameUi;
  registry?: BlockRegistry;
  config?: GameConfigOverrides;
  /** Storage driver shared with the save system. */
  driver: StorageDriver;
  /** Directory that holds this session's save slot, e.g. `maps/<id>/saves/<id>`. */
  storageRoot: string;
  /** Called after a successful autosave with the current edit count. */
  onPersist?: (stats: WorldSaveStats) => void;
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
  private readonly breakParticles: BreakParticles;
  private readonly terrain: TerrainWorker;
  private readonly streamer: ChunkStreamer;
  private readonly persistence: WorldPersistence;
  private readonly timer = new THREE.Timer();
  private readonly frame = (timestamp: number): void => this.tick(timestamp);
  private readonly unsubscribeState: () => void;

  private frameHandle: number | null = null;
  private running = false;
  private disposed = false;
  private restored = false;
  private terrainReady = false;
  private booted = false;
  private selectedIndex = 0;
  private selectedBlock: BlockId;
  private chipStage = -1;
  private readonly debrisPalettes = new Map<BlockId, readonly number[]>();

  public constructor(options: GameSessionOptions) {
    this.config = createGameConfig(options.config);
    this.registry = options.registry ?? DEFAULT_BLOCK_REGISTRY;
    this.ui = options.ui;
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
    this.unsubscribeState = this.ui.addStateListener((state) => {
      this.input.setInteractive(state === "playing");
    });
    this.input.setInteractive(this.ui.currentState === "playing");
    this.interactor = new VoxelInteractor(this.runtime.camera, this.world, this.worldRenderer, {
      getPlayerBounds: () => this.player.bounds,
      maxDistance: this.config.interaction.maxDistance,
      onWorldChanged: () => this.ui.setBlockCount(this.world.size),
    });
    this.breakParticles = new BreakParticles(this.runtime.scene, (x, y, z) =>
      this.world.has({ x, y, z }),
    );
    this.streamer = new ChunkStreamer({
      world: this.world,
      renderer: this.worldRenderer,
      worker: this.terrain,
      viewDistance: this.config.terrain.viewDistance,
      meshBudgetMs: this.config.render.meshBudgetMs,
      onChunkCountChanged: () => this.ui.setBlockCount(this.world.size),
      onGeometryChanged: () => this.runtime.invalidateShadows(),
    });

    this.persistence = new WorldPersistence({
      world: this.world,
      driver: options.driver,
      root: options.storageRoot,
      blockFingerprint: fingerprintBlocks(this.registry),
      generatorFingerprint: fingerprintTerrain(this.config.terrain),
      generateBase: (coordinate) => generateTerrainChunk(coordinate, this.config.terrain).blocks,
      onError: () => {
        if (!this.disposed) {
          this.ui.pushToast("Could not save this island's edits", "info");
        }
      },
      onSaved: (stats) => options.onPersist?.(stats),
    });
    this.world.onChunkEdited = (coordinate) => this.persistence.markEdited(coordinate);

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
    void this.bootstrap();
    this.frameHandle = window.requestAnimationFrame(this.frame);
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.stop();
    this.unsubscribeState();
    this.timer.dispose();
    this.input.dispose();
    this.persistence.dispose();
    this.streamer.dispose();
    this.terrain.dispose();
    this.worldRenderer.dispose();
    this.breakParticles.dispose();
    this.runtime.dispose();
  }

  /** Enters play, requesting pointer lock on desktop. */
  public beginPlay(): void {
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

  public pause(): void {
    if (this.input.isLocked) {
      this.input.exitPointerLock();
    } else {
      this.ui.setState("paused");
    }
  }

  public resume(): void {
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

  public quitToTitle(): void {
    this.ui.setState("title");
    this.input.exitPointerLock();
  }

  public reset(): void {
    this.resetWorld();
  }

  public selectBlock(id: BlockId): void {
    const index = this.registry.indexOf(id);
    if (index < 0) {
      return;
    }
    this.selectBlockByIndex(index);
  }

  public setMoveVector(x: number, z: number): void {
    this.input.setMoveVector(x, z);
  }

  public requestJump(): void {
    this.input.requestJump();
  }

  public applyUiSettings(settings: UiSettings): void {
    this.applySettings(settings);
  }

  /** Flushes any pending edits; awaited before a save is swapped out. */
  public async flush(): Promise<void> {
    await this.persistence.flush();
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

    if (!this.restored) {
      this.runtime.render();
      this.frameHandle = window.requestAnimationFrame(this.frame);
      return;
    }

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

    this.interactor.update(inputState.aim);
    this.updateMining(delta, inputState.breaking);
    if (inputState.place) {
      this.handlePlace(inputState.place);
    }
    this.worldRenderer.updateBreakFeedback(delta);
    this.breakParticles.update(delta);

    const target = this.interactor.currentTarget;
    this.ui.setTarget(
      target
        ? `${target.position.x} / ${target.position.y} / ${target.position.z}`
        : "scan the island",
    );
    this.runtime.render();
    this.frameHandle = window.requestAnimationFrame(this.frame);
  }

  /**
   * Advances mining while the break input is held. As the block weakens it sheds
   * small chips; at full progress it bursts and is removed.
   */
  private updateMining(delta: number, breaking: boolean): void {
    const target = this.interactor.currentTarget;
    const id = target ? this.world.get(target.position) : null;
    if (!breaking || !target || !id) {
      this.interactor.clearMining();
      this.chipStage = -1;
      return;
    }

    const definition = this.registry.get(id);
    const palette = this.debrisPalette(id);
    if (this.interactor.miningProgress === 0) {
      this.chipStage = -1;
    }
    if (this.interactor.advanceMining(delta, this.config.interaction.breakDuration)) {
      this.chipStage = -1;
      this.breakParticles.burst(target.position, palette);
      this.runtime.resetTemporal();
      this.ui.pushToast(`Mined ${definition.label}`, "info");
      return;
    }

    const stage = Math.floor(this.interactor.miningProgress * MINING_CHIP_STAGES);
    if (stage > this.chipStage) {
      this.chipStage = stage;
      this.breakParticles.chip(target.position, palette);
    }
  }

  /** Debris takes its colors from the broken block's own texture palette. */
  private debrisPalette(id: BlockId): readonly number[] {
    const cached = this.debrisPalettes.get(id);
    if (cached) {
      return cached;
    }
    const palette = this.registry
      .get(id)
      .texture.palette.map((hex) => new THREE.Color(hex).getHex());
    this.debrisPalettes.set(id, palette);
    return palette;
  }

  private handlePlace(aim: AimPoint): void {
    if (this.interactor.placeBlockAt(aim, this.selectedBlock)) {
      this.runtime.resetTemporal();
      this.ui.pushToast(`Placed ${this.registry.get(this.selectedBlock).label}`, "success");
    }
  }

  private usesPointerLock(): boolean {
    return !window.matchMedia("(pointer: coarse)").matches;
  }

  private applySettings(settings: UiSettings): void {
    this.player.lookSensitivity = this.config.player.lookSensitivity * settings.lookSensitivity;
    this.player.invertLook = settings.invertLook;
    this.input.setTouchLookScale(settings.touchSensitivity);
    this.runtime.setFieldOfView(settings.fieldOfView);
    this.runtime.setGrading({
      toneMapping: settings.toneMapping,
      exposure: settings.exposure,
      contrast: settings.contrast,
      saturation: settings.saturation,
      temperature: settings.temperature,
    });
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

  private async bootstrap(): Promise<void> {
    this.ui.setLoadingStatus("Restoring your edits…");
    await this.persistence.restore();
    if (this.disposed || !this.running) {
      return;
    }
    this.restored = true;
    this.ui.setLoadingStatus("Carving the island…");
    this.beginStreaming();
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
    void this.persistence.clear();
    this.interactor.clearMining();
    this.chipStage = -1;
    this.breakParticles.clear();
    this.interactor.update();
    this.ui.setBlockCount(this.world.size);
    this.ui.setTarget("generating terrain…");
    this.runtime.setShadowFocus(this.player.position.x, this.player.position.z);
    this.runtime.resetTemporal();
    this.beginStreaming();
  }
}
