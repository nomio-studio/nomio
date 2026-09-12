import { BLOCK_DEFINITIONS, BLOCK_ORDER } from "../game/blocks";
import type { BlockId } from "../game/types";

const keyLabel = (index: number): string => {
  if (index < 9) {
    return String(index + 1);
  }
  if (index === 9) {
    return "0";
  }
  if (index === 10) {
    return "−";
  }
  if (index === 11) {
    return "=";
  }
  return String(index + 1);
};

export interface HudOptions {
  onSelectBlock: (id: BlockId) => void;
  onReset: () => void;
  onStart: () => void;
  onAction: (action: "break" | "place") => void;
  onMoveButton: (direction: "forward" | "back" | "left" | "right", active: boolean) => void;
}

export class Hud {
  private readonly root: HTMLElement;
  private readonly prompt: HTMLElement;
  private readonly targetLabel: HTMLElement;
  private readonly blockCount: HTMLElement;
  private readonly selectionLabel: HTMLElement;
  private readonly hotbar: HTMLElement;

  public constructor(
    container: HTMLElement,
    private readonly options: HudOptions,
  ) {
    container.innerHTML = `
      <div class="hud-layer">
        <header class="brand-lockup" aria-label="nomio voxel garden">
          <span class="brand-spark">✦</span>
          <div>
            <p class="eyebrow">FIELD NOTE / 01</p>
            <h1>nomio</h1>
          </div>
        </header>

        <div class="world-readout" aria-live="polite">
          <span class="eyebrow">ISLAND INVENTORY</span>
          <strong id="block-count">0 blocks</strong>
        </div>

        <div class="target-readout" aria-live="polite">
          <span class="eyebrow">TARGET</span>
          <strong id="target-label">scan the island</strong>
        </div>

        <div class="crosshair" aria-hidden="true"><span></span></div>

        <section class="game-prompt" id="game-prompt">
          <p class="eyebrow">A POCKET-SIZED WORLD</p>
          <h2>Shape a quiet place.</h2>
          <p>Walk the island, collect its colors, and leave one small mark of your own.</p>
          <button class="primary-button" id="start-game" type="button">Enter the island <span>↗</span></button>
          <small>WASD / arrows to move · mouse to look · space to hop</small>
        </section>

        <aside class="controls-card" aria-label="Game controls">
          <span class="eyebrow">FIELD KIT</span>
          <p><kbd>WASD</kbd> move <kbd>SPACE</kbd> hop</p>
          <p><kbd>LMB</kbd> mine <kbd>RMB</kbd> place</p>
          <p><kbd>1–0</kbd> choose <kbd>[ ]</kbd> cycle</p>
          <button class="text-button" id="reset-world" type="button">Reset island <span>↺</span></button>
        </aside>

        <nav class="hotbar" id="hotbar" aria-label="Block palette">
          <span class="eyebrow">MATERIALS</span>
          <div class="hotbar-items">
            ${BLOCK_ORDER.map(
              (id, index) => `
                <button class="block-slot${index === 0 ? " is-selected" : ""}" type="button" data-block="${id}" aria-label="Select ${BLOCK_DEFINITIONS[id].label}" aria-pressed="${index === 0}" title="${BLOCK_DEFINITIONS[id].label} · ${BLOCK_DEFINITIONS[id].description}">
                  <span class="slot-number">${keyLabel(index)}</span>
                  <span class="swatch" style="--swatch: ${BLOCK_DEFINITIONS[id].accent}"></span>
                  <span class="slot-label">${BLOCK_DEFINITIONS[id].label}</span>
                </button>
              `,
            ).join("")}
          </div>
          <p class="selection-label" id="selection-label">Grass · soft ground</p>
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

        <p class="footer-note">Build slowly · the island remembers</p>
      </div>
    `;

    this.root = container;
    this.prompt = this.getElement("game-prompt");
    this.targetLabel = this.getElement("target-label");
    this.blockCount = this.getElement("block-count");
    this.selectionLabel = this.getElement("selection-label");
    this.hotbar = this.getElement("hotbar");
    this.bindEvents();
  }

  public setPointerLocked(locked: boolean): void {
    this.root.classList.toggle("is-playing", locked);
    this.prompt.classList.toggle("is-hidden", locked);
  }

  public setBlockCount(count: number): void {
    this.blockCount.textContent = `${count} ${count === 1 ? "block" : "blocks"}`;
  }

  public setTarget(label: string): void {
    this.targetLabel.textContent = label;
  }

  public selectBlock(id: BlockId): void {
    for (const button of this.hotbar.querySelectorAll<HTMLButtonElement>("[data-block]")) {
      const selected = button.dataset.block === id;
      button.classList.toggle("is-selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    }

    const definition = BLOCK_DEFINITIONS[id];
    this.selectionLabel.textContent = `${definition.label} · ${definition.description}`;
  }

  private bindEvents(): void {
    this.getElement("start-game").addEventListener("click", this.options.onStart);
    this.getElement("reset-world").addEventListener("click", this.options.onReset);

    for (const button of this.hotbar.querySelectorAll<HTMLButtonElement>("[data-block]")) {
      button.addEventListener("click", () => {
        const id = button.dataset.block as BlockId | undefined;
        if (id) {
          this.options.onSelectBlock(id);
        }
      });
    }

    for (const button of this.root.querySelectorAll<HTMLButtonElement>("[data-action]")) {
      button.addEventListener("click", () => {
        const action = button.dataset.action;
        if (action === "break" || action === "place") {
          this.options.onAction(action);
        }
      });
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
      button.addEventListener("pointerdown", () => setActive(true));
      button.addEventListener("pointerup", () => setActive(false));
      button.addEventListener("pointerleave", () => setActive(false));
      button.addEventListener("pointercancel", () => setActive(false));
    }
  }

  private getElement(id: string): HTMLElement {
    const element = this.root.querySelector<HTMLElement>(`#${id}`);
    if (!element) {
      throw new Error(`HUD element #${id} not found`);
    }
    return element;
  }
}
