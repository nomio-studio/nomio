import * as THREE from "three";
import { CHUNK_SIZE } from "./chunk-types";
import { ColorGrade } from "./color-grade";
import type { GameConfig, GradingConfig } from "./config";
import { DynamicSky, SkyPalette } from "./dynamic-sky";
import { FogController } from "./fog";
import { GlobalIllumination } from "./global-illumination";
import { RenderPipeline } from "./render-pipeline";

export interface SceneRuntimeOptions {
  canvas: HTMLCanvasElement;
  config: GameConfig;
}

const SUN_DISTANCE = 80;
// Re-rendering the shadow map every frame is wasteful; the sun moves slowly,
// so shadows refresh a few times per second instead.
const SHADOW_REFRESH_INTERVAL = 0.2;

export class SceneRuntime {
  public readonly scene: THREE.Scene;
  public readonly camera: THREE.PerspectiveCamera;
  public readonly renderer: THREE.WebGLRenderer;

  private readonly config: GameConfig;
  private readonly sun: THREE.DirectionalLight;
  private readonly hemisphere: THREE.HemisphereLight;
  private readonly ambient: THREE.AmbientLight;
  private readonly sky: DynamicSky | null;
  /** Shared atmosphere uniforms; `null` when fog is disabled. */
  public readonly fog: FogController | null;
  /** Shared global-illumination uniforms; `null` when GI is disabled. */
  public readonly gi: GlobalIllumination | null;
  /** Tone mapping and color grading state. */
  public readonly grading: ColorGrade;
  private readonly pipeline: RenderPipeline | null;
  private readonly palette = new SkyPalette();
  private readonly sunDirection = new THREE.Vector3(0, 1, 0);
  private readonly lightDirection = new THREE.Vector3(0, 1, 0);
  private readonly targetSunDirection = new THREE.Vector3(0, 1, 0);
  private readonly focus = new THREE.Vector3();
  private readonly resizeHandler = (): void => this.resize();
  private timeOfDay: number;
  private elapsed = 0;
  private shadowTimer = SHADOW_REFRESH_INTERVAL;
  private shadowsDirty = true;

  public constructor(options: SceneRuntimeOptions) {
    const { canvas, config } = options;
    this.config = config;
    const viewWorld = config.terrain.viewDistance * CHUNK_SIZE;
    const far = Math.max(config.camera.far, viewWorld * 1.4);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x101820);
    this.fog = config.fog.enabled ? new FogController(config.fog) : null;
    this.gi = config.lighting.globalIllumination ? new GlobalIllumination(config.lighting) : null;

