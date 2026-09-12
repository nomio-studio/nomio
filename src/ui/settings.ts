import { clamp } from "./dom";
import type { ToneMappingMode } from "../game/config";

export interface UiSettings {
  /** Multiplier applied to the base look sensitivity. */
  lookSensitivity: number;
  /** Vertical field of view in degrees. */
  fieldOfView: number;
  invertLook: boolean;
  showControlHints: boolean;
  /** Force reduced motion on top of the OS preference. */
  reduceMotion: boolean;
  /** Tone-mapping curve. */
  toneMapping: ToneMappingMode;
  /** Exposure in stops. */
  exposure: number;
  /** Contrast around mid grey. */
  contrast: number;
  /** Saturation. */
  saturation: number;
  /** White balance in Kelvin. */
  temperature: number;
}

export const UI_SETTINGS_STORAGE_KEY = "nomio:settings:v1";

export const DEFAULT_UI_SETTINGS: UiSettings = {
  lookSensitivity: 1,
  fieldOfView: 68,
  invertLook: false,
  showControlHints: true,
  reduceMotion: false,
  toneMapping: "agx",
  exposure: 0,
  contrast: 1.05,
  saturation: 1.05,
  temperature: 6500,
};

export const UI_SETTINGS_RANGE = {
  lookSensitivity: { min: 0.25, max: 3, step: 0.05 },
  fieldOfView: { min: 55, max: 100, step: 1 },
  exposure: { min: -2, max: 2, step: 0.05 },
  contrast: { min: 0.5, max: 1.8, step: 0.01 },
  saturation: { min: 0, max: 2, step: 0.01 },
  temperature: { min: 2000, max: 12000, step: 100 },
} as const;

const isBoolean = (value: unknown): value is boolean => typeof value === "boolean";

const isToneMapping = (value: unknown): value is ToneMappingMode =>
  value === "agx" || value === "aces";

/** Coerces unknown/partial input into a complete, in-range settings object. */
export const normalizeUiSettings = (value: Partial<UiSettings> | null | undefined): UiSettings => {
  const source = value ?? {};
  return {
    lookSensitivity: clamp(
      Number(source.lookSensitivity ?? DEFAULT_UI_SETTINGS.lookSensitivity),
      UI_SETTINGS_RANGE.lookSensitivity.min,
      UI_SETTINGS_RANGE.lookSensitivity.max,
    ),
    fieldOfView: clamp(
      Number(source.fieldOfView ?? DEFAULT_UI_SETTINGS.fieldOfView),
      UI_SETTINGS_RANGE.fieldOfView.min,
      UI_SETTINGS_RANGE.fieldOfView.max,
    ),
    invertLook: isBoolean(source.invertLook) ? source.invertLook : DEFAULT_UI_SETTINGS.invertLook,
    showControlHints: isBoolean(source.showControlHints)
      ? source.showControlHints
      : DEFAULT_UI_SETTINGS.showControlHints,
    reduceMotion: isBoolean(source.reduceMotion)
      ? source.reduceMotion
      : DEFAULT_UI_SETTINGS.reduceMotion,
    toneMapping: isToneMapping(source.toneMapping)
      ? source.toneMapping
      : DEFAULT_UI_SETTINGS.toneMapping,
    exposure: clamp(
      Number(source.exposure ?? DEFAULT_UI_SETTINGS.exposure),
      UI_SETTINGS_RANGE.exposure.min,
      UI_SETTINGS_RANGE.exposure.max,
    ),
    contrast: clamp(
      Number(source.contrast ?? DEFAULT_UI_SETTINGS.contrast),
      UI_SETTINGS_RANGE.contrast.min,
      UI_SETTINGS_RANGE.contrast.max,
    ),
    saturation: clamp(
      Number(source.saturation ?? DEFAULT_UI_SETTINGS.saturation),
      UI_SETTINGS_RANGE.saturation.min,
      UI_SETTINGS_RANGE.saturation.max,
    ),
    temperature: clamp(
      Number(source.temperature ?? DEFAULT_UI_SETTINGS.temperature),
      UI_SETTINGS_RANGE.temperature.min,
      UI_SETTINGS_RANGE.temperature.max,
    ),
  };
};

/** Reads persisted settings, falling back to defaults on any failure. */
export const loadUiSettings = (): UiSettings => {
  try {
    const raw = window.localStorage.getItem(UI_SETTINGS_STORAGE_KEY);
    if (!raw) {
      return { ...DEFAULT_UI_SETTINGS };
    }
    return normalizeUiSettings(JSON.parse(raw) as Partial<UiSettings>);
  } catch {
    return { ...DEFAULT_UI_SETTINGS };
  }
};

/** Persists settings; storage failures (private mode, quota) are non-fatal. */
export const saveUiSettings = (settings: UiSettings): void => {
  try {
    window.localStorage.setItem(UI_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Settings simply are not persisted when storage is unavailable.
  }
};
