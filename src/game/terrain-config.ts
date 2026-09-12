export interface TerrainConfig {
  seed: number;
  frequency: number;
  octaves: number;
  lacunarity: number;
  gain: number;
  baseHeight: number;
  heightAmplitude: number;
  viewDistance: number;
}

export const DEFAULT_TERRAIN_CONFIG: TerrainConfig = {
  seed: 240913,
  frequency: 0.028,
  octaves: 5,
  lacunarity: 2,
  gain: 0.5,
  baseHeight: 4,
  heightAmplitude: 8,
  viewDistance: 1,
};
