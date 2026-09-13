import * as THREE from "three";
import type { TextureFace, TextureRecipe } from "./texture-types";

export const TEXTURE_SIZE = 64;

export interface TextureDrawContext {
  context: CanvasRenderingContext2D;
  face: TextureFace;
  palette: readonly string[];
  random: () => number;
  size: number;
}

export type TextureDrawer = (context: TextureDrawContext) => void;

const textureDrawers = new Map<string, TextureDrawer>();

const createRandom = (seed: number): (() => number) => {
  let state = seed >>> 0 || 1;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  };
};

const pick = <T>(values: readonly T[], random: () => number): T => {
  const value = values[Math.floor(random() * values.length)];
  return value ?? values[0];
};

const alphaColor = (color: string, alpha: number): string => {
  const value = color.replace("#", "");
  const number = Number.parseInt(value, 16);
  const red = (number >> 16) & 255;
  const green = (number >> 8) & 255;
  const blue = number & 255;
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
};

const fillBase = (draw: TextureDrawContext, color = draw.palette[0]): void => {
  draw.context.fillStyle = color ?? "#888888";
  draw.context.fillRect(0, 0, draw.size, draw.size);
};

const noise = (
  draw: TextureDrawContext,
  amount: number,
  minSize: number,
  maxSize: number,
  alpha = 0.5,
): void => {
  const { context, palette, random, size } = draw;
  for (let index = 0; index < amount; index += 1) {
    const pixelSize = Math.max(1, Math.floor(minSize + random() * (maxSize - minSize + 1)));
    context.fillStyle = alphaColor(pick(palette, random), alpha * (0.55 + random() * 0.45));
    context.fillRect(
      Math.floor(random() * size),
      Math.floor(random() * size),
      pixelSize,
      pixelSize,
    );
  }
};

const drawGrass: TextureDrawer = (draw) => {
  const { context, face, palette, random, size } = draw;
  fillBase(draw, face === "top" ? palette[1] : palette[2]);
  if (face === "side") {
    context.fillStyle = palette[0] ?? "#77935f";
    context.fillRect(0, 0, size, 7);
    for (let index = 0; index < 16; index += 1) {
      context.fillStyle = palette[index % 3] ?? "#77935f";
      context.fillRect(Math.floor(random() * size), 4 + Math.floor(random() * 6), 1, 4);
    }
  }
  noise(draw, face === "top" ? 230 : 130, 1, 3, 0.28);
  noise(draw, 24, 2, 4, 0.26);
};

const drawDirt: TextureDrawer = (draw) => {
  fillBase(draw);
  noise(draw, 270, 1, 3, 0.38);
  noise(draw, 40, 2, 4, 0.3);
};

const drawStone: TextureDrawer = (draw) => {
  fillBase(draw);
  noise(draw, 250, 1, 2, 0.35);
  noise(draw, 55, 2, 4, 0.34);
  const { context, palette, random } = draw;
  for (let index = 0; index < 18; index += 1) {
    context.fillStyle = alphaColor(palette[2] ?? "#333333", 0.28);
    context.fillRect(Math.floor(random() * 60), Math.floor(random() * 60), 4, 1);
  }
};

const drawCobble: TextureDrawer = (draw) => {
  const { context, palette, random, size } = draw;
  fillBase(draw, palette[2] ?? "#555555");
  for (let row = -1; row < 5; row += 1) {
    for (let column = -1; column < 5; column += 1) {
      const x = column * 17 + Math.floor(random() * 4) - 2;
      const y = row * 17 + Math.floor(random() * 4) - 2;
      const width = 13 + Math.floor(random() * 4);
      const height = 11 + Math.floor(random() * 5);
      context.fillStyle = pick(palette.slice(0, 3), random) ?? "#777777";
      context.beginPath();
      context.moveTo(x + 3, y);
      context.lineTo(x + width - 2, y + 1);
      context.lineTo(x + width, y + height - 3);
      context.lineTo(x + width - 4, y + height);
      context.lineTo(x + 1, y + height - 2);
      context.closePath();
      context.fill();
    }
  }
  context.strokeStyle = alphaColor(palette[3] ?? "#202020", 0.65);
  context.lineWidth = 2;
  for (let position = 0; position <= size; position += 16) {
    context.strokeRect(position, 0, 1, size);
    context.strokeRect(0, position, size, 1);
  }
  noise(draw, 55, 1, 2, 0.25);
};

