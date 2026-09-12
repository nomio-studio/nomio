import { GameSession } from "../game/game-session";
import { DEFAULT_BLOCK_REGISTRY, type BlockRegistry } from "../game/block-registry";
import type { GameConfigOverrides } from "../game/config";
import { saveRoot, SaveSystem, type MapRecord, type SaveRecord } from "../game/save-system";
import { createDefaultStorageDriver, type StorageDriver } from "../game/storage";
import { createGameShell, type GameShell } from "../ui/game-shell";
import { loadUiSettings } from "../ui/settings";
import { GameUi } from "../ui/ui";

export interface NomioApplicationOptions {
  root: HTMLElement;
  registry?: BlockRegistry;
  config?: GameConfigOverrides;
}

/**
 * Top of the application: owns the persistent UI and storage, resolves a world
 * and save, and swaps the `GameSession` when the player opens another one.
 */
export class NomioApplication {
  private readonly shell: GameShell;
  private readonly registry: BlockRegistry;
  private readonly driver: StorageDriver;
  private readonly saves: SaveSystem;
  private readonly ui: GameUi;
  private readonly configOverrides: GameConfigOverrides;
  private session: GameSession | null = null;
  private disposed = false;

  public constructor(options: NomioApplicationOptions) {
    this.shell = createGameShell(options.root);
    this.registry = options.registry ?? DEFAULT_BLOCK_REGISTRY;
    this.configOverrides = options.config ?? {};
    this.driver = createDefaultStorageDriver();
    this.saves = new SaveSystem(this.driver);
    this.ui = new GameUi(this.shell.ui, {
      registry: this.registry,
      settings: loadUiSettings(),
      library: this.saves,
      onStart: () => this.session?.beginPlay(),
      onPause: () => this.session?.pause(),
      onResume: () => this.session?.resume(),
      onQuitToTitle: () => this.session?.quitToTitle(),
      onReset: () => this.session?.reset(),
      onSettingsChange: (settings) => this.session?.applyUiSettings(settings),
      onSelectBlock: (id) => this.session?.selectBlock(id),
      onAction: (action) => this.session?.queueAction(action),
      onMove: (x, z) => this.session?.setMoveVector(x, z),
      onJump: () => this.session?.requestJump(),
      onLoadSave: (mapId, saveId) => void this.loadSave(mapId, saveId),
    });
  }

  public start(): void {
    void this.bootstrap();
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.session?.dispose();
    this.session = null;
    this.ui.dispose();
  }

  private async bootstrap(): Promise<void> {
    try {
      const { map, save } = await this.saves.ensureDefault();
      await this.loadSave(map.id, save.id);
    } catch {
      this.ui.pushToast("Could not open your worlds", "danger");
    }
  }

  private async loadSave(mapId: string, saveId: string): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.ui.setState("loading");
    this.ui.setLoadingStatus("Opening your island…");

    // Flush the outgoing save before its files are read back, so the newest edit
    // can never be missed by the incoming session's restore pass.
    if (this.session) {
      await this.session.flush();
      this.session.dispose();
      this.session = null;
    }

    const active = await this.resolveSave(mapId, saveId);
    if (!active) {
      this.ui.pushToast("That save could not be found", "danger");
      const fallback = await this.saves.ensureDefault();
      if (fallback.map.id === mapId && fallback.save.id === saveId) {
        return;
      }
      return this.loadSave(fallback.map.id, fallback.save.id);
    }

    const activeMap = active.map;
    const activeSave = active.save;
    const session = new GameSession({
      shell: this.shell,
      ui: this.ui,
      registry: this.registry,
      config: { ...this.configOverrides, terrain: activeMap.terrain },
      driver: this.driver,
      storageRoot: saveRoot(activeMap.id, activeSave.id),
      onPersist: (stats) => {
        void this.saves.recordSave(activeMap.id, activeSave.id, {
          editedChunks: stats.editedChunks,
        });
      },
    });
    this.session = session;
    this.ui.setActiveSave(activeMap.id, activeSave.id);
    this.ui.setWorldLabel(`${activeSave.name} · ${activeMap.name}`);
    session.start();
  }

  /**
   * Resolves a world and save, recreating the save if its catalog entry vanished
   * but the world still exists. Returns `null` when either is unrecoverable.
   */
  private async resolveSave(
    mapId: string,
    saveId: string,
  ): Promise<{ map: MapRecord; save: SaveRecord } | null> {
    try {
      const map = await this.saves.getMap(mapId);
      if (!map) {
        return null;
      }
      let save = await this.saves.getSave(mapId, saveId);
      if (!save) {
        save = await this.saves.createSave(mapId, "Recovered journey");
      }
      return { map, save };
    } catch {
      return null;
    }
  }
}
