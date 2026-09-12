import * as THREE from "three";
import type { GameConfig } from "./config";

export interface SceneRuntimeOptions {
  canvas: HTMLCanvasElement;
  config: GameConfig;
}

export class SceneRuntime {
  public readonly scene: THREE.Scene;
  public readonly camera: THREE.PerspectiveCamera;
  public readonly renderer: THREE.WebGLRenderer;

  private readonly resizeHandler = (): void => this.resize();

  public constructor(options: SceneRuntimeOptions) {
    const { canvas, config } = options;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x101820);
    this.scene.fog = new THREE.Fog(0x101820, 18, 42);

    this.camera = new THREE.PerspectiveCamera(
      config.camera.fov,
      window.innerWidth / window.innerHeight,
      config.camera.near,
      config.camera.far,
    );
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, config.render.maxPixelRatio));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = config.render.exposure;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.addLights();
    this.resize();
    window.addEventListener("resize", this.resizeHandler);
  }

  public render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  public dispose(): void {
    window.removeEventListener("resize", this.resizeHandler);
    this.renderer.dispose();
  }

  private resize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  private addLights(): void {
    const hemisphere = new THREE.HemisphereLight(0xd9eff0, 0x283741, 2.1);
    this.scene.add(hemisphere);

    const sun = new THREE.DirectionalLight(0xffe0b2, 3.2);
    sun.position.set(-10, 18, 8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 50;
    sun.shadow.camera.left = -18;
    sun.shadow.camera.right = 18;
    sun.shadow.camera.top = 18;
    sun.shadow.camera.bottom = -18;
    this.scene.add(sun);
  }
}
