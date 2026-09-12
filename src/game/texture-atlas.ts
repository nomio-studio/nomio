import * as THREE from "three";
import { DEFAULT_BLOCK_REGISTRY, type BlockRegistry } from "./block-registry";
import type { BlockDefinition } from "./blocks";
import { createProceduralTileCanvas, TEXTURE_SIZE } from "./procedural-textures";
import type { TextureFace } from "./texture-types";
import type { BlockId } from "./types";

const TEXTURE_FACES: TextureFace[] = ["side", "top", "bottom"];
const BOX_FACE_ORDER: TextureFace[] = ["side", "side", "top", "bottom", "side", "side"];

export interface TextureAtlasLayout {
  tileSize: number;
  columns: number;
  rows: number;
  width: number;
  height: number;
  tileCount: number;
}

interface AtlasTile {
  u: number;
  v: number;
  width: number;
  height: number;
}

const tileKey = (id: BlockId, face: TextureFace): string => `${id}:${face}`;

export class BlockTextureAtlas {
  public readonly layout: TextureAtlasLayout;
  public readonly texture: THREE.CanvasTexture;

  private readonly tiles = new Map<string, AtlasTile>();
  private readonly geometries = new Map<BlockId, THREE.BufferGeometry>();
  private readonly materials = new Map<BlockId, THREE.MeshStandardMaterial>();

  public constructor(
    private readonly sourceGeometry: THREE.BoxGeometry,
    registry: BlockRegistry = DEFAULT_BLOCK_REGISTRY,
  ) {
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
      this.geometries.set(definition.id, this.createGeometry(definition.id));
      this.materials.set(definition.id, this.createMaterial(definition));
    }
  }

  public getGeometry(id: BlockId): THREE.BufferGeometry {
    const geometry = this.geometries.get(id);
    if (!geometry) {
      throw new Error(`No atlas geometry found for block: ${id}`);
    }
    return geometry;
  }

  public getMaterial(id: BlockId): THREE.MeshStandardMaterial {
    const material = this.materials.get(id);
    if (!material) {
      throw new Error(`No atlas material found for block: ${id}`);
    }
    return material;
  }

  public dispose(): void {
    for (const geometry of this.geometries.values()) {
      geometry.dispose();
    }
    for (const material of this.materials.values()) {
      material.dispose();
    }
    this.texture.dispose();
  }

  private createGeometry(id: BlockId): THREE.BufferGeometry {
    const geometry = this.sourceGeometry.clone();
    geometry.clearGroups();
    const uv = geometry.getAttribute("uv");
    if (!(uv instanceof THREE.BufferAttribute) || uv.count < BOX_FACE_ORDER.length * 4) {
      throw new Error("Block atlas UV mapping requires a standard BoxGeometry");
    }

    for (let faceIndex = 0; faceIndex < BOX_FACE_ORDER.length; faceIndex += 1) {
      const face = BOX_FACE_ORDER[faceIndex];
      const tile = this.tiles.get(tileKey(id, face));
      if (!tile) {
        throw new Error(`No atlas tile found for ${id} ${face} face`);
      }

      for (let vertexIndex = 0; vertexIndex < 4; vertexIndex += 1) {
        const attributeIndex = faceIndex * 4 + vertexIndex;
        const localU = uv.getX(attributeIndex);
        const localV = uv.getY(attributeIndex);
        uv.setXY(attributeIndex, tile.u + localU * tile.width, tile.v + localV * tile.height);
      }
    }
    uv.needsUpdate = true;
    return geometry;
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
