import { DEFAULT_UI_SETTINGS, UI_SETTINGS_RANGE, type UiSettings } from "./settings";
import { requireElement } from "./dom";

export interface PauseMenuOptions {
  container: HTMLElement;
  onResume: () => void;
  onOpenWorlds: () => void;
  onOpenSettings: () => void;
  onRequestReset: () => void;
  onQuitToTitle: () => void;
}

/** Modal pause surface. Escape resumes rather than merely dismissing. */
export class PauseMenu {
  private readonly listeners = new AbortController();
  private readonly root: HTMLDialogElement;
  private readonly world: HTMLElement;

  public constructor(private readonly options: PauseMenuOptions) {
    options.container.insertAdjacentHTML(
      "beforeend",
      `
      <dialog class="dialog" id="pause-menu" aria-labelledby="pause-heading">
        <div class="dialog__panel">
          <p class="eyebrow">Paused</p>
          <h2 class="dialog__title" id="pause-heading">The island waits.</h2>
          <p class="dialog__body" id="pause-world"></p>
          <p class="dialog__body">Time holds while you are away. Your edits are safe.</p>
          <div class="dialog__actions dialog__actions--stack">
            <button class="button button--primary" id="resume-game" type="button">Resume</button>
            <button class="button button--ghost" id="pause-worlds" type="button">Worlds &amp; saves</button>
            <button class="button button--ghost" id="pause-settings" type="button">Settings</button>
            <button class="button button--ghost" id="pause-reset" type="button">Reset island</button>
            <button class="button button--quiet" id="quit-to-title" type="button">Return to title</button>
          </div>
          <p class="dialog__hint">Press <kbd>Esc</kbd> to resume</p>
        </div>
      </dialog>
    `,
    );

    this.root = requireElement<HTMLDialogElement>(options.container, "#pause-menu");
    this.world = requireElement<HTMLElement>(this.root, "#pause-world");
    const { signal } = this.listeners;
    this.root.addEventListener("cancel", this.handleCancel, { signal });
    requireElement<HTMLButtonElement>(this.root, "#resume-game").addEventListener(
      "click",
      options.onResume,
      { signal },
    );
    requireElement<HTMLButtonElement>(this.root, "#pause-worlds").addEventListener(
      "click",
      options.onOpenWorlds,
      { signal },
    );
    requireElement<HTMLButtonElement>(this.root, "#pause-settings").addEventListener(
      "click",
      options.onOpenSettings,
      { signal },
    );
    requireElement<HTMLButtonElement>(this.root, "#pause-reset").addEventListener(
      "click",
      options.onRequestReset,
      { signal },
    );
    requireElement<HTMLButtonElement>(this.root, "#quit-to-title").addEventListener(
      "click",
      options.onQuitToTitle,
      { signal },
    );
  }

  public get isOpen(): boolean {
    return this.root.open;
  }

  public setWorldLabel(label: string): void {
    this.world.textContent = label;
    this.world.hidden = label.length === 0;
  }

  public open(): void {
    if (!this.root.open) {
      this.root.showModal();
    }
    requireElement<HTMLButtonElement>(this.root, "#resume-game").focus();
  }

  public close(): void {
    if (this.root.open) {
      this.root.close();
    }
  }

  public dispose(): void {
    this.listeners.abort();
    this.root.remove();
  }

  private readonly handleCancel = (event: Event): void => {
    event.preventDefault();
    this.options.onResume();
  };
}

export interface SettingsPanelOptions {
  container: HTMLElement;
  /** Reveals the touch-only sensitivity control on touch devices. */
  touch?: boolean;
  onChange: (settings: UiSettings) => void;
  onClosed?: () => void;
}

/** Live-applied settings form. Changes persist as the user adjusts them. */
export class SettingsPanel {
  private readonly listeners = new AbortController();
  private readonly root: HTMLDialogElement;
  private readonly form: HTMLFormElement;

