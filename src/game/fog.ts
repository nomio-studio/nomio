import * as THREE from "three";
import type { FogConfig } from "./config";
import type { SkyPalette } from "./dynamic-sky";

/** Uniform holders shared by every terrain material so the fog updates once. */
export interface FogUniforms {
  uFogColor: { value: THREE.Color };
  uFogSunColor: { value: THREE.Color };
  uFogSunDirection: { value: THREE.Vector3 };
  uFogSunStrength: { value: number };
  uFogSunSharpness: { value: number };
  uFogHeight: { value: number };
  uFogHeightFalloff: { value: number };
  uFogDensity: { value: number };
  uFogStart: { value: number };
  uFogMistStrength: { value: number };
  uFogMistScale: { value: number };
  uFogTime: { value: number };
}

/**
 * Analytic height + inscattering fog. It is driven from the same `SkyPalette`
 * as the dome and lights, so fog color always matches the horizon, and it adds
 * a warm directional glow toward the sun plus slowly drifting mist banks.
 */
export class FogController {
  public readonly uniforms: FogUniforms;

  public constructor(private readonly config: FogConfig) {
    this.uniforms = {
      uFogColor: { value: new THREE.Color(0x101820) },
      uFogSunColor: { value: new THREE.Color(0xffffff) },
      uFogSunDirection: { value: new THREE.Vector3(0, 1, 0) },
      uFogSunStrength: { value: config.sunStrength },
      uFogSunSharpness: { value: config.sunSharpness },
      uFogHeight: { value: config.height },
      uFogHeightFalloff: { value: config.heightFalloff },
      uFogDensity: { value: config.density },
      uFogStart: { value: config.start },
      uFogMistStrength: { value: config.mistStrength },
      uFogMistScale: { value: config.mistScale },
      uFogTime: { value: 0 },
    };
  }

  /** Refreshes the uniforms from the current sky palette and sun direction. */
  public apply(palette: SkyPalette, sunDirection: THREE.Vector3, elapsed: number): void {
    const uniforms = this.uniforms;
    // Distance haze takes the horizon color, nudged toward the ground hue so it
    // reads as atmosphere rather than a flat wall of color.
    uniforms.uFogColor.value.copy(palette.horizon).lerp(palette.ground, 0.12);
    uniforms.uFogSunColor.value.copy(palette.sun);
    uniforms.uFogSunDirection.value.copy(sunDirection).normalize();
    // Dusk and dawn produce the strongest directional glow.
    uniforms.uFogSunStrength.value = this.config.sunStrength * (0.3 + palette.sunsetStrength * 1.0);
    uniforms.uFogTime.value = elapsed;
  }
}
