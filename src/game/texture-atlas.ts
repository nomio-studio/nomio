import * as THREE from "three";
import { DEFAULT_BLOCK_REGISTRY, type BlockRegistry } from "./block-registry";
import type { BlockDefinition } from "./blocks";
import type { FogController } from "./fog";
import type { GlobalIllumination } from "./global-illumination";
import { createProceduralTileCanvas, TEXTURE_SIZE } from "./procedural-textures";
import type { TextureFace, TextureRecipe } from "./texture-types";
import type { BlockId } from "./types";

const TEXTURE_FACES: TextureFace[] = ["side", "top", "bottom"];
// Extra pixels extruded around each tile so mipmap sampling and bilinear
// filtering never bleed colors across neighboring atlas tiles.
const TEXTURE_PADDING = 2;

// Analytic height + inscattering fog, injected after the opaque fragment so it
// runs in linear space before tone mapping in both the TAA and fallback paths.
const FOG_VERTEX_PARS = /* glsl */ `
varying vec3 vFogWorldPosition;
`;

const FOG_VERTEX_WORLD_POSITION = /* glsl */ `
vFogWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;
`;

const FOG_FRAGMENT_PARS = /* glsl */ `
varying vec3 vFogWorldPosition;
uniform vec3 uFogColor;
uniform vec3 uFogSunColor;
uniform vec3 uFogSunDirection;
uniform float uFogSunStrength;
uniform float uFogSunSharpness;
uniform float uFogHeight;
uniform float uFogHeightFalloff;
uniform float uFogDensity;
uniform float uFogStart;
uniform float uFogMistStrength;
uniform float uFogMistScale;
uniform float uFogTime;

float voxelFogHash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float voxelFogNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = voxelFogHash(i);
  float b = voxelFogHash(i + vec2(1.0, 0.0));
  float c = voxelFogHash(i + vec2(0.0, 1.0));
  float d = voxelFogHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
`;

const FOG_FRAGMENT_BODY = /* glsl */ `
{
  vec3 fogOffset = vFogWorldPosition - cameraPosition;
  float fogDistance = length(fogOffset);
  vec3 fogDirection = fogOffset / max(fogDistance, 1e-4);

  // Ground mist is densest at and below uFogHeight, then thins with altitude.
  float altitude = vFogWorldPosition.y - uFogHeight;
  float heightDensity = exp(-max(altitude, 0.0) * uFogHeightFalloff);

  vec2 mistUv = vFogWorldPosition.xz * uFogMistScale + vec2(uFogTime * 0.012, uFogTime * 0.007);
  float mist = (voxelFogNoise(mistUv) - 0.5) * 2.0 * uFogMistStrength;
  heightDensity *= clamp(1.0 + mist, 0.05, 2.0);

  float distanceTerm = max(fogDistance - uFogStart, 0.0) * uFogDensity * heightDensity;
  float fogAmount = 1.0 - exp(-distanceTerm);

  // Warm inscattering toward the sun, strongest along the horizon.
  float sunAlign = max(dot(fogDirection, uFogSunDirection), 0.0);
  float horizonBand = 1.0 - clamp(abs(fogDirection.y), 0.0, 1.0);
  float sunGlow = pow(sunAlign, uFogSunSharpness) * uFogSunStrength * mix(0.35, 1.0, horizonBand);
  vec3 fogTint = mix(uFogColor, uFogSunColor, clamp(sunGlow, 0.0, 1.0));

  // Dither the gradient so wide fog ramps do not band.
  float fogDither = (voxelFogHash(gl_FragCoord.xy * 0.71) - 0.5) * (1.5 / 255.0);
  fogAmount = clamp(fogAmount + fogDither, 0.0, 1.0);

  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogTint, fogAmount);
}
`;

export interface TextureAtlasLayout {
  tileSize: number;
  padding: number;
  columns: number;
  rows: number;
  width: number;
  height: number;
  tileCount: number;
}

export interface AtlasUv {
  u: number;
  v: number;
  width: number;
  height: number;
}

const tileKey = (id: BlockId, face: TextureFace): string => `${id}:${face}`;

// Colored one-bounce global illumination. `aIndirect` is the baked RGB bounce
// and `uGiColor` tints it by the current sky ambient.
const GI_VERTEX_PARS = /* glsl */ `
attribute vec3 aIndirect;
varying vec3 vIndirect;
`;

