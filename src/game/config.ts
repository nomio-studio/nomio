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
}

export interface GameConfig {
  camera: CameraConfig;
  player: PlayerConfig;
  interaction: InteractionConfig;
  render: RenderConfig;
  terrain: TerrainConfig;
}

export interface GameConfigOverrides {
  camera?: Partial<CameraConfig>;
  player?: Partial<PlayerConfig>;
  interaction?: Partial<InteractionConfig>;
  render?: Partial<RenderConfig>;
  terrain?: Partial<TerrainConfig>;
}

export const DEFAULT_GAME_CONFIG: GameConfig = {
  camera: {
    fov: 68,
    near: 0.1,
    far: 100,
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
  },
  terrain: {
    ...DEFAULT_TERRAIN_CONFIG,
  },
};

export const createGameConfig = (overrides: GameConfigOverrides = {}): GameConfig => ({
  camera: { ...DEFAULT_GAME_CONFIG.camera, ...overrides.camera },
  player: { ...DEFAULT_GAME_CONFIG.player, ...overrides.player },
  interaction: { ...DEFAULT_GAME_CONFIG.interaction, ...overrides.interaction },
  render: { ...DEFAULT_GAME_CONFIG.render, ...overrides.render },
  terrain: { ...DEFAULT_GAME_CONFIG.terrain, ...overrides.terrain },
});
