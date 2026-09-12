import type { BlockRegistry } from "../game/block-registry";
import type { GameAction, MoveDirection } from "../game/input";
import type { BlockId } from "../game/types";
import { formatSlotKey, requireElement, setRovingTabIndex } from "./dom";

export interface HudOptions {
  registry: BlockRegistry;
  onSelectBlock: (id: BlockId) => void;
  onAction: (action: GameAction) => void;
  onMoveButton: (direction: MoveDirection, active: boolean) => void;
  onPause: () => void;
  onReset: () => void;
}

const PAUSE_ICON = `
  <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
    <rect x="3.25" y="2.5" width="3.5" height="11" rx="1" fill="currentColor"></rect>
    <rect x="9.25" y="2.5" width="3.5" height="11" rx="1" fill="currentColor"></rect>
  </svg>
`;

/**
 * The in-game layer: brand, live readouts, reticle, block palette, and touch
 * controls. It is pure presentation; `GameUi` owns the screen state and the
 * game session owns the data.
 */
export class Hud {
  private readonly listeners = new AbortController();
  private readonly root: HTMLElement;
  private readonly blockCount: HTMLElement;
  private readonly targetLabel: HTMLElement;
  private readonly selectionLabel: HTMLElement;
  private readonly hotbar: HTMLElement;
  private readonly controlsHint: HTMLElement;
  private readonly slots: HTMLButtonElement[];

  public constructor(
    container: HTMLElement,
    private readonly options: HudOptions,
  ) {
    const { registry } = options;
    const slotMarkup = registry.ids
      .map((id, index) => {
        const definition = registry.get(id);
        const selected = index === 0;
        return `
          <button class="block-slot${selected ? " is-selected" : ""}" type="button"
            data-block="${id}" aria-label="Select ${definition.label}"
            aria-pressed="${selected}" tabindex="${selected ? 0 : -1}"
            title="${definition.label} · ${definition.description}">
            <span class="block-slot__key" aria-hidden="true">${formatSlotKey(index)}</span>
            <span class="block-slot__swatch" style="--swatch: ${definition.accent}" aria-hidden="true"></span>
            <span class="block-slot__label">${definition.label}</span>
          </button>`;
      })
      .join("");

    container.insertAdjacentHTML(
      "beforeend",
      `
      <div class="hud" id="hud" hidden>
        <div class="hud__vignette" aria-hidden="true"></div>

        <header class="brand" aria-label="nomio">
          <span class="brand__spark" aria-hidden="true">✦</span>
          <div>
            <p class="eyebrow">Field note 01</p>
            <p class="brand__title">nomio</p>
          </div>
        </header>

        <button class="icon-button hud__pause" id="pause-button" type="button"
          aria-label="Pause game" title="Pause (Esc)">
          ${PAUSE_ICON}
        </button>

        <div class="readout readout--inventory">
          <span class="eyebrow">Island inventory</span>
          <strong class="readout__value" id="block-count">0 blocks</strong>
        </div>

        <div class="readout readout--target">
          <span class="eyebrow">Target</span>
          <strong class="readout__value" id="target-label">generating terrain…</strong>
        </div>

        <div class="crosshair" aria-hidden="true"><span></span></div>

        <aside class="controls-card" id="controls-hint" aria-label="Game controls">
          <span class="eyebrow">Field kit</span>
          <p><kbd>WASD</kbd> move <kbd>Space</kbd> hop</p>
          <p><kbd>LMB</kbd> mine <kbd>RMB</kbd> place</p>
          <p><kbd>1–0</kbd> choose <kbd>[ ]</kbd> cycle</p>
          <p><kbd>Esc</kbd> pause</p>
          <button class="text-button" id="reset-world" type="button">
            Reset island <span aria-hidden="true">↺</span>
          </button>
        </aside>

        <nav class="hotbar" id="hotbar" aria-label="Block palette">
          <div class="hotbar__items" role="toolbar" aria-label="Materials" aria-orientation="horizontal">
            ${slotMarkup}
          </div>
          <p class="hotbar__caption" id="selection-label"></p>
        </nav>

        <div class="mobile-actions" aria-label="Touch actions">
          <button type="button" data-action="break">Mine</button>
          <button type="button" data-action="place">Place</button>
        </div>

        <div class="touch-pad" aria-label="Touch movement">
          <button type="button" data-move="forward" aria-label="Move forward">↑</button>
          <div>
            <button type="button" data-move="left" aria-label="Move left">←</button>
            <button type="button" data-move="back" aria-label="Move back">↓</button>
            <button type="button" data-move="right" aria-label="Move right">→</button>
          </div>
        </div>
      </div>
    `,
    );

    this.root = requireElement<HTMLElement>(container, "#hud");
    this.blockCount = requireElement<HTMLElement>(container, "#block-count");
    this.targetLabel = requireElement<HTMLElement>(container, "#target-label");
    this.selectionLabel = requireElement<HTMLElement>(container, "#selection-label");
    this.hotbar = requireElement<HTMLElement>(container, "#hotbar");
    this.controlsHint = requireElement<HTMLElement>(container, "#controls-hint");
    this.slots = [...this.hotbar.querySelectorAll<HTMLButtonElement>("[data-block]")];
    this.bindEvents();
  }