    this.camera = new THREE.PerspectiveCamera(
      config.camera.fov,
      window.innerWidth / window.innerHeight,
      config.camera.near,
      far,
    );
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, config.render.maxPixelRatio));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate = false;

    // A temporal pipeline defers tone mapping so it can resolve in linear HDR.
    // Fall back to direct rendering when it is disabled or unsupported.
    this.grading = new ColorGrade(config.render.exposure, config.grading);
    this.pipeline =
      config.antialiasing.enabled && RenderPipeline.isSupported(this.renderer)
        ? new RenderPipeline(this.renderer, {
            grading: this.grading,
            antialiasing: config.antialiasing,
          })
        : null;

    if (this.pipeline) {
      this.renderer.toneMapping = THREE.NoToneMapping;
    } else {
      this.renderer.toneMapping =
        config.grading.toneMapping === "aces" ? THREE.ACESFilmicToneMapping : THREE.AgXToneMapping;
      this.renderer.toneMappingExposure = this.grading.uniforms.uExposure.value;
    }

    this.sky = config.sky.enabled ? new DynamicSky(far * 0.92) : null;
    if (this.sky) {
      this.scene.add(this.sky.mesh);
    }

    this.hemisphere = new THREE.HemisphereLight(0xd9eff0, 0x283741, 2.1);
    this.scene.add(this.hemisphere);

    // Soft fill so recesses keep a readable floor instead of crushing to black.
    this.ambient = new THREE.AmbientLight(0xffffff, 0.2);
    this.scene.add(this.ambient);

    this.sun = new THREE.DirectionalLight(0xffe0b2, 3.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 180;
    this.sun.shadow.camera.left = -40;
    this.sun.shadow.camera.right = 40;
    this.sun.shadow.camera.top = 40;
    this.sun.shadow.camera.bottom = -40;
    this.sun.shadow.camera.updateProjectionMatrix();
    // normalBias removes surface acne and the light that bleeds around block
    // edges; a small negative bias keeps contact shadows attached.
    this.sun.shadow.bias = -0.0002;
    this.sun.shadow.normalBias = 0.04;
    this.sun.shadow.radius = 1.5;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.timeOfDay = config.sky.startTime;
    this.updateSky(0);

    this.resize();
    window.addEventListener("resize", this.resizeHandler);
  }

  /** Advances the day/night cycle and refreshes the sky, lights, and fog. */
  public update(delta: number): void {
    this.updateSky(delta);
  }

  public setTimeOfDay(value: number): void {
    this.timeOfDay = ((value % 1) + 1) % 1;
    this.updateSky(0);
    this.pipeline?.reset();
  }

  public getTimeOfDay(): number {
    return this.timeOfDay;
  }

  /** Updates the vertical field of view from user settings. */
  public setFieldOfView(fov: number): void {
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
  }

  public render(): void {
    if (this.sky) {
      this.sky.mesh.position.copy(this.camera.position);
    }
    if (this.shadowsDirty) {
      this.renderer.shadowMap.needsUpdate = true;
      this.shadowsDirty = false;
    }
    if (this.pipeline) {
      this.pipeline.render(this.scene, this.camera);
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }

  /** Clears accumulated antialiasing history after a jump or world change. */
  public resetTemporal(): void {
    this.pipeline?.reset();
  }

  /** Updates tone mapping and color grading, e.g. from the settings panel. */
  public setGrading(partial: Partial<GradingConfig>): GradingConfig {
    const config = this.grading.set(partial);
    if (!this.pipeline) {
      this.renderer.toneMapping =
        config.toneMapping === "aces" ? THREE.ACESFilmicToneMapping : THREE.AgXToneMapping;
      this.renderer.toneMappingExposure = this.grading.uniforms.uExposure.value;
    }
    return config;
  }

  public invalidateShadows(): void {
    this.shadowsDirty = true;
  }

  /** Tracks the player continuously; the sun follows in small timed steps. */
  public setFocus(x: number, z: number): void {
    this.focus.set(x, 0, z);
  }

  public setShadowFocus(x: number, z: number): void {
    this.setFocus(x, z);
    this.positionSun();
    this.shadowsDirty = true;
  }

  public dispose(): void {
    window.removeEventListener("resize", this.resizeHandler);
    this.sky?.dispose();
    this.pipeline?.dispose();
    this.renderer.dispose();
  }

  private updateSky(delta: number): void {
    if (this.config.sky.enabled) {
      this.elapsed += delta;
      this.timeOfDay = (this.timeOfDay + delta / this.config.sky.cycleDuration) % 1;
    }

    this.computeSunDirection(this.targetSunDirection);
    this.palette.compute(this.targetSunDirection);
    this.sky?.update(this.palette, this.targetSunDirection, this.elapsed);
    this.fog?.apply(this.palette, this.targetSunDirection, this.elapsed);
    this.gi?.apply(this.palette);
    this.applyLighting();

    this.shadowTimer += delta;
    if (this.shadowTimer >= SHADOW_REFRESH_INTERVAL) {
      this.shadowTimer = 0;
      this.sunDirection.copy(this.targetSunDirection);
      this.positionSun();
      this.shadowsDirty = true;
    }
  }

  private computeSunDirection(out: THREE.Vector3): void {
    const theta = (this.timeOfDay - 0.25) * Math.PI * 2;
    out.set(Math.cos(theta), Math.sin(theta), -0.28).normalize();
  }

  private applyLighting(): void {
    const palette = this.palette;
    this.sun.color.copy(palette.sun);
    this.sun.intensity = 0.28 + palette.sunIntensity * 2.95;
    this.hemisphere.color.copy(palette.zenith);
    this.hemisphere.groundColor.copy(palette.ground);
    // Low sun means dusk/night: add a small fill so the island keeps its shape
    // instead of reading as a flat silhouette. The term is zero at noon, so the
    // daytime contrast is unaffected.
    const lowSun = 1 - palette.sunIntensity;
    this.hemisphere.intensity = 0.25 + palette.sunIntensity * 0.9 + lowSun * 0.2;
    this.ambient.color.copy(palette.horizon);
    this.ambient.intensity = 0.04 + palette.sunIntensity * 0.06 + lowSun * 0.08;
  }

  private positionSun(): void {
    // At night the sun sits below the horizon; light the world with a soft
    // "moon" coming from the opposite side so terrain is not lit from below.
    if (this.sunDirection.y >= 0) {
      this.lightDirection.copy(this.sunDirection);
    } else {
      this.lightDirection.copy(this.sunDirection).negate();
    }
    this.sun.position.copy(this.focus).addScaledVector(this.lightDirection, SUN_DISTANCE);
    this.sun.target.position.copy(this.focus);
    this.sun.target.updateMatrixWorld();
  }

  private resize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.pipeline?.setSize(size.x, size.y);
  }
}