const drawSand: TextureDrawer = (draw) => {
  fillBase(draw);
  noise(draw, 410, 1, 1, 0.24);
  noise(draw, 50, 1, 2, 0.22);
  const { context, palette, random, size } = draw;
  context.fillStyle = alphaColor(palette[2] ?? "#8f724e", 0.35);
  for (let index = 0; index < 32; index += 1) {
    const x = Math.floor(random() * size);
    const y = Math.floor(random() * size);
    context.fillRect(x, y, 1, 2);
  }
};

const drawLog: TextureDrawer = (draw) => {
  const { context, face, palette, random, size } = draw;
  fillBase(draw, palette[1] ?? "#8c5c35");
  if (face === "top" || face === "bottom") {
    context.fillStyle = palette[0] ?? "#b47c49";
    context.fillRect(5, 5, size - 10, size - 10);
    for (let inset = 8; inset < 28; inset += 6) {
      context.strokeStyle = palette[inset % 2] ?? "#6b3f25";
      context.lineWidth = 2;
      context.strokeRect(inset, inset, size - inset * 2, size - inset * 2);
    }
    context.fillStyle = palette[2] ?? "#4c2d1d";
    context.fillRect(30, 30, 5, 5);
  } else {
    for (let x = 3; x < size; x += 8) {
      context.fillStyle = x % 3 === 0 ? (palette[0] ?? "#b47c49") : (palette[2] ?? "#6b3f25");
      context.fillRect(x, 0, 3, size);
    }
    noise(draw, 42, 1, 2, 0.28);
  }
  context.fillStyle = alphaColor(palette[3] ?? "#2f1a12", 0.34);
  for (let index = 0; index < 18; index += 1) {
    context.fillRect(Math.floor(random() * size), Math.floor(random() * size), 1, 3);
  }
};

const drawPlanks: TextureDrawer = (draw) => {
  const { context, palette, random, size } = draw;
  fillBase(draw);
  context.strokeStyle = alphaColor(palette[2] ?? "#5c3b24", 0.7);
  context.lineWidth = 2;
  for (let position = 0; position <= size; position += 16) {
    context.beginPath();
    context.moveTo(0, position);
    context.lineTo(size, position);
    context.stroke();
  }
  for (let row = 0; row < 4; row += 1) {
    const offset = row % 2 === 0 ? 0 : 8;
    for (let column = -1; column < 5; column += 1) {
      context.fillStyle = alphaColor(palette[1] ?? "#9d6c3b", 0.3);
      context.fillRect(column * 16 + offset + Math.floor(random() * 3), row * 16 + 4, 1, 6);
    }
  }
  noise(draw, 85, 1, 2, 0.25);
};

const drawLeaves: TextureDrawer = (draw) => {
  const { context, palette, random, size } = draw;
  fillBase(draw, palette[1] ?? "#4e7d45");
  for (let index = 0; index < 280; index += 1) {
    const pixelSize = random() > 0.86 ? 3 : 1 + Math.floor(random() * 2);
    context.fillStyle = alphaColor(pick(palette, random) ?? "#4e7d45", 0.7 + random() * 0.3);
    context.fillRect(
      Math.floor(random() * size),
      Math.floor(random() * size),
      pixelSize,
      pixelSize,
    );
  }
  context.fillStyle = alphaColor(palette[2] ?? "#203d29", 0.45);
  for (let index = 0; index < 26; index += 1) {
    context.fillRect(Math.floor(random() * size), Math.floor(random() * size), 2, 2);
  }
};

