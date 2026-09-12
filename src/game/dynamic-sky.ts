import * as THREE from "three";

const DAY_ZENITH = new THREE.Color(0x3f7fb0);
const DAY_HORIZON = new THREE.Color(0xbcd6df);
const DAY_GROUND = new THREE.Color(0x5f7f93);
const DAY_SUN = new THREE.Color(0xfff0cf);

const DUSK_ZENITH = new THREE.Color(0x2f335f);
const DUSK_HORIZON = new THREE.Color(0xf27b63);
const DUSK_GROUND = new THREE.Color(0x2c2438);
const DUSK_SUN = new THREE.Color(0xffb27a);

const NIGHT_ZENITH = new THREE.Color(0x04060d);
const NIGHT_HORIZON = new THREE.Color(0x0a1120);
const NIGHT_GROUND = new THREE.Color(0x05070c);
const NIGHT_SUN = new THREE.Color(0x8fa6c8);

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

const smoothstep = (edge0: number, edge1: number, x: number): number => {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};

/**
 * Colors and weights derived from the sun's elevation, shared by the sky dome,
 * the scene lights, and the fog so the world and the sky always agree.
 */
export class SkyPalette {
  public readonly zenith = new THREE.Color();
  public readonly horizon = new THREE.Color();
  public readonly ground = new THREE.Color();
  public readonly sun = new THREE.Color();
  public sunIntensity = 1;
  public starIntensity = 0;
  public sunsetStrength = 0;
  public cloudAmount = 0;

  public compute(sunDirection: THREE.Vector3): void {
    const elevation = sunDirection.y;
    const day = smoothstep(-0.06, 0.28, elevation);
    const night = 1 - smoothstep(-0.14, 0.06, elevation);
    const dusk = Math.exp(-(((elevation - 0.015) / 0.15) ** 2));

    this.zenith
      .copy(NIGHT_ZENITH)
      .lerp(DAY_ZENITH, day)
      .lerp(DUSK_ZENITH, dusk * 0.75);
    this.horizon
      .copy(NIGHT_HORIZON)
      .lerp(DAY_HORIZON, day)
      .lerp(DUSK_HORIZON, dusk * 0.9);
    this.ground
      .copy(NIGHT_GROUND)
      .lerp(DAY_GROUND, day)
      .lerp(DUSK_GROUND, dusk * 0.75);
    this.sun.copy(NIGHT_SUN).lerp(DAY_SUN, day).lerp(DUSK_SUN, dusk);

    this.sunIntensity = 0.06 + day * 0.94 + dusk * 0.15;
    this.starIntensity = night * (1 - dusk * 0.55);
    this.sunsetStrength = dusk;
    this.cloudAmount = 0.5 * (0.4 + day * 0.6) * (1 - night * 0.35);
  }
}

const SKY_VERTEX = /* glsl */ `
varying vec3 vDirection;
void main() {
  vDirection = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const SKY_FRAGMENT = /* glsl */ `
precision highp float;

uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGround;
uniform vec3 uSunColor;
uniform vec3 uSunDirection;
uniform float uSunsetStrength;
uniform float uStarIntensity;
uniform float uCloudAmount;
uniform float uTime;

varying vec3 vDirection;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 345.45));
  p += dot(p, p + 34.345);
  return fract(p.x * p.y);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.5;
  for (int i = 0; i < 5; i++) {
    value += amplitude * valueNoise(p);
    p *= 2.03;
    amplitude *= 0.5;
  }
  return value;
}

