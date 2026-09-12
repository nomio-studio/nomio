import * as THREE from "three";
import { BOUNCE_GAIN, type LightingConfig } from "./config";
import type { SkyPalette } from "./dynamic-sky";

/**
 * Runtime shading for the baked voxel global illumination. The one-bounce
 * color is computed in the workers; this tints that indirect light by the
 * current sky ambient so bounced light dims and cools at night.
 */
export class GlobalIllumination {
  public readonly uniforms = {
    uGiColor: { value: new THREE.Color(1, 1, 1) },
  };

  public constructor(private readonly config: LightingConfig) {}

  public get enabled(): boolean {
    return this.config.globalIllumination;
  }

  public apply(palette: SkyPalette): void {
    // Follow the sky ambient, fading with the sun so indirect light has a
    // day/night rhythm without touching the baked bounce itself. The gain used
    // to preserve bounce color during quantization is divided back out here.
    const strength = (0.22 + palette.sunIntensity * 0.9) / BOUNCE_GAIN;
    this.uniforms.uGiColor.value.copy(palette.horizon).multiplyScalar(strength);
  }
}