const drawGlass: TextureDrawer = (draw) => {
  const { context, palette, random, size } = draw;
  fillBase(draw, alphaColor(palette[0] ?? "#a9d7d3", 0.1));
  context.strokeStyle = alphaColor(palette[1] ?? "#ffffff", 0.72);
  context.lineWidth = 2;
  context.strokeRect(2, 2, size - 4, size - 4);
  context.strokeStyle = alphaColor(palette[2] ?? "#7cb1b3", 0.42);
  context.lineWidth = 3;
  context.beginPath();
  context.moveTo(7, 48);
  context.lineTo(48, 7);
  context.stroke();
  context.fillStyle = alphaColor(palette[1] ?? "#ffffff", 0.42);
  for (let index = 0; index < 22; index += 1) {
    context.fillRect(Math.floor(random() * size), Math.floor(random() * size), 1, 1);
  }
};

const drawBrick: TextureDrawer = (draw) => {
  const { context, palette, size } = draw;
  fillBase(draw);
  context.fillStyle = palette[2] ?? "#7a3025";
  for (let row = 0; row < 4; row += 1) {
    const y = row * 16;
    context.fillRect(0, y, size, 3);
    const offset = row % 2 === 0 ? 0 : 8;
    for (let x = offset; x < size; x += 16) {
      context.fillRect(x, y, 3, 16);
    }
  }
  noise(draw, 105, 1, 2, 0.2);
};

const drawSnow: TextureDrawer = (draw) => {
  const { context, face, palette, random, size } = draw;
  fillBase(draw, palette[0] ?? "#e9f1ed");
  if (face === "side") {
    context.fillStyle = palette[2] ?? "#b8d1d3";
    context.fillRect(0, size - 7, size, 7);
    context.fillStyle = palette[1] ?? "#f9fcf7";
    context.fillRect(0, 0, size, 4);
  }
  noise(draw, 180, 1, 2, 0.18);
  context.fillStyle = alphaColor(palette[3] ?? "#8faeb5", 0.25);
  for (let index = 0; index < 22; index += 1) {
    context.fillRect(Math.floor(random() * size), Math.floor(random() * size), 2, 1);
  }
};

const drawNetherrack: TextureDrawer = (draw) => {
  const { context, palette, random, size } = draw;
  fillBase(draw);
  noise(draw, 250, 1, 3, 0.38);
  for (let index = 0; index < 34; index += 1) {
    context.fillStyle = alphaColor(palette[2] ?? "#4d171a", 0.7);
    context.fillRect(Math.floor(random() * size), Math.floor(random() * size), 3, 2);
    context.fillStyle = alphaColor(palette[3] ?? "#c46c4c", 0.5);
    context.fillRect(Math.floor(random() * size), Math.floor(random() * size), 2, 1);
  }
};

const drawObsidian: TextureDrawer = (draw) => {
  const { context, palette, random, size } = draw;
  fillBase(draw);
  noise(draw, 150, 1, 2, 0.22);
  context.strokeStyle = alphaColor(palette[2] ?? "#744aa0", 0.42);
  context.lineWidth = 2;
  for (let index = -2; index < 8; index += 1) {
    context.beginPath();
    context.moveTo(index * 14, size);
    context.lineTo(index * 14 + 31, 0);
    context.stroke();
  }
  context.fillStyle = alphaColor(palette[3] ?? "#b38ee0", 0.32);
  for (let index = 0; index < 18; index += 1) {
    context.fillRect(Math.floor(random() * size), Math.floor(random() * size), 1, 2);
  }
};

const drawOre: TextureDrawer = (draw) => {
  const { context, palette, random, size } = draw;
  fillBase(draw, palette[0] ?? "#777b76");
  noise(draw, 180, 1, 2, 0.32);
  for (let index = 0; index < 15; index += 1) {
    const x = Math.floor(random() * (size - 7));
    const y = Math.floor(random() * (size - 7));
    context.fillStyle = palette[3] ?? "#222222";
    context.fillRect(x, y, 4, 3);
    context.fillStyle = palette[2] ?? "#111111";
    context.fillRect(x + 1, y + 3, 3, 2);
    context.fillStyle = alphaColor(palette[1] ?? "#d0d0d0", 0.55);
    context.fillRect(x + 1, y, 2, 1);
  }
};

