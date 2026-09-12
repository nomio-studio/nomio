export type GameAction = "break" | "place";

export interface InputState {
  moveX: number;
  moveZ: number;
  lookX: number;
  lookY: number;
  jump: boolean;
  actions: GameAction[];
}

export interface InputOptions {
  onBlockHotkey?: (slot: number) => void;
  onCycleBlock?: (direction: -1 | 1) => void;
  onPointerLockChange?: (locked: boolean) => void;
}

const BLOCK_HOTKEY_SLOTS: Readonly<Record<string, number>> = {
  Digit1: 0,
  Digit2: 1,
  Digit3: 2,
  Digit4: 3,
  Digit5: 4,
  Digit6: 5,
  Digit7: 6,
  Digit8: 7,
  Digit9: 8,
  Digit0: 9,
  Minus: 10,
  Equal: 11,
};

const clampUnit = (value: number): number => Math.min(1, Math.max(-1, value));

/**
 * Unifies keyboard, mouse, pen, and touch into one polled `InputState`.
 *
 * Keyboard and pointer-lock mice feed the digital paths. Touch and pen feed the
 * analog paths: a virtual stick supplies a continuous `moveX`/`moveZ`, and the
 * first non-mouse pointer on the canvas drags the view. Every pointer is tracked
 * by id and released on `pointerup`, `pointercancel`, blur, or tab hide, so a
 * dropped finger can never leave the player walking forever.
 */
export class InputManager {
  private readonly listeners = new AbortController();
  private readonly keys = new Set<string>();
  private readonly actions: GameAction[] = [];
  private lookX = 0;
  private lookY = 0;
  private jump = false;
  private moveX = 0;
  private moveZ = 0;
  private touchLookScale = 1;
  private lookPointerId: number | null = null;
  private readonly lookOrigin = { x: 0, y: 0 };
  private locked = false;
  private interactive = true;

