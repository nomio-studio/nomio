export interface AimPoint {
  /** Horizontal normalized device coordinate: -1 is the left edge, 1 the right. */
  x: number;
  /** Vertical normalized device coordinate: -1 is the bottom edge, 1 the top. */
  y: number;
}

export interface InputState {
  moveX: number;
  moveZ: number;
  lookX: number;
  lookY: number;
  jump: boolean;
  /** True while the break input is held; the interactor turns it into progress. */
  breaking: boolean;
  /**
   * Point the player is aiming at this frame, in normalized device coordinates.
   * Touch and pen aim wherever the finger rests; a pointer-lock mouse aims at the
   * screen centre. Null means nothing is aimed, e.g. an idle touch device.
   */
  aim: AimPoint | null;
  /** A pending tap-to-place request, aimed at the block under this point. */
  place: AimPoint | null;
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

const SCREEN_CENTER: AimPoint = { x: 0, y: 0 };

const clampUnit = (value: number): number => Math.min(1, Math.max(-1, value));

/** Movement (CSS px) that turns a pending touch into a look drag instead of a tap. */
const TAP_MOVE_TOLERANCE = 16;
/** Hold time before a stationary touch starts mining. */
const LONG_PRESS_MS = 400;

/**
 * Unifies keyboard, mouse, pen, and touch into one polled `InputState`.
 *
 * Keyboard and pointer-lock mice feed the digital paths and aim at the screen
 * centre. Touch and pen feed the analog paths: a virtual stick supplies a
 * continuous `moveX`/`moveZ`, and the first non-mouse pointer on the canvas both
 * drives the view and edits blocks wherever it lands. That pointer is a gesture —
 * a quick tap places a block under the finger, a stationary hold mines the block
 * under the finger while held, and moving past a small slop turns it into a
 * drag-to-look that aims at nothing. Mining is reported as a held `breaking` flag
 * rather than a stream of actions so the interactor can animate one block's
 * progress. Every pointer is tracked by id and released on `pointerup`,
 * `pointercancel`, blur, or tab hide, so a dropped finger can never leave the
 * player walking forever.
 */
export class InputManager {
  private readonly listeners = new AbortController();
  private readonly keys = new Set<string>();
  private lookX = 0;
  private lookY = 0;
  private jump = false;
  private moveX = 0;
  private moveZ = 0;
  private touchLookScale = 1;
  private lookPointerId: number | null = null;
  private readonly lookOrigin = { x: 0, y: 0 };
  private readonly touchOrigin = { x: 0, y: 0 };
  private touchGesture: "pending" | "look" | "break" = "pending";
  private touchAim: AimPoint | null = null;
  private pendingPlace: AimPoint | null = null;
  private longPressTimer: number | null = null;
  private mouseBreaking = false;
  private touchBreaking = false;
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
    // Leaving play (pause, title, blur) must not leave a break or move latched.
    if (!interactive && this.interactive) {
      this.clear();
    }
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
      breaking: this.mouseBreaking || this.touchBreaking,
      aim: this.locked ? SCREEN_CENTER : this.touchAim,
      place: this.pendingPlace,
    };

    this.lookX = 0;
    this.lookY = 0;
    this.jump = false;
    this.pendingPlace = null;
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
    this.canvas.addEventListener("pointercancel", this.handleCanvasPointerCancel, { signal });
    this.canvas.addEventListener("mousedown", this.handleMouseDown, { signal });
    this.canvas.addEventListener("mouseup", this.handleMouseUp, { signal });
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
    this.mouseBreaking = false;
    this.touchBreaking = false;
    this.touchAim = null;
    this.pendingPlace = null;
    this.clearGestureTimers();
    if (this.lookPointerId !== null) {
      this.releaseLookPointer(this.lookPointerId);
    }
  };

  private readonly handlePointerLockChange = (): void => {
    this.locked = document.pointerLockElement === this.canvas;
    if (!this.locked) {
      this.mouseBreaking = false;
    }
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
    if (!this.interactive || this.lookPointerId !== null) {
      return;
    }

    this.lookPointerId = event.pointerId;
    this.lookOrigin.x = event.clientX;
    this.lookOrigin.y = event.clientY;
    this.touchOrigin.x = event.clientX;
    this.touchOrigin.y = event.clientY;
    this.touchAim = this.toAim(event.clientX, event.clientY);
    this.touchGesture = "pending";
    this.armLongPress();
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
    const deltaX = event.clientX - this.lookOrigin.x;
    const deltaY = event.clientY - this.lookOrigin.y;
    this.lookOrigin.x = event.clientX;
    this.lookOrigin.y = event.clientY;

    // Once the finger travels past the tap slop the gesture is a look drag: it
    // cancels the pending tap, clears the aim, and stops any in-progress mining.
    if (
      this.touchGesture !== "look" &&
      Math.hypot(event.clientX - this.touchOrigin.x, event.clientY - this.touchOrigin.y) >
        TAP_MOVE_TOLERANCE
    ) {
      this.touchGesture = "look";
      this.touchBreaking = false;
      this.touchAim = null;
      this.clearGestureTimers();
    }

    if (this.touchGesture === "look") {
      this.lookX += deltaX * this.touchLookScale;
      this.lookY += deltaY * this.touchLookScale;
    } else {
      // While a tap or hold is pending, keep the edit aim under the finger.
      this.touchAim = this.toAim(event.clientX, event.clientY);
    }
    event.preventDefault();
  };

  private readonly handleCanvasPointerUp = (event: PointerEvent): void => {
    if (event.pointerId !== this.lookPointerId) {
      return;
    }
    const tapped = this.touchGesture === "pending";
    const aim = this.touchAim;
    this.releaseLookPointer(event.pointerId);
    if (tapped && aim) {
      this.pendingPlace = aim;
    }
  };

  /** Cancels a lost touch without turning it into an accidental placement. */
  private readonly handleCanvasPointerCancel = (event: PointerEvent): void => {
    if (event.pointerId === this.lookPointerId) {
      this.releaseLookPointer(event.pointerId);
    }
  };

  /** Starts mining once the touch has been held still long enough. */
  private armLongPress(): void {
    this.clearGestureTimers();
    this.longPressTimer = window.setTimeout(() => {
      this.longPressTimer = null;
      this.touchGesture = "break";
      this.touchBreaking = true;
    }, LONG_PRESS_MS);
  }

  private clearGestureTimers(): void {
    if (this.longPressTimer !== null) {
      window.clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
  }

  private releaseLookPointer(pointerId: number): void {
    this.clearGestureTimers();
    this.touchBreaking = false;
    this.touchAim = null;
    this.lookPointerId = null;
    this.touchGesture = "pending";
    try {
      this.canvas.releasePointerCapture(pointerId);
    } catch {
      // Capture may already have been released by the browser.
    }
  }

  /** Converts a client-space point to normalized device coordinates. */
  private toAim(clientX: number, clientY: number): AimPoint {
    const rect = this.canvas.getBoundingClientRect();
    const width = rect.width || 1;
    const height = rect.height || 1;
    return {
      x: ((clientX - rect.left) / width) * 2 - 1,
      y: -((clientY - rect.top) / height) * 2 + 1,
    };
  }

  private readonly handleMouseDown = (event: MouseEvent): void => {
    if (!this.locked) {
      return;
    }

    if (event.button === 0) {
      this.mouseBreaking = true;
    } else if (event.button === 2) {
      this.pendingPlace = SCREEN_CENTER;
    }
  };

  private readonly handleMouseUp = (event: MouseEvent): void => {
    if (event.button === 0) {
      this.mouseBreaking = false;
    }
  };

  private readonly preventContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
  };
}
