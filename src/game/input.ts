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

type MoveDirection = "forward" | "back" | "left" | "right";

export class InputManager {
  private readonly keys = new Set<string>();
  private readonly virtualMoves = new Set<MoveDirection>();
  private readonly actions: GameAction[] = [];
  private lookX = 0;
  private lookY = 0;
  private jump = false;
  private touchPoint: { x: number; y: number } | null = null;
  private locked = false;

  public constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly options: InputOptions = {},
  ) {
    this.bindEvents();
  }

  public get isLocked(): boolean {
    return this.locked;
  }

  public requestPointerLock(): void {
    void this.canvas.requestPointerLock();
  }

  public queueAction(action: GameAction): void {
    this.actions.push(action);
  }

  public setVirtualMove(direction: MoveDirection, active: boolean): void {
    if (active) {
      this.virtualMoves.add(direction);
    } else {
      this.virtualMoves.delete(direction);
    }
  }

  public consume(): InputState {
    const moveX =
      Number(
        this.keys.has("KeyD") || this.keys.has("ArrowRight") || this.virtualMoves.has("right"),
      ) -
      Number(this.keys.has("KeyA") || this.keys.has("ArrowLeft") || this.virtualMoves.has("left"));
    const moveZ =
      Number(
        this.keys.has("KeyW") || this.keys.has("ArrowUp") || this.virtualMoves.has("forward"),
      ) -
      Number(this.keys.has("KeyS") || this.keys.has("ArrowDown") || this.virtualMoves.has("back"));

    const state: InputState = {
      moveX,
      moveZ,
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
    window.addEventListener("keydown", this.handleKeyDown);
    window.addEventListener("keyup", this.handleKeyUp);
    window.addEventListener("blur", this.clear);
    document.addEventListener("pointerlockchange", this.handlePointerLockChange);
    document.addEventListener("mousemove", this.handleMouseMove);

    this.canvas.addEventListener("click", this.handleCanvasClick);
    this.canvas.addEventListener("mousedown", this.handleMouseDown);
    this.canvas.addEventListener("contextmenu", this.preventContextMenu);
    this.canvas.addEventListener("touchstart", this.handleTouchStart, { passive: false });
    this.canvas.addEventListener("touchmove", this.handleTouchMove, { passive: false });
    this.canvas.addEventListener("touchend", this.handleTouchEnd, { passive: false });
  }

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    this.keys.add(event.code);
    if (event.code === "Space") {
      event.preventDefault();
      this.jump = true;
    }

    const hotkeySlots: Record<string, number> = {
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
    const slot = hotkeySlots[event.code];
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

  private readonly clear = (): void => {
    this.keys.clear();
    this.virtualMoves.clear();
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

  private readonly handleCanvasClick = (): void => {
    if (!this.locked) {
      this.requestPointerLock();
    }
  };

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

  private readonly handleTouchStart = (event: TouchEvent): void => {
    event.preventDefault();
    const touch = event.touches[0];
    if (touch) {
      this.touchPoint = { x: touch.clientX, y: touch.clientY };
    }
  };

  private readonly handleTouchMove = (event: TouchEvent): void => {
    event.preventDefault();
    const touch = event.touches[0];
    if (!touch || !this.touchPoint) {
      return;
    }
    this.lookX += touch.clientX - this.touchPoint.x;
    this.lookY += touch.clientY - this.touchPoint.y;
    this.touchPoint = { x: touch.clientX, y: touch.clientY };
  };

  private readonly handleTouchEnd = (event: TouchEvent): void => {
    event.preventDefault();
    this.touchPoint = null;
  };
}
