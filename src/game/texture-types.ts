export type TextureFace = "top" | "side" | "bottom";

export interface TextureRecipe {
  pattern: string;
  palette: readonly string[];
  seed: number;
  roughness?: number;
  metalness?: number;
  transparent?: boolean;
  opacity?: number;
}
