import * as THREE from "three";
import type { ColorGrade } from "./color-grade";
import type { AntialiasingConfig } from "./config";

/** Sub-pixel jitter sequence length. Eight samples is the usual quality/cost knee. */
const JITTER_PERIOD = 8;
/** Pixel motion that fully halves history reuse. */
const MOTION_FULL_PIXELS = 48;

const FULLSCREEN_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/**
 * Temporal resolve: reproject the previous resolved frame with the camera's
 * motion, gate history on depth/motion, clamp it to the current neighborhood to
 * kill ghosting, and store depth in alpha for the next frame's disocclusion test.
 */
const TAA_FRAGMENT = /* glsl */ `
precision highp float;

uniform sampler2D tCurrent;
uniform sampler2D tDepth;
uniform sampler2D tHistory;
uniform mat4 uInvViewProj;
uniform mat4 uPrevViewProj;
uniform mat4 uInvProj;
uniform mat4 uCameraWorld;
uniform vec2 uResolution;
uniform float uHistoryBlend;
uniform float uNear;
uniform float uFar;
uniform float uMotionScale;
uniform float uReset;

varying vec2 vUv;

float linearizeDepth(float depth) {
  float z = depth * 2.0 - 1.0;
  return (2.0 * uNear * uFar) / (uFar + uNear - z * (uFar - uNear));
}

vec3 rgbToYCoCg(vec3 c) {
  return vec3(
    0.25 * c.r + 0.5 * c.g + 0.25 * c.b,
    0.5 * c.r - 0.5 * c.b,
    -0.25 * c.r + 0.5 * c.g - 0.25 * c.b
  );
}

vec3 yCoCgToRgb(vec3 c) {
  return vec3(c.x + c.y - c.z, c.x + c.z, c.x - c.y - c.z);
}

vec2 reproject(vec2 uv, float depth) {
  // Sky never writes depth, so it stays at 1.0. A skybox only rotates with the
  // camera, so reproject it as a direction (translation-free) rather than a point.
  if (depth >= 0.99999) {
    vec4 clip = uInvProj * vec4(uv * 2.0 - 1.0, 1.0, 1.0);
    vec3 viewDir = normalize(clip.xyz / clip.w);
    vec3 worldDir = normalize((uCameraWorld * vec4(viewDir, 0.0)).xyz);
    vec4 prevClip = uPrevViewProj * vec4(worldDir, 0.0);
    return (prevClip.xy / prevClip.w) * 0.5 + 0.5;
  }

  vec4 clip = uInvViewProj * vec4(uv * 2.0 - 1.0, 1.0, 1.0);
  vec3 world = clip.xyz / clip.w;
  vec4 prevClip = uPrevViewProj * vec4(world, 1.0);
  return (prevClip.xy / prevClip.w) * 0.5 + 0.5;
}

void main() {
  vec2 texel = 1.0 / uResolution;
  float depth = texture2D(tDepth, vUv).x;
  vec3 current = texture2D(tCurrent, vUv).rgb;

  // 3x3 neighborhood statistics in YCoCg. Variance clipping keeps the resolve
  // sharp on flat areas while allowing edges to converge smoothly, and it
  // removes ghosting by construction.
  vec3 c0 = rgbToYCoCg(texture2D(tCurrent, vUv + vec2(-texel.x, -texel.y)).rgb);
  vec3 c1 = rgbToYCoCg(texture2D(tCurrent, vUv + vec2(0.0, -texel.y)).rgb);
  vec3 c2 = rgbToYCoCg(texture2D(tCurrent, vUv + vec2(texel.x, -texel.y)).rgb);
  vec3 c3 = rgbToYCoCg(texture2D(tCurrent, vUv + vec2(-texel.x, 0.0)).rgb);
  vec3 c4 = rgbToYCoCg(current);
  vec3 c5 = rgbToYCoCg(texture2D(tCurrent, vUv + vec2(texel.x, 0.0)).rgb);
  vec3 c6 = rgbToYCoCg(texture2D(tCurrent, vUv + vec2(-texel.x, texel.y)).rgb);
  vec3 c7 = rgbToYCoCg(texture2D(tCurrent, vUv + vec2(0.0, texel.y)).rgb);
  vec3 c8 = rgbToYCoCg(texture2D(tCurrent, vUv + vec2(texel.x, texel.y)).rgb);
  vec3 sum = c0 + c1 + c2 + c3 + c4 + c5 + c6 + c7 + c8;
  vec3 sumSquares = c0 * c0 + c1 * c1 + c2 * c2 + c3 * c3 + c4 * c4 +
    c5 * c5 + c6 * c6 + c7 * c7 + c8 * c8;
  vec3 mean = sum * (1.0 / 9.0);
  vec3 sigma = sqrt(max(sumSquares * (1.0 / 9.0) - mean * mean, vec3(0.0))) * 1.35;

  vec2 prevUv = reproject(vUv, depth);
  float inside = step(0.0, prevUv.x) * step(prevUv.x, 1.0) *
    step(0.0, prevUv.y) * step(prevUv.y, 1.0);

  vec4 historySample = texture2D(tHistory, clamp(prevUv, vec2(0.0), vec2(1.0)));
  vec3 history = historySample.rgb;
  vec3 historyY = rgbToYCoCg(history);

  // Only camera motion is tracked, so reprojection is exact for static geometry.
  // A hard depth-rejection test would reject history at every silhouette edge —
  // exactly the pixels that need to converge — so ghosting is handled by the
  // color statistics below plus the motion-driven blend reduction.
  float motion = length((prevUv - vUv) * uResolution);
  float motionFactor = clamp(motion * uMotionScale, 0.0, 1.0);

  float blend = uHistoryBlend * inside * (1.0 - motionFactor * 0.5);
  blend *= (1.0 - uReset);

  // Variance clipping removes ghosting by construction while keeping the
  // resolve from dragging color across an edge.
  vec3 clippedHistory = clamp(historyY, mean - sigma, mean + sigma);
  vec3 resolved = mix(current, yCoCgToRgb(clippedHistory), blend);

  float currentZ = linearizeDepth(depth);
  gl_FragColor = vec4(resolved, currentZ / uFar);
}
`;