const GI_VERTEX_ASSIGN = /* glsl */ `
vIndirect = aIndirect;
`;

const GI_FRAGMENT_PARS = /* glsl */ `
varying vec3 vIndirect;
uniform vec3 uGiColor;
`;

const GI_FRAGMENT_TERM = /* glsl */ `
            reflectedLight.indirectDiffuse += vIndirect * uGiColor * occlusion;
            reflectedLight.indirectSpecular += vIndirect * uGiColor * occlusion * 0.15;
`;

// Blocks whose recipes resolve to the same surface parameters share one
// material instance, so a chunk mesh only needs a draw call per material slot.
const materialSignature = (recipe: TextureRecipe): string =>
  [
    recipe.roughness ?? 0.86,
    recipe.metalness ?? 0,
    recipe.transparent ?? false,
    recipe.opacity ?? 1,
  ].join("|");

const drawPaddedTile = (
  context: CanvasRenderingContext2D,
  tile: HTMLCanvasElement,
  x: number,
  y: number,
): void => {
  const size = TEXTURE_SIZE;
  const pad = TEXTURE_PADDING;
  context.drawImage(tile, x, y);
  // Extrude the tile's edge pixels into the surrounding padding.
  context.drawImage(tile, 0, 0, size, 1, x - pad, y - pad, size + pad * 2, pad);
  context.drawImage(tile, 0, size - 1, size, 1, x - pad, y + size, size + pad * 2, pad);
  context.drawImage(tile, 0, 0, 1, size, x - pad, y, pad, size);
  context.drawImage(tile, size - 1, 0, 1, size, x + size, y, pad, size);
};

export class BlockTextureAtlas {
  public readonly layout: TextureAtlasLayout;
  public readonly texture: THREE.CanvasTexture;

  private readonly tiles = new Map<string, AtlasUv>();
  private readonly materialList: THREE.MeshStandardMaterial[] = [];
  private readonly materialIndexByBlock = new Map<BlockId, number>();

  public constructor(
    registry: BlockRegistry = DEFAULT_BLOCK_REGISTRY,
    private readonly fog: FogController | null = null,
    private readonly gi: GlobalIllumination | null = null,
  ) {
    const blockDefinitions = registry.ids.map((id) => registry.get(id));
    const tileCount = blockDefinitions.length * TEXTURE_FACES.length;
    const columns = Math.ceil(Math.sqrt(tileCount));
    const rows = Math.ceil(tileCount / columns);
    const cellSize = TEXTURE_SIZE + TEXTURE_PADDING * 2;
    const canvas = document.createElement("canvas");
    canvas.width = columns * cellSize;
    canvas.height = rows * cellSize;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("2D canvas is required for the block texture atlas");
    }

    context.imageSmoothingEnabled = false;
    let tileIndex = 0;
    for (const definition of blockDefinitions) {
      for (const face of TEXTURE_FACES) {
        const x = (tileIndex % columns) * cellSize + TEXTURE_PADDING;
        const y = Math.floor(tileIndex / columns) * cellSize + TEXTURE_PADDING;
        drawPaddedTile(context, createProceduralTileCanvas(definition.texture, face), x, y);
        this.tiles.set(tileKey(definition.id, face), {
          u: x / canvas.width,
          v: 1 - (y + TEXTURE_SIZE) / canvas.height,
          width: TEXTURE_SIZE / canvas.width,
          height: TEXTURE_SIZE / canvas.height,
        });
        tileIndex += 1;
      }
    }

    this.layout = {
      tileSize: TEXTURE_SIZE,
      padding: TEXTURE_PADDING,
      columns,
      rows,
      width: canvas.width,
      height: canvas.height,
      tileCount,
    };
    this.texture = new THREE.CanvasTexture(canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.minFilter = THREE.NearestMipmapLinearFilter;
    this.texture.generateMipmaps = true;
    this.texture.anisotropy = 4;
    this.texture.needsUpdate = true;

    const materialSlots = new Map<string, number>();
    for (const definition of blockDefinitions) {
      const signature = materialSignature(definition.texture);
      let index = materialSlots.get(signature);
      if (index === undefined) {
        index = this.materialList.length;
        this.materialList.push(this.createMaterial(definition));
        materialSlots.set(signature, index);
      }
      this.materialIndexByBlock.set(definition.id, index);
    }
  }

