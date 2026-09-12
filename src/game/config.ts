import { DEFAULT_TERRAIN_CONFIG, type TerrainConfig } from "./terrain-config";

export interface CameraConfig {
  fov: number;
  near: number;
  far: number;
}

export interface PlayerConfig {
  width: number;
  height: number;
  eyeHeight: number;
  speed: number;
  gravity: number;
  jumpVelocity: number;
  lookSensitivity: number;
  spawn: readonly [number, number, number];
  fallResetY: number;
}

export interface InteractionConfig {
  maxDistance: number;
}

export interface RenderConfig {
  maxPixelRatio: number;
  exposure: number;
  /** Chunks within this radius cast shadows; the rest receive only. */
  shadowChunkRadius: number;
  /** Milliseconds per frame allowed for uploading chunk meshes to the GPU. */
  meshBudgetMs: number;
}

export interface AntialiasingConfig {
  /** Run the temporal antialiasing pipeline and deferred tone mapping. */
  enabled: boolean;
  /** Weight of accumulated history, 0..0.95. Higher is smoother but softer. */
  historyBlend: number;
  /** Post-resolve unsharp strength, 0..1, to counter temporal softness. */
  sharpen: number;
}

export interface SkyConfig {
  /** Render the animated sky dome and drive lighting from the time of day. */
  enabled: boolean;
  /** Seconds for a full day/night cycle. */
  cycleDuration: number;
  /** Start time in `[0, 1)`: 0 is midnight, 0.25 sunrise, 0.5 noon, 0.75 sunset. */
  startTime: number;
}

export interface FogConfig {
  /** Enable the height + inscattering atmosphere. */
  enabled: boolean;
  /** Exponential density; higher fogs the distance sooner. */
  density: number;
  /** Distance from the camera before fog begins. */
  start: number;
  /** World height where ground mist is densest; it thins above this. */
  height: number;
  /** Per-unit rate the mist thins above `height`. */
  heightFalloff: number;
  /** Strength of the warm glow toward the sun. */
  sunStrength: number;
  /** Tightness of the sun glow (higher = smaller, sharper). */
  sunSharpness: number;
  /** Amplitude of the drifting mist banks. */
  mistStrength: number;
  /** World-space frequency of the mist banks. */
  mistScale: number;
}

export interface LightingConfig {
  /** One-bounce colored global illumination (light bleeding). */
  globalIllumination: boolean;
  /** Fraction of incoming light a surface reflects back into the world. */
  bounceStrength: number;
  /** How much skylight participates in the bounce. */
  skyBounce: number;
}

export const DEFAULT_LIGHTING: LightingConfig = {
  globalIllumination: true,
  bounceStrength: 0.55,
  skyBounce: 0.75,
};

/**
 * Scales bounce light into the 4-bit-per-channel indirect range so albedo
 * differences survive quantization. `GlobalIllumination` divides it back out.
 */
export const BOUNCE_GAIN = 3;

export type ToneMappingMode = "agx" | "aces";

export interface GradingConfig {
  /** Tone-mapping curve applied to linear HDR before grading. */
  toneMapping: ToneMappingMode;
  /** Exposure adjustment in stops, applied before tone mapping. */
  exposure: number;
  /** White balance in Kelvin (6500 is neutral). */
  temperature: number;
  /** Green/magenta tint, -1..1. */
  tint: number;
  /** Contrast around mid grey; 1 is neutral. */
  contrast: number;
  /** Saturation; 1 is neutral. */
  saturation: number;
  /** Extra saturation for low-saturation colors, 0..1. */
  vibrance: number;
  /** Highlight recovery, -1..1 (positive pulls highlights down). */
  highlights: number;
  /** Shadow lift, -1..1 (positive raises shadows). */
  shadows: number;
  /** Edge darkening, 0..1. */
  vignette: number;
}

export const DEFAULT_GRADING: GradingConfig = {
  toneMapping: "agx",
  exposure: 0,
  temperature: 6500,
  tint: 0,
  contrast: 1.05,
  saturation: 1.05,
  vibrance: 0.15,
  highlights: 0,
  shadows: 0,
  vignette: 0.12,
};

export interface GameConfig {
  camera: CameraConfig;
  player: PlayerConfig;
  interaction: InteractionConfig;
  render: RenderConfig;
  terrain: TerrainConfig;
  sky: SkyConfig;
  antialiasing: AntialiasingConfig;
  fog: FogConfig;
  lighting: LightingConfig;
  grading: GradingConfig;
}

export interface GameConfigOverrides {
  camera?: Partial<CameraConfig>;
  player?: Partial<PlayerConfig>;
  interaction?: Partial<InteractionConfig>;
  render?: Partial<RenderConfig>;
  terrain?: Partial<TerrainConfig>;
  sky?: Partial<SkyConfig>;
  antialiasing?: Partial<AntialiasingConfig>;
  fog?: Partial<FogConfig>;
  lighting?: Partial<LightingConfig>;
  grading?: Partial<GradingConfig>;
}

export const DEFAULT_GAME_CONFIG: GameConfig = {
  camera: {
    fov: 68,
    near: 0.1,
    far: 420,
  },
  player: {
    width: 0.6,
    height: 1.8,
    eyeHeight: 1.62,
    speed: 4.2,
    gravity: 18,
    jumpVelocity: 6.4,
    lookSensitivity: 0.0022,
    spawn: [0.5, 14, 5.5],
    fallResetY: -24,
  },
  interaction: {
    maxDistance: 7,
  },
  render: {
    maxPixelRatio: 2,
    exposure: 1.12,
    shadowChunkRadius: 3,
    meshBudgetMs: 6,
  },
  terrain: {
    ...DEFAULT_TERRAIN_CONFIG,
  },
  sky: {
    enabled: true,
    cycleDuration: 480,
    startTime: 0.32,
  },
  antialiasing: {
    enabled: true,
    historyBlend: 0.9,
    sharpen: 0.35,
  },
  fog: {
    enabled: true,
    density: 0.018,
    start: 90,
    height: 6,
    heightFalloff: 0.05,
    sunStrength: 0.55,
    sunSharpness: 6,
    mistStrength: 0.3,
    mistScale: 0.03,
  },
  lighting: {
    ...DEFAULT_LIGHTING,
  },
  grading: {
    ...DEFAULT_GRADING,
  },
};

export const createGameConfig = (overrides: GameConfigOverrides = {}): GameConfig => ({
  camera: { ...DEFAULT_GAME_CONFIG.camera, ...overrides.camera },
  player: { ...DEFAULT_GAME_CONFIG.player, ...overrides.player },
  interaction: { ...DEFAULT_GAME_CONFIG.interaction, ...overrides.interaction },
  render: { ...DEFAULT_GAME_CONFIG.render, ...overrides.render },
  terrain: { ...DEFAULT_GAME_CONFIG.terrain, ...overrides.terrain },
  sky: { ...DEFAULT_GAME_CONFIG.sky, ...overrides.sky },
  antialiasing: { ...DEFAULT_GAME_CONFIG.antialiasing, ...overrides.antialiasing },
  fog: { ...DEFAULT_GAME_CONFIG.fog, ...overrides.fog },
  lighting: { ...DEFAULT_GAME_CONFIG.lighting, ...overrides.lighting },
  grading: { ...DEFAULT_GAME_CONFIG.grading, ...overrides.grading },
});