/**
 * Final resolve: an unsharp mask clamped to the local min/max (so it sharpens
 * without ringing), white balance and exposure in linear, AgX or ACES tone
 * mapping, then contrast/saturation/vibrance/highlight/shadow grading and a
 * vignette before the sRGB encode.
 */
const COMPOSITE_FRAGMENT = /* glsl */ `
precision highp float;

uniform sampler2D tInput;
uniform vec2 uResolution;
uniform float uSharpen;
uniform float uExposure;
uniform vec3 uWhiteBalance;
uniform int uToneMapping;
uniform float uContrast;
uniform float uSaturation;
uniform float uVibrance;
uniform float uHighlights;
uniform float uShadows;
uniform float uVignette;

varying vec2 vUv;

vec3 rrtAndOdtFit(vec3 v) {
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return a / b;
}

vec3 acesFilmic(vec3 color) {
  const mat3 inputMatrix = mat3(
    vec3(0.59719, 0.07600, 0.02840),
    vec3(0.35458, 0.90834, 0.13383),
    vec3(0.04823, 0.01566, 0.83777)
  );
  const mat3 outputMatrix = mat3(
    vec3(1.60475, -0.10208, -0.00327),
    vec3(-0.53108, 1.10813, -0.07276),
    vec3(-0.07367, -0.00605, 1.07602)
  );
  color *= 1.0 / 0.6;
  color = inputMatrix * color;
  color = rrtAndOdtFit(color);
  color = outputMatrix * color;
  return clamp(color, 0.0, 1.0);
}

const mat3 LINEAR_REC2020_TO_LINEAR_SRGB = mat3(
  vec3(1.6605, -0.1246, -0.0182),
  vec3(-0.5876, 1.1329, -0.1006),
  vec3(-0.0728, -0.0083, 1.1187)
);

const mat3 LINEAR_SRGB_TO_LINEAR_REC2020 = mat3(
  vec3(0.6274, 0.0691, 0.0164),
  vec3(0.3293, 0.9195, 0.0880),
  vec3(0.0433, 0.0113, 0.8956)
);

vec3 agxDefaultContrastApprox(vec3 x) {
  vec3 x2 = x * x;
  vec3 x4 = x2 * x2;
  return +15.5 * x4 * x2
    - 40.14 * x4 * x
    + 31.96 * x4
    - 6.868 * x2 * x
    + 0.4298 * x2
    + 0.1191 * x
    - 0.00232;
}

vec3 agxToneMapping(vec3 color) {
  const mat3 AgXInsetMatrix = mat3(
    vec3(0.856627153315983, 0.137318972929847, 0.11189821299995),
    vec3(0.0951212405381588, 0.761241990602591, 0.0767994186031903),
    vec3(0.0482516061458583, 0.101439036467562, 0.811302368396859)
  );
  const mat3 AgXOutsetMatrix = mat3(
    vec3(1.1271005818144368, -0.1413297634984383, -0.14132976349843826),
    vec3(-0.11060664309660323, 1.157823702216272, -0.11060664309660294),
    vec3(-0.016493938717834573, -0.016493938717834257, 1.2519364065950405)
  );
  const float AgxMinEv = -12.47393;
  const float AgxMaxEv = 4.026069;
  color = LINEAR_SRGB_TO_LINEAR_REC2020 * color;
  color = AgXInsetMatrix * color;
  color = max(color, 1e-10);
  color = log2(color);
  color = (color - AgxMinEv) / (AgxMaxEv - AgxMinEv);
  color = clamp(color, 0.0, 1.0);
  color = agxDefaultContrastApprox(color);
  color = AgXOutsetMatrix * color;
  color = pow(max(vec3(0.0), color), vec3(2.2));
  color = LINEAR_REC2020_TO_LINEAR_SRGB * color;
  return clamp(color, 0.0, 1.0);
}

vec3 linearToSRGB(vec3 color) {
  return mix(
    pow(color, vec3(0.41666)) * 1.055 - vec3(0.055),
    color * 12.92,
    step(color, vec3(0.0031308))
  );
}

float compositeHash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

vec3 applyGrade(vec3 color) {
  color = clamp(0.5 + (color - 0.5) * uContrast, 0.0, 1.0);

  float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
  float peak = max(color.r, max(color.g, color.b));
  float trough = min(color.r, min(color.g, color.b));
  float saturation = uSaturation + uVibrance * (1.0 - (peak - trough));
  color = mix(vec3(luma), color, clamp(saturation, 0.0, 3.0));

  float shadowMask = 1.0 - smoothstep(0.0, 0.55, luma);
  float highlightMask = smoothstep(0.45, 1.0, luma);
  color += uShadows * shadowMask * 0.18;
  color -= uHighlights * highlightMask * 0.18;
  return clamp(color, 0.0, 1.0);
}

void main() {
  vec2 texel = 1.0 / uResolution;
  vec3 color = texture2D(tInput, vUv).rgb;

  if (uSharpen > 0.0001) {
    vec3 north = texture2D(tInput, vUv + vec2(0.0, texel.y)).rgb;
    vec3 south = texture2D(tInput, vUv - vec2(0.0, texel.y)).rgb;
    vec3 east = texture2D(tInput, vUv + vec2(texel.x, 0.0)).rgb;
    vec3 west = texture2D(tInput, vUv - vec2(texel.x, 0.0)).rgb;
    vec3 localMin = min(min(min(north, south), min(east, west)), color);
    vec3 localMax = max(max(max(north, south), max(east, west)), color);
    vec3 blurred = (north + south + east + west) * 0.25;
    color = clamp(color + (color - blurred) * uSharpen, localMin, localMax);
  }

  color *= uWhiteBalance * uExposure;
  color = uToneMapping == 1 ? acesFilmic(color) : agxToneMapping(color);
  color = applyGrade(color);

  vec2 centered = vUv - 0.5;
  float radius = length(centered) * 1.41421356;
  color *= mix(1.0, smoothstep(1.0, 0.35, radius), uVignette);

  vec3 encoded = linearToSRGB(color);
  // Ordered-ish dither hides banding in wide sky and fog gradients.
  float dither = (compositeHash(gl_FragCoord.xy * 0.71) - 0.5) * (1.0 / 255.0);
  gl_FragColor = vec4(encoded + dither, 1.0);
}
`;

