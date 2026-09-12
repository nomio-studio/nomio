export type ToastTone = "info" | "success" | "danger";

export interface ToastStackOptions {
  /** When true, skip the exit transition and remove toasts immediately. */
  prefersReducedMotion: () => boolean;
}

const MAX_VISIBLE = 3;
const LIFETIME_MS = 2600;
const EXIT_MS = 180;

/**
 * Transient confirmations ("Mined Grass", "Island reset"). The container is a
 * stable polite live region created before the first message so screen readers
 * announce updates reliably.
 */
export class ToastStack {
  private readonly timers = new Set<number>();
  private readonly active: HTMLElement[] = [];

  public constructor(
    private readonly container: HTMLElement,
    private readonly options: ToastStackOptions,
  ) {}

  public push(message: string, tone: ToastTone = "info"): void {
    const toast = document.createElement("div");
    toast.className = `toast toast--${tone}`;
    toast.dataset.tone = tone;
    toast.textContent = message;
    this.container.append(toast);
    this.active.push(toast);
    this.animateEnter(toast);

    while (this.active.length > MAX_VISIBLE) {
      const oldest = this.active.shift();
      if (oldest) {
        this.remove(oldest, true);
      }
    }

    this.schedule(toast, LIFETIME_MS);
  }

  public dispose(): void {
    for (const timer of this.timers) {
      window.clearTimeout(timer);
    }
    this.timers.clear();
    this.active.length = 0;
    this.container.replaceChildren();
  }

  private animateEnter(toast: HTMLElement): void {
    if (this.options.prefersReducedMotion()) {
      return;
    }
    toast.classList.add("is-entering");
    requestAnimationFrame(() => toast.classList.remove("is-entering"));
  }

  private schedule(toast: HTMLElement, delay: number): void {
    const timer = window.setTimeout(() => {
      this.timers.delete(timer);
      this.remove(toast, false);
    }, delay);
    this.timers.add(timer);
  }

  private remove(toast: HTMLElement, immediate: boolean): void {
    const index = this.active.indexOf(toast);
    if (index >= 0) {
      this.active.splice(index, 1);
    }

    if (immediate || this.options.prefersReducedMotion()) {
      toast.remove();
      return;
    }

    toast.classList.add("is-leaving");
    const timer = window.setTimeout(() => {
      this.timers.delete(timer);
      toast.remove();
    }, EXIT_MS);
    this.timers.add(timer);
  }
}