const drawMossyCobble: TextureDrawer = (draw) => {
  drawCobble(draw);
  const { context, palette, random, size } = draw;
  context.fillStyle = alphaColor(palette[4] ?? "#72955c", 0.75);
  for (let index = 0; index < 28; index += 1) {
    context.fillRect(Math.floor(random() * size), Math.floor(random() * size), 2, 2);
  }
};

const drawCrystal: TextureDrawer = (draw) => {
  const { context, palette, random, size } = draw;
  fillBase(draw, palette[0] ?? "#315d79");
  noise(draw, 110, 1, 2, 0.3);
  context.fillStyle = alphaColor(palette[2] ?? "#9fd6df", 0.72);
  for (let index = 0; index < 16; index += 1) {
    const x = Math.floor(random() * (size - 8));
    const y = Math.floor(random() * (size - 8));
    context.fillRect(x, y, 2, 7);
    context.fillRect(x + 2, y + 2, 3, 3);
  }
  context.fillStyle = alphaColor(palette[3] ?? "#d6ffff", 0.55);
  for (let index = 0; index < 25; index += 1) {
    context.fillRect(Math.floor(random() * size), Math.floor(random() * size), 1, 1);
  }
};

const registerBuiltInTextureDrawers = (): void => {
  registerTexturePattern("grass", drawGrass);
  registerTexturePattern("dirt", drawDirt);
  registerTexturePattern("stone", drawStone);
  registerTexturePattern("cobblestone", drawCobble);
  registerTexturePattern("sand", drawSand);
  registerTexturePattern("oak-log", drawLog);
  registerTexturePattern("oak-planks", drawPlanks);
  registerTexturePattern("leaves", drawLeaves);
  registerTexturePattern("glass", drawGlass);
  registerTexturePattern("bricks", drawBrick);
  registerTexturePattern("snow", drawSnow);
  registerTexturePattern("netherrack", drawNetherrack);
  registerTexturePattern("obsidian", drawObsidian);
  registerTexturePattern("ore", drawOre);
  registerTexturePattern("mossy-cobblestone", drawMossyCobble);
  registerTexturePattern("crystal", drawCrystal);
};

export const registerTexturePattern = (pattern: string, drawer: TextureDrawer): void => {
  textureDrawers.set(pattern, drawer);
};

const faceSeed = (face: TextureFace): number => {
  if (face === "top") {
    return 11;
  }
  if (face === "bottom") {
    return 37;
  }
  return 23;
};

export const createProceduralTileCanvas = (
  recipe: TextureRecipe,
  face: TextureFace,
): HTMLCanvasElement => {
  const canvas = document.createElement("canvas");
  canvas.width = TEXTURE_SIZE;
  canvas.height = TEXTURE_SIZE;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("2D canvas is required for procedural block textures");
  }

  context.imageSmoothingEnabled = false;
  const draw: TextureDrawContext = {
    context,
    face,
    palette: recipe.palette,
    random: createRandom(recipe.seed + faceSeed(face)),
    size: TEXTURE_SIZE,
  };
  const drawer = textureDrawers.get(recipe.pattern) ?? drawStone;
  drawer(draw);
  return canvas;
};

export const createProceduralTexture = (
  recipe: TextureRecipe,
  face: TextureFace,
): THREE.CanvasTexture => {
  const canvas = createProceduralTileCanvas(recipe, face);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestMipmapNearestFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
};

/**
 * Destroy-stage crack overlays drawn as transparent tiles. Every stage shares
 * one seed so its fissures are a strict superset of the previous stage's: new
 * branches spread outward and the existing ones darken, instead of the cracks
 * jumping to fresh positions each step.
 */
export const BREAK_STAGES = 10;

/**
 * Destroy overlays are larger than block tiles so the fissures stay crisp as
 * they spread across a face.
 */
export const BREAK_TEXTURE_SIZE = 128;

/** Shared seed so stage `n + 1` redraws every crack of stage `n` identically. */
const BREAK_SEED = 0x5eed;

