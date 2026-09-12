/**
 * Shared palette and layout constants.
 *
 * The same values are declared as CSS custom properties in `style.css`; this
 * module is the single source for values the Three.js layer needs (the target
 * reticle) so the accent is not duplicated as a magic number.
 */
export const PALETTE = {
  ink: "#101820",
  mineral: "#6d97a8",
  stone: "#d6c3a5",
  lichen: "#98b27f",
  coral: "#f27b63",
  parchment: "#f3eee4",
} as const;

/** Signal coral as a numeric color for Three.js materials. */
export const ACCENT_COLOR = 0xf27b63;