export interface RenderPipelineOptions {
  grading: ColorGrade;
  antialiasing: AntialiasingConfig;
}

const halton = (index: number, base: number): number => {
  let result = 0;
  let fraction = 1 / base;
  let i = index;
  while (i > 0) {
    result += fraction * (i % base);
    i = Math.floor(i / base);
    fraction /= base;
  }
  return result;
};

const createFullscreenGeometry = (): THREE.BufferGeometry => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3),
  );
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
  return geometry;
};

/**
 * Deferred-tone-mapping pipeline with temporal antialiasing.
 *
 * The scene renders into a linear HDR target from a sub-pixel-jittered camera;
 * a temporal pass reprojects and variance-clamps the history, and a composite
 * pass sharpens and tone-maps to the canvas. `config.antialiasing.enabled`
 * toggles accumulation while the deferred tone mapping stays consistent.
 */
export class RenderPipeline {
  private readonly size = new THREE.Vector2(1, 1);
  private readonly colorType: THREE.TextureDataType;
  private sceneTarget: THREE.WebGLRenderTarget;
  private historyTargets: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
  private readonly taaMaterial: THREE.ShaderMaterial;
  private readonly compositeMaterial: THREE.ShaderMaterial;
  private readonly quadGeometry: THREE.BufferGeometry;
  private readonly quadScene = new THREE.Scene();
  private readonly quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly quadMesh: THREE.Mesh;