  public constructor(private readonly options: SettingsPanelOptions) {
    options.container.insertAdjacentHTML(
      "beforeend",
      `
      <dialog class="dialog dialog--wide" id="settings-panel" aria-labelledby="settings-heading">
        <form class="dialog__panel settings" id="settings-form">
          <p class="eyebrow">Settings</p>
          <h2 class="dialog__title" id="settings-heading">Tune the quiet.</h2>

          <div class="field">
            <label class="field__label" for="setting-sensitivity">
              Look sensitivity <output class="field__value" id="sensitivity-value" for="setting-sensitivity"></output>
            </label>
            <input class="field__range" id="setting-sensitivity" name="lookSensitivity" type="range"
              min="${UI_SETTINGS_RANGE.lookSensitivity.min}" max="${UI_SETTINGS_RANGE.lookSensitivity.max}"
              step="${UI_SETTINGS_RANGE.lookSensitivity.step}" />
          </div>

          <div class="field" id="touch-sensitivity-field" hidden>
            <label class="field__label" for="setting-touch">
              Touch sensitivity <output class="field__value" id="touch-value" for="setting-touch"></output>
            </label>
            <input class="field__range" id="setting-touch" name="touchSensitivity" type="range"
              min="${UI_SETTINGS_RANGE.touchSensitivity.min}" max="${UI_SETTINGS_RANGE.touchSensitivity.max}"
              step="${UI_SETTINGS_RANGE.touchSensitivity.step}" />
          </div>

          <div class="field">
            <label class="field__label" for="setting-fov">
              Field of view <output class="field__value" id="fov-value" for="setting-fov"></output>
            </label>
            <input class="field__range" id="setting-fov" name="fieldOfView" type="range"
              min="${UI_SETTINGS_RANGE.fieldOfView.min}" max="${UI_SETTINGS_RANGE.fieldOfView.max}"
              step="${UI_SETTINGS_RANGE.fieldOfView.step}" />
          </div>

          <label class="field field--toggle">
            <input id="setting-invert" name="invertLook" type="checkbox" />
            <span>Invert vertical look</span>
          </label>

          <label class="field field--toggle">
            <input id="setting-hints" name="showControlHints" type="checkbox" />
            <span>Show control hints</span>
          </label>

          <label class="field field--toggle">
            <input id="setting-motion" name="reduceMotion" type="checkbox" />
            <span>Reduce motion</span>
          </label>

          <p class="eyebrow settings__group">Color</p>

          <div class="field">
            <label class="field__label" for="setting-tonemap">Tone mapping</label>
            <select class="field__select" id="setting-tonemap" name="toneMapping">
              <option value="agx">AgX (filmic)</option>
              <option value="aces">ACES</option>
            </select>
          </div>

          <div class="field">
            <label class="field__label" for="setting-exposure">
              Exposure <output class="field__value" id="exposure-value" for="setting-exposure"></output>
            </label>
            <input class="field__range" id="setting-exposure" name="exposure" type="range"
              min="${UI_SETTINGS_RANGE.exposure.min}" max="${UI_SETTINGS_RANGE.exposure.max}"
              step="${UI_SETTINGS_RANGE.exposure.step}" />
          </div>

          <div class="field">
            <label class="field__label" for="setting-contrast">
              Contrast <output class="field__value" id="contrast-value" for="setting-contrast"></output>
            </label>
            <input class="field__range" id="setting-contrast" name="contrast" type="range"
              min="${UI_SETTINGS_RANGE.contrast.min}" max="${UI_SETTINGS_RANGE.contrast.max}"
              step="${UI_SETTINGS_RANGE.contrast.step}" />
          </div>

          <div class="field">
            <label class="field__label" for="setting-saturation">
              Saturation <output class="field__value" id="saturation-value" for="setting-saturation"></output>
            </label>
            <input class="field__range" id="setting-saturation" name="saturation" type="range"
              min="${UI_SETTINGS_RANGE.saturation.min}" max="${UI_SETTINGS_RANGE.saturation.max}"
              step="${UI_SETTINGS_RANGE.saturation.step}" />
          </div>

          <div class="field">
            <label class="field__label" for="setting-temperature">
              Temperature <output class="field__value" id="temperature-value" for="setting-temperature"></output>
            </label>
            <input class="field__range" id="setting-temperature" name="temperature" type="range"
              min="${UI_SETTINGS_RANGE.temperature.min}" max="${UI_SETTINGS_RANGE.temperature.max}"
              step="${UI_SETTINGS_RANGE.temperature.step}" />
          </div>

          <div class="dialog__actions">
            <button class="button button--primary" id="settings-done" type="submit">Done</button>
            <button class="button button--quiet" id="settings-defaults" type="button">Restore defaults</button>
          </div>
        </form>
      </dialog>
    `,
    );

    this.root = requireElement<HTMLDialogElement>(options.container, "#settings-panel");
    this.form = requireElement<HTMLFormElement>(this.root, "#settings-form");
    requireElement<HTMLElement>(this.root, "#touch-sensitivity-field").hidden = !options.touch;
    const { signal } = this.listeners;
    this.form.addEventListener("input", this.handleInput, { signal });
    this.form.addEventListener("change", this.handleInput, { signal });
    this.form.addEventListener("submit", this.handleSubmit, { signal });
    this.root.addEventListener("close", () => this.options.onClosed?.(), { signal });
    requireElement<HTMLButtonElement>(this.root, "#settings-defaults").addEventListener(
      "click",
      this.handleDefaults,
      { signal },
    );
  }