  /** Shared material instances; index matches `getMaterialIndex`. */
  public get materials(): readonly THREE.MeshStandardMaterial[] {
    return this.materialList;
  }

  public getMaterial(id: BlockId): THREE.MeshStandardMaterial {
    return this.materialList[this.getMaterialIndex(id)];
  }

  public getMaterialIndex(id: BlockId): number {
    const index = this.materialIndexByBlock.get(id);
    if (index === undefined) {
      throw new Error(`No atlas material found for block: ${id}`);
    }
    return index;
  }

  public getFaceUv(id: BlockId, face: TextureFace): AtlasUv {
    const tile = this.tiles.get(tileKey(id, face));
    if (!tile) {
      throw new Error(`No atlas tile found for ${id} ${face} face`);
    }
    return tile;
  }

  public dispose(): void {
    for (const material of this.materialList) {
      material.dispose();
    }
    this.texture.dispose();
  }

  private createMaterial(definition: BlockDefinition): THREE.MeshStandardMaterial {
    const recipe = definition.texture;
    const material = new THREE.MeshStandardMaterial({
      map: this.texture,
      color: 0xffffff,
      roughness: recipe.roughness ?? 0.86,
      metalness: recipe.metalness ?? 0,
      transparent: recipe.transparent ?? false,
      opacity: recipe.opacity ?? 1,
      depthWrite: !(recipe.transparent ?? false),
      alphaTest: recipe.transparent ? 0.02 : 0,
      flatShading: true,
      // Three's built-in fog runs after tone mapping; the injected atmosphere
      // below runs in linear space before it, so built-in fog stays off.
      fog: false,
    });

    const emission = recipe.lightEmission ?? 0;
    if (emission > 0) {
      material.emissive = new THREE.Color(0x9fd6df);
      material.emissiveIntensity = Math.min(1, emission / 15) * 0.75;
    }

    const usesFog = this.fog !== null;
    const usesGi = this.gi !== null;

    // The mesher bakes smooth lighting and vertex AO into `aLight` (x = AO,
    // y = sky/block light). Modulating only the indirect term keeps direct sun
    // at full strength, so recesses soften instead of turning pitch black.
    material.onBeforeCompile = (shader) => {
      let vertexPars = "#include <common>\nattribute vec2 aLight;\nvarying vec2 vLight;";
      let vertexBegin = "#include <begin_vertex>\nvLight = aLight;";
      let fragmentPars = "#include <common>\nvarying vec2 vLight;";
      let fragmentBody = "#include <opaque_fragment>";
      let giTerm = "";

      if (usesFog) {
        vertexPars += FOG_VERTEX_PARS;
        vertexBegin += FOG_VERTEX_WORLD_POSITION;
        fragmentPars += FOG_FRAGMENT_PARS;
        fragmentBody += FOG_FRAGMENT_BODY;
        Object.assign(shader.uniforms, this.fog?.uniforms);
      }

      if (usesGi) {
        vertexPars += GI_VERTEX_PARS;
        vertexBegin += GI_VERTEX_ASSIGN;
        fragmentPars += GI_FRAGMENT_PARS;
        giTerm = GI_FRAGMENT_TERM;
        Object.assign(shader.uniforms, this.gi?.uniforms);
      }

      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", vertexPars)
        .replace("#include <begin_vertex>", vertexBegin);

      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", fragmentPars)
        .replace(
          "#include <aomap_fragment>",
          `#include <aomap_fragment>
          {
            float occlusion = mix(0.6, 1.0, clamp(vLight.x * vLight.y, 0.0, 1.0));
            reflectedLight.indirectDiffuse *= occlusion;
            reflectedLight.indirectSpecular *= occlusion;
${giTerm}          }`,
        )
        .replace("#include <opaque_fragment>", fragmentBody)
        .replace("#include <fog_fragment>", "// atmosphere injected above");
    };
    material.customProgramCacheKey = () => `${usesFog ? "fog" : "nofog"}-${usesGi ? "gi" : "nogi"}`;

    return material;
  }
}