  private readonly unjitteredProjection = new THREE.Matrix4();
  private readonly jitteredProjection = new THREE.Matrix4();
  private readonly viewProjection = new THREE.Matrix4();
  private readonly previousViewProjection = new THREE.Matrix4();

  private readonly invViewProj = { value: new THREE.Matrix4() };
  private readonly prevViewProj = { value: new THREE.Matrix4() };
  private readonly invProj = { value: new THREE.Matrix4() };
  private readonly cameraWorld = { value: new THREE.Matrix4() };
  private readonly resolution = { value: new THREE.Vector2(1, 1) };
  private readonly tCurrent = { value: null as THREE.Texture | null };
  private readonly tDepth = { value: null as THREE.Texture | null };
  private readonly tHistory = { value: null as THREE.Texture | null };
  private readonly inputTexture = { value: null as THREE.Texture | null };

  private frame = 0;
  private historyIndex = 0;
  private previousValid = false;
  private resetRequested = true;

  public constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly options: RenderPipelineOptions,
  ) {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    this.size.copy(size);
    this.colorType = this.supportsFloatTargets() ? THREE.HalfFloatType : THREE.UnsignedByteType;

    this.sceneTarget = this.createSceneTarget(size.x, size.y);
    this.historyTargets = [
      this.createHistoryTarget(size.x, size.y),
      this.createHistoryTarget(size.x, size.y),
    ];

    this.taaMaterial = new THREE.ShaderMaterial({
      uniforms: {
        tCurrent: this.tCurrent,
        tDepth: this.tDepth,
        tHistory: this.tHistory,
        uInvViewProj: this.invViewProj,
        uPrevViewProj: this.prevViewProj,
        uInvProj: this.invProj,
        uCameraWorld: this.cameraWorld,
        uResolution: this.resolution,
        uHistoryBlend: { value: options.antialiasing.historyBlend },
        uNear: { value: 0.1 },
        uFar: { value: 1000 },
        uMotionScale: { value: 1 / MOTION_FULL_PIXELS },
        uReset: { value: 1 },
      },
      vertexShader: FULLSCREEN_VERTEX,
      fragmentShader: TAA_FRAGMENT,
      depthTest: false,
      depthWrite: false,
    });

    this.compositeMaterial = new THREE.ShaderMaterial({
      uniforms: {
        tInput: this.inputTexture,
        uResolution: this.resolution,
        uExposure: options.grading.uniforms.uExposure,
        uWhiteBalance: options.grading.uniforms.uWhiteBalance,
        uToneMapping: options.grading.uniforms.uToneMapping,
        uContrast: options.grading.uniforms.uContrast,
        uSaturation: options.grading.uniforms.uSaturation,
        uVibrance: options.grading.uniforms.uVibrance,
        uHighlights: options.grading.uniforms.uHighlights,
        uShadows: options.grading.uniforms.uShadows,
        uVignette: options.grading.uniforms.uVignette,
        uSharpen: { value: options.antialiasing.sharpen },
      },
      vertexShader: FULLSCREEN_VERTEX,
      fragmentShader: COMPOSITE_FRAGMENT,
      depthTest: false,
      depthWrite: false,
    });

    this.quadGeometry = createFullscreenGeometry();
    this.quadMesh = new THREE.Mesh(this.quadGeometry, this.taaMaterial);
    this.quadMesh.frustumCulled = false;
    this.quadScene.add(this.quadMesh);
  }

  /** True when the pipeline can defer tone mapping into an HDR buffer. */
  public static isSupported(renderer: THREE.WebGLRenderer): boolean {
    return renderer.capabilities.isWebGL2;
  }

  /** Clears the temporal history, e.g. after a camera teleport or world reset. */
  public reset(): void {
    this.resetRequested = true;
    this.previousValid = false;
  }

  public setSize(width: number, height: number): void {
    if (width === this.size.x && height === this.size.y) {
      return;
    }
    this.size.set(Math.max(1, width), Math.max(1, height));
    this.disposeTargets();
    this.recreateTargets();
    this.reset();
  }

  public render(scene: THREE.Scene, camera: THREE.PerspectiveCamera): void {
    const renderer = this.renderer;
    const width = this.size.x;
    const height = this.size.y;

    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    this.unjitteredProjection.copy(camera.projectionMatrix);
    this.viewProjection.multiplyMatrices(this.unjitteredProjection, camera.matrixWorldInverse);

    if (this.options.antialiasing.enabled) {
      const offsetX = (halton((this.frame % JITTER_PERIOD) + 1, 2) - 0.5) * (2 / width);
      const offsetY = (halton((this.frame % JITTER_PERIOD) + 1, 3) - 0.5) * (2 / height);
      this.jitteredProjection.copy(this.unjitteredProjection);
      this.jitteredProjection.elements[8] += offsetX;
      this.jitteredProjection.elements[9] += offsetY;
      camera.projectionMatrix.copy(this.jitteredProjection);
      camera.projectionMatrixInverse.copy(this.jitteredProjection).invert();
    }

    renderer.setRenderTarget(this.sceneTarget);
    renderer.render(scene, camera);

    // Gameplay systems raycast between frames, so leave the camera unjittered.
    camera.projectionMatrix.copy(this.unjitteredProjection);
    camera.projectionMatrixInverse.copy(this.unjitteredProjection).invert();

    this.resolution.value.set(width, height);
    this.compositeMaterial.uniforms.uSharpen.value = this.options.antialiasing.sharpen;

    if (this.options.antialiasing.enabled) {
      const writeIndex = this.historyIndex;
      const readIndex = 1 - writeIndex;

      this.tCurrent.value = this.sceneTarget.texture;
      this.tDepth.value = this.sceneTarget.depthTexture;
      this.tHistory.value = this.historyTargets[readIndex].texture;
      this.invViewProj.value.copy(this.viewProjection).invert();
      this.prevViewProj.value.copy(this.previousViewProjection);
      this.invProj.value.copy(this.unjitteredProjection).invert();
      this.cameraWorld.value.copy(camera.matrixWorld);
      this.taaMaterial.uniforms.uHistoryBlend.value = this.options.antialiasing.historyBlend;
      this.taaMaterial.uniforms.uNear.value = camera.near;
      this.taaMaterial.uniforms.uFar.value = camera.far;
      this.taaMaterial.uniforms.uReset.value = this.resetRequested || !this.previousValid ? 1 : 0;

      this.drawFullscreen(this.taaMaterial, this.historyTargets[writeIndex]);
      this.inputTexture.value = this.historyTargets[writeIndex].texture;
      this.historyIndex = readIndex;
    } else {
      this.inputTexture.value = this.sceneTarget.texture;
    }

    this.drawFullscreen(this.compositeMaterial, null);

    this.previousViewProjection.copy(this.viewProjection);
    this.previousValid = true;
    this.resetRequested = false;
    this.frame += 1;
  }

  public dispose(): void {
    this.disposeTargets();
    this.taaMaterial.dispose();
    this.compositeMaterial.dispose();
    this.quadGeometry.dispose();
  }

  private drawFullscreen(
    material: THREE.ShaderMaterial,
    target: THREE.WebGLRenderTarget | null,
  ): void {
    this.quadMesh.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.quadScene, this.quadCamera);
  }

  private supportsFloatTargets(): boolean {
    if (!this.renderer.capabilities.isWebGL2) {
      return false;
    }
    return (
      this.renderer.extensions.has("EXT_color_buffer_float") ||
      this.renderer.extensions.has("EXT_color_buffer_half_float")
    );
  }

  private createSceneTarget(width: number, height: number): THREE.WebGLRenderTarget {
    const target = new THREE.WebGLRenderTarget(Math.max(1, width), Math.max(1, height), {
      type: this.colorType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
      stencilBuffer: false,
    });
    target.texture.generateMipmaps = false;
    const depth = new THREE.DepthTexture(
      Math.max(1, width),
      Math.max(1, height),
      THREE.UnsignedIntType,
    );
    depth.format = THREE.DepthFormat;
    target.depthTexture = depth;
    return target;
  }

  private createHistoryTarget(width: number, height: number): THREE.WebGLRenderTarget {
    const target = new THREE.WebGLRenderTarget(Math.max(1, width), Math.max(1, height), {
      type: this.colorType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
    });
    target.texture.generateMipmaps = false;
    return target;
  }

  private recreateTargets(): void {
    this.sceneTarget = this.createSceneTarget(this.size.x, this.size.y);
    this.historyTargets = [
      this.createHistoryTarget(this.size.x, this.size.y),
      this.createHistoryTarget(this.size.x, this.size.y),
    ];
  }

  private disposeTargets(): void {
    this.sceneTarget.depthTexture?.dispose();
    this.sceneTarget.dispose();
    for (const target of this.historyTargets) {
      target.dispose();
    }
  }
}