  public get isOpen(): boolean {
    return this.root.open;
  }

  public open(settings: UiSettings): void {
    this.applyValues(settings);
    if (!this.root.open) {
      this.root.showModal();
    }
    requireElement<HTMLInputElement>(this.root, "#setting-sensitivity").focus();
  }

  public close(): void {
    if (this.root.open) {
      this.root.close();
    }
  }

  public dispose(): void {
    this.listeners.abort();
    this.root.remove();
  }

  private applyValues(settings: UiSettings): void {
    const sensitivity = requireElement<HTMLInputElement>(this.root, "#setting-sensitivity");
    const touch = requireElement<HTMLInputElement>(this.root, "#setting-touch");
    const fov = requireElement<HTMLInputElement>(this.root, "#setting-fov");
    sensitivity.value = String(settings.lookSensitivity);
    touch.value = String(settings.touchSensitivity);
    fov.value = String(settings.fieldOfView);
    requireElement<HTMLInputElement>(this.root, "#setting-invert").checked = settings.invertLook;
    requireElement<HTMLInputElement>(this.root, "#setting-hints").checked =
      settings.showControlHints;
    requireElement<HTMLInputElement>(this.root, "#setting-motion").checked = settings.reduceMotion;
    requireElement<HTMLSelectElement>(this.root, "#setting-tonemap").value = settings.toneMapping;
    requireElement<HTMLInputElement>(this.root, "#setting-exposure").value = String(
      settings.exposure,
    );
    requireElement<HTMLInputElement>(this.root, "#setting-contrast").value = String(
      settings.contrast,
    );
    requireElement<HTMLInputElement>(this.root, "#setting-saturation").value = String(
      settings.saturation,
    );
    requireElement<HTMLInputElement>(this.root, "#setting-temperature").value = String(
      settings.temperature,
    );
    this.updateOutputs(settings);
  }

  private readValues(): UiSettings {
    return {
      lookSensitivity: Number(
        requireElement<HTMLInputElement>(this.root, "#setting-sensitivity").value,
      ),
      touchSensitivity: Number(requireElement<HTMLInputElement>(this.root, "#setting-touch").value),
      fieldOfView: Number(requireElement<HTMLInputElement>(this.root, "#setting-fov").value),
      invertLook: requireElement<HTMLInputElement>(this.root, "#setting-invert").checked,
      showControlHints: requireElement<HTMLInputElement>(this.root, "#setting-hints").checked,
      reduceMotion: requireElement<HTMLInputElement>(this.root, "#setting-motion").checked,
      toneMapping: requireElement<HTMLSelectElement>(this.root, "#setting-tonemap")
        .value as UiSettings["toneMapping"],
      exposure: Number(requireElement<HTMLInputElement>(this.root, "#setting-exposure").value),
      contrast: Number(requireElement<HTMLInputElement>(this.root, "#setting-contrast").value),
      saturation: Number(requireElement<HTMLInputElement>(this.root, "#setting-saturation").value),
      temperature: Number(
        requireElement<HTMLInputElement>(this.root, "#setting-temperature").value,
      ),
    };
  }

