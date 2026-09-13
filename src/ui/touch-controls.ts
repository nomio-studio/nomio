import { requireElement } from "./dom";

export interface TouchControlsOptions {
  /** Analog movement: `x` strafes right, `z` walks forward, both in -1..1. */
  onMove: (x: number, z: number) => void;
  onJump: () => void;
}

/** Maximum knob travel in CSS pixels; also the visual base radius. */
const STICK_TRAVEL = 58;
/** Fraction of travel ignored around the centre, then rescaled to full range. */
const DEAD_ZONE = 0.16;
const EDGE_PADDING = 20;

/**
 * On-screen controls for touch devices: a floating analog stick on the left and
 * a Jump button on the right. Looking, mining, and placing are gestures on the
 * canvas itself — drag to look, tap to place, hold to mine — so the screen stays
 * clear of reticle controls.
 *
 * The stick is "floating" so a player can grab it anywhere in the left zone
 * rather than hunting for a fixed pad.
 */
export class TouchControls {
  private readonly listeners = new AbortController();
  private readonly layer: HTMLElement;
  private readonly zone: HTMLElement;
  private readonly base: HTMLElement;
  private readonly knob: HTMLElement;
  private readonly jumpButton: HTMLButtonElement;
  private readonly resizeObserver: ResizeObserver;
  private movePointerId: number | null = null;
  private readonly start = { x: 0, y: 0 };

  public constructor(
    container: HTMLElement,
    private readonly options: TouchControlsOptions,
  ) {
    container.insertAdjacentHTML(
      "beforeend",
      `
      <div class="touch-layer" id="touch-layer">
        <div class="touch-move" id="touch-move" aria-hidden="true">
          <div class="touch-move__base" id="touch-base">
            <div class="touch-move__knob" id="touch-knob"></div>
          </div>
        </div>
        <div class="touch-actions" role="group" aria-label="Touch actions">
          <button class="touch-button touch-button--jump" type="button" data-touch="jump" aria-label="Jump">Jump</button>
        </div>
      </div>
    `,
    );

    this.layer = requireElement<HTMLElement>(container, "#touch-layer");
    this.zone = requireElement<HTMLElement>(container, "#touch-move");
    this.base = requireElement<HTMLElement>(container, "#touch-base");
    this.knob = requireElement<HTMLElement>(container, "#touch-knob");
    this.jumpButton = requireElement<HTMLButtonElement>(container, "[data-touch='jump']");

    this.bindStick();
    this.bindJump();
    this.resizeObserver = new ResizeObserver(() => this.resetStick());
    this.resizeObserver.observe(this.zone);
    this.resetStick();
  }

  public dispose(): void {
    this.listeners.abort();
    this.resizeObserver.disconnect();
    this.layer.remove();
  }

  private bindStick(): void {
    const { signal } = this.listeners;
    this.zone.addEventListener("pointerdown", this.handleStickDown, { signal });
    this.zone.addEventListener("pointermove", this.handleStickMove, { signal });
    this.zone.addEventListener("pointerup", this.handleStickUp, { signal });
    this.zone.addEventListener("pointercancel", this.handleStickUp, { signal });
    this.zone.addEventListener("lostpointercapture", this.handleStickUp, { signal });
    window.addEventListener("blur", this.releaseAll, { signal });
    document.addEventListener("visibilitychange", this.handleVisibilityChange, { signal });
  }

  private bindJump(): void {
    const { signal } = this.listeners;
    this.jumpButton.addEventListener(
      "pointerdown",
      (event) => {
        event.preventDefault();
        try {
          this.jumpButton.setPointerCapture(event.pointerId);
        } catch {
          // Capture is best-effort.
        }
        this.jumpButton.classList.add("is-pressed");
        this.options.onJump();
      },
      { signal },
    );

    for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
      this.jumpButton.addEventListener(type, () => this.jumpButton.classList.remove("is-pressed"), {
        signal,
      });
    }
  }

  private readonly handleStickDown = (event: PointerEvent): void => {
    if (this.movePointerId !== null) {
      return;
    }

    const rect = this.zone.getBoundingClientRect();
    this.movePointerId = event.pointerId;
    this.start.x = event.clientX;
    this.start.y = event.clientY;
    this.placeBase(event.clientX - rect.left, event.clientY - rect.top);
    this.setKnob(0, 0);
    this.zone.classList.add("is-active");
    try {
      this.zone.setPointerCapture(event.pointerId);
    } catch {
      // Dragging still works without capture.
    }
    event.preventDefault();
  };

  private readonly handleStickMove = (event: PointerEvent): void => {
    if (event.pointerId !== this.movePointerId) {
      return;
    }

    let dx = event.clientX - this.start.x;
    let dy = event.clientY - this.start.y;
    const distance = Math.hypot(dx, dy);
    if (distance > STICK_TRAVEL) {
      dx = (dx / distance) * STICK_TRAVEL;
      dy = (dy / distance) * STICK_TRAVEL;
    }

    this.setKnob(dx, dy);
    this.emitStick(dx / STICK_TRAVEL, -dy / STICK_TRAVEL);
    event.preventDefault();
  };

  private readonly handleStickUp = (event: PointerEvent): void => {
    if (event.pointerId !== this.movePointerId) {
      return;
    }

    this.movePointerId = null;
    try {
      this.zone.releasePointerCapture(event.pointerId);
    } catch {
      // Capture may already be gone.
    }
    this.zone.classList.remove("is-active");
    this.options.onMove(0, 0);
    this.resetStick();
  };

  private readonly handleVisibilityChange = (): void => {
    if (document.hidden) {
      this.releaseAll();
    }
  };

  private readonly releaseAll = (): void => {
    this.jumpButton.classList.remove("is-pressed");
    if (this.movePointerId !== null) {
      const pointerId = this.movePointerId;
      this.movePointerId = null;
      try {
        this.zone.releasePointerCapture(pointerId);
      } catch {
        // Capture may already be gone.
      }
    }
    this.zone.classList.remove("is-active");
    this.options.onMove(0, 0);
    this.resetStick();
  };

  private emitStick(nx: number, ny: number): void {
    const magnitude = Math.hypot(nx, ny);
    if (magnitude < DEAD_ZONE) {
      this.options.onMove(0, 0);
      return;
    }
    const scaled = (Math.min(magnitude, 1) - DEAD_ZONE) / (1 - DEAD_ZONE);
    this.options.onMove((nx / magnitude) * scaled, (ny / magnitude) * scaled);
  }

  private setKnob(dx: number, dy: number): void {
    this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  }

  private placeBase(x: number, y: number): void {
    this.base.style.left = `${x}px`;
    this.base.style.top = `${y}px`;
  }

  private resetStick(): void {
    if (this.movePointerId !== null) {
      return;
    }
    const rect = this.zone.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      return;
    }
    const radius = this.base.offsetWidth / 2 || STICK_TRAVEL;
    const x = Math.min(rect.width - radius - EDGE_PADDING, EDGE_PADDING + radius);
    const y = Math.max(radius + EDGE_PADDING, rect.height - EDGE_PADDING - radius);
    this.placeBase(x, y);
    this.setKnob(0, 0);
  }
}