  public constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly options: InputOptions = {},
  ) {
    this.bindEvents();
  }

  public get isLocked(): boolean {
    return this.locked;
  }

  /**
   * Enables pointer-lock capture from canvas presses. Disabled on the title and
   * loading screens so only the explicit start action begins play.
   */
  public setInteractive(interactive: boolean): void {
    this.interactive = interactive;
  }

  public requestPointerLock(): Promise<boolean> {
    try {
      const result = this.canvas.requestPointerLock() as unknown;
      if (result && typeof (result as Promise<void>).then === "function") {
        return (result as Promise<void>).then(
          () => true,
          () => false,
        );
      }
    } catch {
      return Promise.resolve(false);
    }
    return Promise.resolve(true);
  }

  public exitPointerLock(): void {
    if (document.pointerLockElement === this.canvas) {
      document.exitPointerLock();
    }
  }

  public queueAction(action: GameAction): void {
    this.actions.push(action);
  }

  public dispose(): void {
    this.listeners.abort();
    this.clear();
    if (this.locked) {
      document.exitPointerLock();
    }
    this.locked = false;
  }

  /** Analog movement from the virtual stick, clamped to the unit circle. */
  public setMoveVector(x: number, z: number): void {
    const magnitude = Math.hypot(x, z);
    if (magnitude > 1) {
      this.moveX = x / magnitude;
      this.moveZ = z / magnitude;
      return;
    }
    this.moveX = clampUnit(x);
    this.moveZ = clampUnit(z);
  }

  /** Queues a jump, used by the on-screen jump button. */
  public requestJump(): void {
    this.jump = true;
  }

  /** Scales pointer deltas from touch/pen, so touch can feel distinct from mouse. */
  public setTouchLookScale(scale: number): void {
    this.touchLookScale = scale > 0 ? scale : 1;
  }

  public consume(): InputState {
    const digitalX =
      Number(this.keys.has("KeyD") || this.keys.has("ArrowRight")) -
      Number(this.keys.has("KeyA") || this.keys.has("ArrowLeft"));
    const digitalZ =
      Number(this.keys.has("KeyW") || this.keys.has("ArrowUp")) -
      Number(this.keys.has("KeyS") || this.keys.has("ArrowDown"));
    const analog = this.moveX !== 0 || this.moveZ !== 0;

    const state: InputState = {
      moveX: analog ? this.moveX : digitalX,
      moveZ: analog ? this.moveZ : digitalZ,
      lookX: this.lookX,
      lookY: this.lookY,
      jump: this.jump,
      actions: [...this.actions],
    };

    this.lookX = 0;
    this.lookY = 0;
    this.jump = false;
    this.actions.length = 0;
    return state;
  }

  private bindEvents(): void {
    const { signal } = this.listeners;
    window.addEventListener("keydown", this.handleKeyDown, { signal });
    window.addEventListener("keyup", this.handleKeyUp, { signal });
    window.addEventListener("blur", this.clear, { signal });
    document.addEventListener("visibilitychange", this.handleVisibilityChange, { signal });
    document.addEventListener("pointerlockchange", this.handlePointerLockChange, { signal });
    document.addEventListener("mousemove", this.handleMouseMove, { signal });

    this.canvas.addEventListener("pointerdown", this.handleCanvasPointerDown, { signal });
    this.canvas.addEventListener("pointermove", this.handleCanvasPointerMove, { signal });
    this.canvas.addEventListener("pointerup", this.handleCanvasPointerUp, { signal });
    this.canvas.addEventListener("pointercancel", this.handleCanvasPointerUp, { signal });
    this.canvas.addEventListener("mousedown", this.handleMouseDown, { signal });
    this.canvas.addEventListener("contextmenu", this.preventContextMenu, { signal });
  }

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    this.keys.add(event.code);
    if (event.code === "Space" && !event.repeat) {
      event.preventDefault();
      this.jump = true;
    }

    const slot = BLOCK_HOTKEY_SLOTS[event.code];
    if (slot !== undefined) {
      this.options.onBlockHotkey?.(slot);
    } else if (event.code === "BracketLeft") {
      this.options.onCycleBlock?.(-1);
    } else if (event.code === "BracketRight") {
      this.options.onCycleBlock?.(1);
    }
  };

  private readonly handleKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code);
  };

  private readonly handleVisibilityChange = (): void => {
    if (document.hidden) {
      this.clear();
    }
  };

  private readonly clear = (): void => {
    this.keys.clear();
    this.lookX = 0;
    this.lookY = 0;
    this.jump = false;
    this.moveX = 0;
    this.moveZ = 0;
    this.actions.length = 0;
    if (this.lookPointerId !== null) {
      this.releaseLookPointer(this.lookPointerId);
    }
  };

  private readonly handlePointerLockChange = (): void => {
    this.locked = document.pointerLockElement === this.canvas;
    this.options.onPointerLockChange?.(this.locked);
  };

  private readonly handleMouseMove = (event: MouseEvent): void => {
    if (!this.locked) {
      return;
    }
    this.lookX += event.movementX;
    this.lookY += event.movementY;
  };

  private readonly handleCanvasPointerDown = (event: PointerEvent): void => {
    if (event.pointerType === "mouse") {
      if (this.interactive && !this.locked) {
        void this.requestPointerLock();
      }
      return;
    }
    if (this.lookPointerId !== null) {
      return;
    }

    this.lookPointerId = event.pointerId;
    this.lookOrigin.x = event.clientX;
    this.lookOrigin.y = event.clientY;
    try {
      this.canvas.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is best-effort; dragging still works without it.
    }
    event.preventDefault();
  };

  private readonly handleCanvasPointerMove = (event: PointerEvent): void => {
    if (event.pointerId !== this.lookPointerId) {
      return;
    }
    this.lookX += (event.clientX - this.lookOrigin.x) * this.touchLookScale;
    this.lookY += (event.clientY - this.lookOrigin.y) * this.touchLookScale;
    this.lookOrigin.x = event.clientX;
    this.lookOrigin.y = event.clientY;
    event.preventDefault();
  };

  private readonly handleCanvasPointerUp = (event: PointerEvent): void => {
    if (event.pointerId !== this.lookPointerId) {
      return;
    }
    this.releaseLookPointer(event.pointerId);
  };

  private releaseLookPointer(pointerId: number): void {
    this.lookPointerId = null;
    try {
      this.canvas.releasePointerCapture(pointerId);
    } catch {
      // Capture may already have been released by the browser.
    }
  }

  private readonly handleMouseDown = (event: MouseEvent): void => {
    if (!this.locked) {
      return;
    }

    if (event.button === 0) {
      this.queueAction("break");
    } else if (event.button === 2) {
      this.queueAction("place");
    }
  };

  private readonly preventContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
  };
}
