import type { BlockRegistry } from "../game/block-registry";
import type { GameAction, MoveDirection } from "../game/input";
import type { BlockId } from "../game/types";
import { PauseMenu, ResetDialog, SettingsPanel } from "./dialogs";
import { Hud } from "./hud";
import { LoadingScreen, TitleScreen } from "./screens";
import { normalizeUiSettings, saveUiSettings, type UiSettings } from "./settings";
import { ToastStack, type ToastTone } from "./toasts";

export type UiState = "loading" | "title" | "playing" | "paused";

export interface GameUiOptions {
  registry: BlockRegistry;
  settings: UiSettings;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onQuitToTitle: () => void;
  onReset: () => void;
  onSettingsChange: (settings: UiSettings) => void;
  onStateChange?: (state: UiState) => void;
  onSelectBlock: (id: BlockId) => void;
  onAction: (action: GameAction) => void;
  onMoveButton: (direction: MoveDirection, active: boolean) => void;
}

/**
 * Owns every screen, dialog, and transient message, and the state machine that
 * moves between them: loading → title → playing ↔ paused. Gameplay code talks
 * to this one object and never touches the DOM directly.
 */
export class GameUi {
  private readonly listeners = new AbortController();
  private readonly hud: Hud;
  private readonly loading: LoadingScreen;
  private readonly title: TitleScreen;
  private readonly pauseMenu: PauseMenu;
  private readonly settingsPanel: SettingsPanel;
  private readonly resetDialog: ResetDialog;
  private readonly toasts: ToastStack;
  private state: UiState = "loading";
  private currentSettings: UiSettings;

  public constructor(
    private readonly root: HTMLElement,
    private readonly options: GameUiOptions,
  ) {
    this.currentSettings = normalizeUiSettings(options.settings);

    const toastRegion = document.createElement("div");
    toastRegion.className = "toast-stack";
    toastRegion.id = "toasts";
    toastRegion.setAttribute("role", "status");
    toastRegion.setAttribute("aria-live", "polite");
    root.append(toastRegion);

    this.hud = new Hud(root, {
      registry: options.registry,
      onSelectBlock: options.onSelectBlock,
      onAction: options.onAction,
      onMoveButton: options.onMoveButton,
      onPause: options.onPause,
      onReset: () => this.resetDialog.open(),
    });

    this.loading = new LoadingScreen({ container: root });
    this.title = new TitleScreen({
      container: root,
      onStart: options.onStart,
      onSettings: () => this.settingsPanel.open(this.currentSettings),
    });
    this.pauseMenu = new PauseMenu({
      container: root,
      onResume: options.onResume,
      onOpenSettings: () => this.settingsPanel.open(this.currentSettings),
      onRequestReset: () => this.resetDialog.open(),
      onQuitToTitle: options.onQuitToTitle,
    });
    this.settingsPanel = new SettingsPanel({
      container: root,
      onChange: (settings) => this.updateSettings(settings),
      onClosed: () => {
        if (this.state === "paused") {
          this.pauseMenu.open();
        } else if (this.state === "title") {
          this.title.focusPrimary();
        }
      },
    });
    this.resetDialog = new ResetDialog({
      container: root,
      onCancel: () => {
        this.resetDialog.close();
        if (this.state === "paused") {
          this.pauseMenu.open();
        }
      },
      onConfirm: () => {
        this.resetDialog.close();
        options.onReset();
        this.pushToast("Island reset to its quiet beginning", "success");
      },
    });
    this.toasts = new ToastStack(toastRegion, {
      prefersReducedMotion: () =>
        this.currentSettings.reduceMotion ||
        window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    });

    window.addEventListener("keydown", this.handleWindowKeyDown, { signal: this.listeners.signal });
    this.applySettings();
    this.transition("loading");
  }

  public get settings(): UiSettings {
    return { ...this.currentSettings };
  }

  public get currentState(): UiState {
    return this.state;
  }

  public setState(state: UiState): void {
    this.transition(state);
  }

  public setLoadingProgress(fraction: number): void {
    this.loading.setProgress(fraction);
  }

  public setLoadingStatus(message: string): void {
    this.loading.setStatus(message);
  }

  public setBlockCount(count: number): void {
    this.hud.setBlockCount(count);
  }

  public setTarget(label: string): void {
    this.hud.setTarget(label);
  }

  public selectBlock(id: BlockId): void {
    this.hud.selectBlock(id);
  }

  public setPointerLocked(locked: boolean): void {
    if (locked) {
      this.transition("playing");
    } else if (this.state === "playing") {
      this.transition("paused");
    }
  }

  public pushToast(message: string, tone: ToastTone = "info"): void {
    this.toasts.push(message, tone);
  }

  public dispose(): void {
    this.listeners.abort();
    this.toasts.dispose();
    this.hud.dispose();
    this.pauseMenu.dispose();
    this.settingsPanel.dispose();
    this.resetDialog.dispose();
    this.title.dispose();
    this.root.querySelectorAll(".screen--loading, #toasts").forEach((element) => element.remove());
  }

  private transition(next: UiState): void {
    this.state = next;
    this.root.dataset.state = next;
    this.loading.setVisible(next === "loading");
    this.title.setVisible(next === "title");
    this.hud.setVisible(next === "playing" || next === "paused");

    if (next === "paused") {
      this.pauseMenu.open();
    } else if (this.pauseMenu.isOpen) {
      this.pauseMenu.close();
    }

    if (next === "title") {
      this.title.focusPrimary();
    }

    this.options.onStateChange?.(next);
  }

  private updateSettings(settings: UiSettings): void {
    this.currentSettings = normalizeUiSettings(settings);
    saveUiSettings(this.currentSettings);
    this.applySettings();
    this.options.onSettingsChange(this.currentSettings);
  }

  private applySettings(): void {
    this.root.classList.toggle("reduce-motion", this.currentSettings.reduceMotion);
    this.hud.setHintsVisible(this.currentSettings.showControlHints);
  }

  private readonly handleWindowKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Escape" || event.repeat) {
      return;
    }
    if (this.state === "playing" && !this.pauseMenu.isOpen) {
      this.options.onPause();
    }
  };
}