void main() {
  vec3 dir = normalize(vDirection);
  float height = dir.y;
  float sunDot = max(dot(dir, uSunDirection), 0.0);

  float t = pow(clamp(height, 0.0, 1.0), 0.55);
  vec3 color = mix(uHorizon, uZenith, t);
  color = mix(uGround, color, smoothstep(-0.28, 0.02, height));

  float horizonBand = 1.0 - smoothstep(0.0, 0.38, abs(height));
  color += uSunColor * pow(sunDot, 3.0) * horizonBand * uSunsetStrength * 0.8;

  color += uSunColor * pow(sunDot, 9.0) * 0.28 * max(uSunDirection.y + 0.25, 0.0);

  float disk = smoothstep(0.9993, 0.99985, sunDot);
  color += uSunColor * disk * 3.0;

  if (uCloudAmount > 0.001 && height > 0.015) {
    vec2 uv = dir.xz / (height + 0.18) * 0.55;
    uv += vec2(uTime * 0.006, uTime * 0.0025);
    float clouds = fbm(uv);
    float coverage = smoothstep(0.52, 0.86, clouds);
    float fade = smoothstep(0.015, 0.28, height) * (1.0 - smoothstep(0.75, 1.0, height) * 0.35);
    float lit = 0.55 + 0.45 * pow(sunDot, 2.0);
    vec3 cloudColor = mix(vec3(0.62, 0.66, 0.72), vec3(1.0), lit);
    cloudColor = mix(cloudColor, uSunColor, uSunsetStrength * 0.5);
    color = mix(color, cloudColor, coverage * fade * uCloudAmount);
  }

  if (uStarIntensity > 0.001 && height > -0.03) {
    vec3 scaled = dir * 240.0;
    vec3 cell = floor(scaled);
    float seed = hash21(cell.xy + cell.z * 19.7);
    float star = step(0.9973, seed);
    vec3 center = (cell + 0.5) / 240.0;
    float dist = length(normalize(center) - dir) * 240.0;
    float shape = smoothstep(0.55, 0.0, dist);
    float twinkle = 0.55 + 0.45 * sin(uTime * 2.2 + seed * 40.0);
    color += vec3(0.85, 0.9, 1.0) * star * shape * twinkle * uStarIntensity;
  }

  gl_FragColor = vec4(color, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

interface SkyUniforms {
  [key: string]: { value: unknown };
  uZenith: { value: THREE.Color };
  uHorizon: { value: THREE.Color };
  uGround: { value: THREE.Color };
  uSunColor: { value: THREE.Color };
  uSunDirection: { value: THREE.Vector3 };
  uSunsetStrength: { value: number };
  uStarIntensity: { value: number };
  uCloudAmount: { value: number };
  uTime: { value: number };
}

/**
 * Inverted sphere with an atmospheric gradient shader: day/night zenith,
 * sunrise/sunset glow, a sun disk and halo, drifting clouds, and twinkling stars.
 */
export class DynamicSky {
  public readonly mesh: THREE.Mesh;
  private readonly geometry: THREE.SphereGeometry;
  private readonly material: THREE.ShaderMaterial;
  private readonly uniforms: SkyUniforms;

  public constructor(radius: number) {
    this.geometry = new THREE.SphereGeometry(radius, 32, 20);
    this.uniforms = {
      uZenith: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uGround: { value: new THREE.Color() },
      uSunColor: { value: new THREE.Color() },
      uSunDirection: { value: new THREE.Vector3(0, 1, 0) },
      uSunsetStrength: { value: 0 },
      uStarIntensity: { value: 0 },
      uCloudAmount: { value: 0 },
      uTime: { value: 0 },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: SKY_VERTEX,
      fragmentShader: SKY_FRAGMENT,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
    });

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = "dynamic-sky";
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
  }

  public update(palette: SkyPalette, sunDirection: THREE.Vector3, elapsed: number): void {
    this.uniforms.uZenith.value.copy(palette.zenith);
    this.uniforms.uHorizon.value.copy(palette.horizon);
    this.uniforms.uGround.value.copy(palette.ground);
    this.uniforms.uSunColor.value.copy(palette.sun);
    this.uniforms.uSunDirection.value.copy(sunDirection);
    this.uniforms.uSunsetStrength.value = palette.sunsetStrength;
    this.uniforms.uStarIntensity.value = palette.starIntensity;
    this.uniforms.uCloudAmount.value = palette.cloudAmount;
    this.uniforms.uTime.value = elapsed;
  }

  public dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