interface FissurePoint {
  x: number;
  y: number;
}

const strokeFissure = (
  context: CanvasRenderingContext2D,
  points: readonly FissurePoint[],
  offsetX: number,
  offsetY: number,
): void => {
  const first = points[0];
  if (!first) {
    return;
  }
  context.beginPath();
  context.moveTo(first.x + offsetX, first.y + offsetY);
  for (let index = 1; index < points.length; index += 1) {
    const point = points[index] as FissurePoint;
    context.lineTo(point.x + offsetX, point.y + offsetY);
  }
  context.stroke();
};

const drawBreakStage = (stage: number): HTMLCanvasElement => {
  const size = BREAK_TEXTURE_SIZE;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("2D canvas is required for destroy-stage textures");
  }

  context.imageSmoothingEnabled = true;
  context.lineCap = "round";
  context.lineJoin = "round";
  const random = createRandom(BREAK_SEED);
  const centre = size / 2;
  const progress = stage / Math.max(1, BREAK_STAGES - 1);

  // A soft impact bruise deepens with progress so the block reads as weakening.
  const bruise = context.createRadialGradient(centre, centre, 2, centre, centre, size * 0.44);
  bruise.addColorStop(0, `rgba(8, 6, 5, ${(0.13 + progress * 0.2).toFixed(3)})`);
  bruise.addColorStop(0.55, `rgba(8, 6, 5, ${(0.04 + progress * 0.09).toFixed(3)})`);
  bruise.addColorStop(1, "rgba(8, 6, 5, 0)");
  context.fillStyle = bruise;
  context.fillRect(0, 0, size, size);

  for (let crack = 0; crack <= stage; crack += 1) {
    const points: FissurePoint[] = [];
    const startX = centre + (random() - 0.5) * size * 0.14;
    const startY = centre + (random() - 0.5) * size * 0.14;
    points.push({ x: startX, y: startY });

    let angle = random() * Math.PI * 2;
    const steps = 4 + Math.floor(random() * 4);
    let x = startX;
    let y = startY;
    for (let step = 0; step < steps; step += 1) {
      angle += (random() - 0.5) * 0.9;
      const segment = size * 0.085 + random() * size * 0.085;
      x += Math.cos(angle) * segment;
      y += Math.sin(angle) * segment;
      points.push({ x, y });
    }

    const width = 1 + Math.round(random() * 2 * (0.7 + progress * 0.8));
    // A soft dark smear, a pale chipped lip, then the dark core line, so each
    // fissure reads as a groove with a raised edge instead of a flat stroke.
    context.strokeStyle = `rgba(18, 13, 9, ${(0.1 + progress * 0.16).toFixed(3)})`;
    context.lineWidth = width + 3;
    strokeFissure(context, points, 0, 0);

    context.strokeStyle = `rgba(255, 252, 244, ${(0.07 + progress * 0.13).toFixed(3)})`;
    context.lineWidth = width + 1.5;
    strokeFissure(context, points, 1.2, 1.2);

    context.strokeStyle = `rgba(9, 7, 6, ${(0.4 + progress * 0.45).toFixed(3)})`;
    context.lineWidth = width;
    strokeFissure(context, points, 0, 0);
  }

  // Loose grit scattered around the impact.
  const grit = 34 + stage * 12;
  for (let index = 0; index < grit; index += 1) {
    context.fillStyle = `rgba(12, 9, 7, ${(0.14 + random() * 0.34).toFixed(3)})`;
    const grain = 1 + Math.floor(random() * 2);
    context.fillRect(
      centre + (random() - 0.5) * size * 0.52,
      centre + (random() - 0.5) * size * 0.52,
      grain,
      grain,
    );
  }

  return canvas;
};

export const createBreakStageTexture = (stage: number): THREE.CanvasTexture => {
  const texture = new THREE.CanvasTexture(drawBreakStage(stage));
  texture.colorSpace = THREE.SRGBColorSpace;
  // Cracks are organic curves, so smooth filtering reads better than the
  // nearest-filtered pixel art used for block tiles.
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
};

registerBuiltInTextureDrawers();