  public setVisible(visible: boolean): void {
    this.root.hidden = !visible;
  }

  public setBlockCount(count: number): void {
    this.blockCount.textContent = `${count} ${count === 1 ? "block" : "blocks"}`;
  }

  public setTarget(label: string): void {
    this.targetLabel.textContent = label;
  }

  public setHintsVisible(visible: boolean): void {
    this.controlsHint.hidden = !visible;
  }

  public selectBlock(id: BlockId): void {
    let active: HTMLButtonElement | null = null;
    for (const button of this.slots) {
      const selected = button.dataset.block === id;
      button.classList.toggle("is-selected", selected);
      button.setAttribute("aria-pressed", String(selected));
      if (selected) {
        active = button;
      }
    }

    setRovingTabIndex(this.slots, active);
    const definition = this.options.registry.get(id);
    this.selectionLabel.textContent = `${definition.label} · ${definition.description}`;
  }

  public focusSelected(): void {
    this.hotbar.querySelector<HTMLButtonElement>(".block-slot.is-selected")?.focus();
  }

  public dispose(): void {
    this.listeners.abort();
    this.root.remove();
  }

  private bindEvents(): void {
    const { signal } = this.listeners;
    requireElement<HTMLButtonElement>(this.root, "#pause-button").addEventListener(
      "click",
      this.options.onPause,
      { signal },
    );
    requireElement<HTMLButtonElement>(this.root, "#reset-world").addEventListener(
      "click",
      this.options.onReset,
      { signal },
    );

    for (const button of this.slots) {
      button.addEventListener(
        "click",
        () => {
          const id = button.dataset.block as BlockId | undefined;
          if (id) {
            this.options.onSelectBlock(id);
          }
        },
        { signal },
      );
    }

    const toolbar = requireElement<HTMLElement>(this.root, ".hotbar__items");
    toolbar.addEventListener("keydown", this.handleHotbarKeyDown, { signal });

    for (const button of this.root.querySelectorAll<HTMLButtonElement>("[data-action]")) {
      button.addEventListener(
        "click",
        () => {
          const action = button.dataset.action;
          if (action === "break" || action === "place") {
            this.options.onAction(action);
          }
        },
        { signal },
      );
    }

    for (const button of this.root.querySelectorAll<HTMLButtonElement>("[data-move]")) {
      const direction = button.dataset.move;
      if (
        direction !== "forward" &&
        direction !== "back" &&
        direction !== "left" &&
        direction !== "right"
      ) {
        continue;
      }

      const setActive = (active: boolean): void => this.options.onMoveButton(direction, active);
      button.addEventListener("pointerdown", () => setActive(true), { signal });
      button.addEventListener("pointerup", () => setActive(false), { signal });
      button.addEventListener("pointerleave", () => setActive(false), { signal });
      button.addEventListener("pointercancel", () => setActive(false), { signal });
    }
  }

  private readonly handleHotbarKeyDown = (event: KeyboardEvent): void => {
    const keys = ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"];
    if (!keys.includes(event.key)) {
      return;
    }
    event.preventDefault();

    const current = this.slots.findIndex((slot) => slot.classList.contains("is-selected"));
    const last = this.slots.length - 1;
    let next = current < 0 ? 0 : current;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      next = current >= last ? 0 : current + 1;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      next = current <= 0 ? last : current - 1;
    } else if (event.key === "Home") {
      next = 0;
    } else if (event.key === "End") {
      next = last;
    }

    const id = this.slots[next]?.dataset.block as BlockId | undefined;
    if (id) {
      this.options.onSelectBlock(id);
      this.slots[next]?.focus();
    }
  };
}