  private updateOutputs(settings: UiSettings): void {
    requireElement<HTMLOutputElement>(this.root, "#sensitivity-value").textContent =
      `${settings.lookSensitivity.toFixed(2)}×`;
    requireElement<HTMLOutputElement>(this.root, "#touch-value").textContent =
      `${settings.touchSensitivity.toFixed(2)}×`;
    requireElement<HTMLOutputElement>(this.root, "#fov-value").textContent =
      `${Math.round(settings.fieldOfView)}°`;
    requireElement<HTMLOutputElement>(this.root, "#exposure-value").textContent =
      `${settings.exposure >= 0 ? "+" : ""}${settings.exposure.toFixed(2)} EV`;
    requireElement<HTMLOutputElement>(this.root, "#contrast-value").textContent =
      `${settings.contrast.toFixed(2)}×`;
    requireElement<HTMLOutputElement>(this.root, "#saturation-value").textContent =
      `${settings.saturation.toFixed(2)}×`;
    requireElement<HTMLOutputElement>(this.root, "#temperature-value").textContent =
      `${Math.round(settings.temperature)} K`;
  }

  private readonly handleInput = (): void => {
    const settings = this.readValues();
    this.updateOutputs(settings);
    this.options.onChange(settings);
  };

  private readonly handleSubmit = (event: SubmitEvent): void => {
    event.preventDefault();
    this.close();
  };

  private readonly handleDefaults = (): void => {
    this.applyValues(DEFAULT_UI_SETTINGS);
    this.options.onChange({ ...DEFAULT_UI_SETTINGS });
    this.updateOutputs(DEFAULT_UI_SETTINGS);
  };
}

export interface ResetDialogOptions {
  container: HTMLElement;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Confirmation for the one destructive action in the game. */
export class ResetDialog {
  private readonly listeners = new AbortController();
  private readonly root: HTMLDialogElement;

  public constructor(private readonly options: ResetDialogOptions) {
    options.container.insertAdjacentHTML(
      "beforeend",
      `
      <dialog class="dialog" id="reset-dialog" aria-labelledby="reset-heading">
        <div class="dialog__panel">
          <p class="eyebrow">Careful</p>
          <h2 class="dialog__title" id="reset-heading">Reset the island?</h2>
          <p class="dialog__body">
            Every block you mined or placed disappears and the terrain is generated again.
            This cannot be undone.
          </p>
          <div class="dialog__actions">
            <button class="button button--ghost" id="reset-cancel" type="button">Keep building</button>
            <button class="button button--danger" id="reset-confirm" type="button">Reset island</button>
          </div>
        </div>
      </dialog>
    `,
    );

    this.root = requireElement<HTMLDialogElement>(options.container, "#reset-dialog");
    const { signal } = this.listeners;
    this.root.addEventListener("cancel", this.handleCancel, { signal });
    requireElement<HTMLButtonElement>(this.root, "#reset-cancel").addEventListener(
      "click",
      options.onCancel,
      { signal },
    );
    requireElement<HTMLButtonElement>(this.root, "#reset-confirm").addEventListener(
      "click",
      options.onConfirm,
      { signal },
    );
  }

  public get isOpen(): boolean {
    return this.root.open;
  }

  public open(): void {
    if (!this.root.open) {
      this.root.showModal();
    }
    requireElement<HTMLButtonElement>(this.root, "#reset-cancel").focus();
  }

  public close(): void {
    if (this.root.open) {
      this.root.close();
    }
  }

  public dispose(): void {
    this.listeners.abort();
    this.root.remove();
  }

  private readonly handleCancel = (event: Event): void => {
    event.preventDefault();
    this.options.onCancel();
  };
}
