export type TextureFace = "top" | "side" | "bottom";

export interface TextureRecipe {
  pattern: string;
  palette: readonly string[];
  seed: number;
  roughness?: number;
  metalness?: number;
  transparent?: boolean;
  opacity?: number;
  /** Light level (0-15) this block emits into the voxel light engine. */
  lightEmission?: number;
}
