import * as THREE from "three";
import { DEFAULT_GRADING, type GradingConfig, type ToneMappingMode } from "./config";

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const isToneMapping = (value: unknown): value is ToneMappingMode =>
  value === "agx" || value === "aces";

/** Coerces partial input into a complete, in-range grading configuration. */
export const normalizeGrading = (
  value: Partial<GradingConfig> | null | undefined,
): GradingConfig => {
  const source = value ?? {};
  return {
    toneMapping: isToneMapping(source.toneMapping)
      ? source.toneMapping
      : DEFAULT_GRADING.toneMapping,
    exposure: clamp(Number(source.exposure ?? DEFAULT_GRADING.exposure), -5, 5),
    temperature: clamp(Number(source.temperature ?? DEFAULT_GRADING.temperature), 2000, 12000),
    tint: clamp(Number(source.tint ?? DEFAULT_GRADING.tint), -1, 1),
    contrast: clamp(Number(source.contrast ?? DEFAULT_GRADING.contrast), 0, 3),
    saturation: clamp(Number(source.saturation ?? DEFAULT_GRADING.saturation), 0, 3),
    vibrance: clamp(Number(source.vibrance ?? DEFAULT_GRADING.vibrance), 0, 1),
    highlights: clamp(Number(source.highlights ?? DEFAULT_GRADING.highlights), -1, 1),
    shadows: clamp(Number(source.shadows ?? DEFAULT_GRADING.shadows), -1, 1),
    vignette: clamp(Number(source.vignette ?? DEFAULT_GRADING.vignette), 0, 1),
  };
};

/**
 * Approximates the linear-sRGB chromaticity of a blackbody radiator
 * (Tanner Helland's fit), used to derive white-balance gains.
 */
const kelvinToLinear = (kelvin: number): [number, number, number] => {
  const t = clamp(kelvin, 1000, 40000) / 100;
  let r: number;
  let g: number;
  let b: number;
  if (t <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(t) - 161.1195681661;
    b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  } else {
    r = 329.698727446 * (t - 60) ** -0.1332047592;
    g = 288.1221695283 * (t - 60) ** -0.0755148492;
    b = 255;
  }
  const toLinear = (channel: number): number => clamp(channel / 255, 0, 1) ** 2.2;
  return [toLinear(r), toLinear(g), toLinear(b)];
};

const luminance = (r: number, g: number, b: number): number => 0.2126 * r + 0.7152 * g + 0.0722 * b;

const TONE_MAPPING_INDEX: Record<ToneMappingMode, number> = { agx: 0, aces: 1 };

/**
 * Owns the tone-mapping and color-grading uniforms consumed by the composite
 * pass. White balance is computed on the CPU so the shader only multiplies.
 */
export class ColorGrade {
  public readonly uniforms = {
    uExposure: { value: 1 },
    uWhiteBalance: { value: new THREE.Vector3(1, 1, 1) },
    uToneMapping: { value: 0 },
    uContrast: { value: 1 },
    uSaturation: { value: 1 },
    uVibrance: { value: 0 },
    uHighlights: { value: 0 },
    uShadows: { value: 0 },
    uVignette: { value: 0 },
  };

  private current: GradingConfig;

  public constructor(
    private readonly baseExposure: number,
    grading: GradingConfig = DEFAULT_GRADING,
  ) {
    this.current = normalizeGrading(grading);
    this.apply();
  }

  public get config(): GradingConfig {
    return { ...this.current };
  }

  /** Merges a partial grade, clamps it, and pushes it to the uniforms. */
  public set(partial: Partial<GradingConfig>): GradingConfig {
    this.current = normalizeGrading({ ...this.current, ...partial });
    this.apply();
    return this.config;
  }

  private apply(): void {
    const grade = this.current;
    const uniforms = this.uniforms;
    uniforms.uExposure.value = this.baseExposure * 2 ** grade.exposure;
    uniforms.uToneMapping.value = TONE_MAPPING_INDEX[grade.toneMapping];
    uniforms.uContrast.value = grade.contrast;
    uniforms.uSaturation.value = grade.saturation;
    uniforms.uVibrance.value = grade.vibrance;
    uniforms.uHighlights.value = grade.highlights;
    uniforms.uShadows.value = grade.shadows;
    uniforms.uVignette.value = grade.vignette;

    // White balance: the target illuminant divided by the D65 reference, then
    // luminance-normalized so a neutral grade leaves exposure untouched.
    const [tr, tg, tb] = kelvinToLinear(grade.temperature);
    const [rr, rg, rb] = kelvinToLinear(6500);
    let r = tr / rr;
    let g = tg / rg;
    let b = tb / rb;
    const lum = luminance(r, g, b);
    r /= lum;
    g /= lum;
    b /= lum;
    // Tint pushes green (negative) or magenta (positive).
    g *= 1 - grade.tint * 0.2;
    r *= 1 + Math.max(0, grade.tint) * 0.05;
    b *= 1 + Math.max(0, grade.tint) * 0.05;
    uniforms.uWhiteBalance.value.set(r, g, b);
  }
}
