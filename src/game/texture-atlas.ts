import * as THREE from "three";
import { DEFAULT_BLOCK_REGISTRY, type BlockRegistry } from "./block-registry";
import type { BlockDefinition } from "./blocks";
import { createProceduralTileCanvas, TEXTURE_SIZE } from "./procedural-textures";
import type { TextureFace } from "./texture-types";
import type { BlockId } from "./types";

const TEXTURE_FACES: TextureFace[] = ["side", "top", "bottom"];

export interface TextureAtlasLayout {
  tileSize: number;
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

export class BlockTextureAtlas {
  public readonly layout: TextureAtlasLayout;
  public readonly texture: THREE.CanvasTexture;

  private readonly tiles = new Map<string, AtlasUv>();
  private readonly materials = new Map<BlockId, THREE.MeshStandardMaterial>();

  public constructor(registry: BlockRegistry = DEFAULT_BLOCK_REGISTRY) {
    const blockDefinitions = registry.ids.map((id) => registry.get(id));
    const tileCount = blockDefinitions.length * TEXTURE_FACES.length;
    const columns = Math.ceil(Math.sqrt(tileCount));
    const rows = Math.ceil(tileCount / columns);
    const canvas = document.createElement("canvas");
    canvas.width = columns * TEXTURE_SIZE;
    canvas.height = rows * TEXTURE_SIZE;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("2D canvas is required for the block texture atlas");
    }

    context.imageSmoothingEnabled = false;
    let tileIndex = 0;
    for (const definition of blockDefinitions) {
      for (const face of TEXTURE_FACES) {
        const x = (tileIndex % columns) * TEXTURE_SIZE;
        const y = Math.floor(tileIndex / columns) * TEXTURE_SIZE;
        context.drawImage(createProceduralTileCanvas(definition.texture, face), x, y);
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
      columns,
      rows,
      width: canvas.width,
      height: canvas.height,
      tileCount,
    };
    this.texture = new THREE.CanvasTexture(canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.generateMipmaps = false;
    this.texture.needsUpdate = true;

    for (const definition of blockDefinitions) {
      this.materials.set(definition.id, this.createMaterial(definition));
    }
  }

  public getMaterial(id: BlockId): THREE.MeshStandardMaterial {
    const material = this.materials.get(id);
    if (!material) {
      throw new Error(`No atlas material found for block: ${id}`);
    }
    return material;
  }

  public getFaceUv(id: BlockId, face: TextureFace): AtlasUv {
    const tile = this.tiles.get(tileKey(id, face));
    if (!tile) {
      throw new Error(`No atlas tile found for ${id} ${face} face`);
    }
    return tile;
  }

  public dispose(): void {
    for (const material of this.materials.values()) {
      material.dispose();
    }
    this.texture.dispose();
  }

  private createMaterial(definition: BlockDefinition): THREE.MeshStandardMaterial {
    const recipe = definition.texture;
    return new THREE.MeshStandardMaterial({
      map: this.texture,
      color: 0xffffff,
      roughness: recipe.roughness ?? 0.86,
      metalness: recipe.metalness ?? 0,
      transparent: recipe.transparent ?? false,
      opacity: recipe.opacity ?? 1,
      depthWrite: !(recipe.transparent ?? false),
      alphaTest: recipe.transparent ? 0.02 : 0,
      flatShading: true,
    });
  }
}
