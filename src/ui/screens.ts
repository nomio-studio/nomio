import { clamp, requireElement } from "./dom";

export interface LoadingScreenOptions {
  container: HTMLElement;
}

/** Full-bleed boot screen with determinate terrain progress. */
export class LoadingScreen {
  private readonly root: HTMLElement;
  private readonly fill: HTMLElement;
  private readonly progress: HTMLElement;
  private readonly status: HTMLElement;

  public constructor(options: LoadingScreenOptions) {
    options.container.insertAdjacentHTML(
      "beforeend",
      `
      <section class="screen screen--loading" id="screen-loading" aria-label="Loading nomio">
        <div class="screen__inner loading">
          <div class="brand brand--stacked">
            <span class="brand__spark" aria-hidden="true">✦</span>
            <p class="eyebrow">A pocket-sized world</p>
            <p class="brand__title">nomio</p>
          </div>
          <div class="loading__bar" role="progressbar" aria-label="Generating terrain"
            aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" id="loading-progress">
            <span class="loading__fill" id="loading-fill"></span>
          </div>
          <p class="loading__status" id="loading-status">Carving the island…</p>
        </div>
      </section>
    `,
    );

    this.root = requireElement<HTMLElement>(options.container, "#screen-loading");
    this.fill = requireElement<HTMLElement>(this.root, "#loading-fill");
    this.progress = requireElement<HTMLElement>(this.root, "#loading-progress");
    this.status = requireElement<HTMLElement>(this.root, "#loading-status");
  }

  public setVisible(visible: boolean): void {
    this.root.hidden = !visible;
  }

  public setProgress(fraction: number): void {
    const percent = Math.round(clamp(fraction, 0, 1) * 100);
    this.fill.style.width = `${percent}%`;
    this.progress.setAttribute("aria-valuenow", String(percent));
  }

  public setStatus(message: string): void {
    this.status.textContent = message;
  }
}

export interface TitleScreenOptions {
  container: HTMLElement;
  onStart: () => void;
  onWorlds: () => void;
  onSettings: () => void;
}

/** Landing screen; the sole page-level `<h1>` lives here. */
export class TitleScreen {
  private readonly listeners = new AbortController();
  private readonly root: HTMLElement;
  private readonly world: HTMLElement;

  public constructor(options: TitleScreenOptions) {
    options.container.insertAdjacentHTML(
      "beforeend",
      `
      <section class="screen screen--title" id="screen-title" aria-labelledby="title-heading" hidden>
        <div class="screen__inner title-card">
          <p class="eyebrow">Field note 01 · a pocket-sized world</p>
          <h1 class="title-card__heading" id="title-heading">Shape a quiet place.</h1>
          <p class="title-card__lede">
            Walk the island, collect its colours, and leave one small mark of your own.
            The island remembers.
          </p>
          <p class="title-card__world" id="title-world" hidden></p>
          <div class="title-card__actions">
            <button class="button button--primary" id="start-game" type="button">
              Enter the island <span aria-hidden="true">↗</span>
            </button>
            <button class="button button--ghost" id="title-worlds" type="button">Worlds</button>
            <button class="button button--ghost" id="title-settings" type="button">Settings</button>
          </div>
          <dl class="controls-list" aria-label="Controls">
            <div class="controls-list__pointer"><dt><kbd>WASD</kbd></dt><dd>Walk</dd></div>
            <div class="controls-list__pointer"><dt><kbd>Space</kbd></dt><dd>Hop</dd></div>
            <div class="controls-list__pointer"><dt><kbd>LMB</kbd> / <kbd>RMB</kbd></dt><dd>Hold to mine / place</dd></div>
            <div class="controls-list__pointer"><dt><kbd>1–0</kbd></dt><dd>Choose a material</dd></div>
            <div class="controls-list__pointer"><dt><kbd>Esc</kbd></dt><dd>Pause</dd></div>
            <div class="controls-list__touch"><dt>Stick</dt><dd>Move</dd></div>
            <div class="controls-list__touch"><dt>Drag</dt><dd>Look around</dd></div>
            <div class="controls-list__touch"><dt>Tap</dt><dd>Place under your finger</dd></div>
            <div class="controls-list__touch"><dt>Hold</dt><dd>Mine under your finger</dd></div>
            <div class="controls-list__touch"><dt>Jump</dt><dd>On-screen button</dd></div>
            <div class="controls-list__touch"><dt>Palette</dt><dd>Tap a material</dd></div>
            <div class="controls-list__touch"><dt>Pause</dt><dd>Top-right button</dd></div>
          </dl>
        </div>
      </section>
    `,
    );

    this.root = requireElement<HTMLElement>(options.container, "#screen-title");
    this.world = requireElement<HTMLElement>(this.root, "#title-world");
    const { signal } = this.listeners;
    requireElement<HTMLButtonElement>(this.root, "#start-game").addEventListener(
      "click",
      options.onStart,
      { signal },
    );
    requireElement<HTMLButtonElement>(this.root, "#title-worlds").addEventListener(
      "click",
      options.onWorlds,
      { signal },
    );
    requireElement<HTMLButtonElement>(this.root, "#title-settings").addEventListener(
      "click",
      options.onSettings,
      { signal },
    );
  }

  public setVisible(visible: boolean): void {
    this.root.hidden = !visible;
  }

  /** Shows the loaded world and save above the primary action. */
  public setWorldLabel(label: string): void {
    this.world.textContent = label;
    this.world.hidden = label.length === 0;
  }

  public focusPrimary(): void {
    this.root.querySelector<HTMLButtonElement>("#start-game")?.focus();
  }

  public dispose(): void {
    this.listeners.abort();
    this.root.remove();
  }
}
