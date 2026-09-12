/** Returns the first matching descendant, throwing when the shell is malformed. */
export const requireElement = <T extends Element>(root: ParentNode, selector: string): T => {
  const element = root.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Required UI element not found: ${selector}`);
  }
  return element;
};

/** Clamps a number into an inclusive range. */
export const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/**
 * True when the active device exposes touch input. `maxTouchPoints` catches
 * phones and tablets even before the first gesture; the coarse-pointer query is
 * a fallback for browsers that under-report touch points.
 */
export const isTouchDevice = (): boolean => {
  if (typeof navigator !== "undefined" && navigator.maxTouchPoints > 0) {
    return true;
  }
  return typeof window !== "undefined" && window.matchMedia("(any-pointer: coarse)").matches;
};

/** Keyboard slot labels for the block palette: 1-9, 0, minus, equals. */
export const formatSlotKey = (index: number): string => {
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

/**
 * Keeps every element except `active` out of the tab order. Used for the
 * hotbar toolbar, following the roving-tabindex pattern.
 */
export const setRovingTabIndex = (
  items: readonly HTMLElement[],
  active: HTMLElement | null,
): void => {
  for (const item of items) {
    item.tabIndex = item === active ? 0 : -1;
  }
};
