import { BLOCK_ID_TO_TYPE } from "./blocks";
import type { BlockRegistry } from "./block-registry";
import { CHUNK_SIZE, CHUNK_HEIGHT, CHUNK_MIN_Y, type VoxelChunk } from "./chunk-types";
import { type StorageDriver } from "./storage";
import type { TerrainConfig } from "./terrain-config";
import {
  chunkRegionCoordinate,
  crc32,
  decodeVoxelRegion,
  encodeVoxelRegion,
  readVoxelRegionHeader,
  type ChunkBaseProvider,
  type VoxelFormatDimensions,
} from "./voxel-format";
import type { VoxelWorld } from "./world";

/** Chunk dimensions used by the current game world. */
export const VOXEL_DIMENSIONS: VoxelFormatDimensions = {
  sizeX: CHUNK_SIZE,
  sizeY: CHUNK_HEIGHT,
  sizeZ: CHUNK_SIZE,
  minY: CHUNK_MIN_Y,
};

/** Bumped whenever the terrain generator changes shape, invalidating deltas. */
const TERRAIN_SCHEMA = 2;

const REGION_EXTENSION = ".nvrg";

export const regionKey = (regionX: number, regionZ: number): string => `${regionX},${regionZ}`;

export const parseRegionKey = (key: string): { regionX: number; regionZ: number } => {
  const [regionX, regionZ] = key.split(",").map(Number);
  return { regionX, regionZ };
};

export const fingerprintTerrain = (config: TerrainConfig): number => {
  const values = new Float64Array([
    TERRAIN_SCHEMA,
    config.seed,
    config.frequency,
    config.octaves,
    config.lacunarity,
    config.gain,
    config.baseHeight,
    config.heightAmplitude,
  ]);
  return crc32(new Uint8Array(values.buffer));
};

export const fingerprintBlocks = (registry: BlockRegistry): number =>
  crc32(Uint8Array.from(registry.ids.map((id) => BLOCK_ID_TO_TYPE[id])));

// ---------------------------------------------------------------------------
// World persistence
// ---------------------------------------------------------------------------

export interface WorldSaveStats {
  /** Total chunks the player has edited in this world. */
  editedChunks: number;
  /** Bytes written by this flush. */
  bytes: number;
  /** Regions written by this flush. */
  regions: number;
}

export interface WorldPersistenceOptions {
  world: VoxelWorld;
  driver: StorageDriver;
  /** Directory that owns this world's `regions/` folder, e.g. a save slot root. */
  root: string;
  blockFingerprint: number;
  generatorFingerprint: number;
  /** Regenerates the untouched chunk that `Sparse` deltas are stored against. */
  generateBase: (coordinate: { x: number; z: number }) => Uint8Array;
  dimensions?: VoxelFormatDimensions;
  debounceMs?: number;
  onError?: (error: unknown) => void;
  onSaved?: (stats: WorldSaveStats) => void;
}

/**
 * Persists only the chunks the player edited. Because terrain is deterministic,
 * each stored chunk is a `Sparse` delta against the generator, so a world save is
 * usually a few dozen bytes rather than megabytes of raw blocks.
 *
 * Files live under `<root>/regions/<regionX>,<regionZ>.nvrg` on the supplied
 * `StorageDriver`, which lets several saves and maps coexist in one backend.
 */
export class WorldPersistence {
  private readonly dimensions: VoxelFormatDimensions;
  private readonly regionPrefix: string;
  private readonly dirtyRegions = new Set<string>();
  private readonly baseProvider: ChunkBaseProvider;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private flushChain: Promise<void> = Promise.resolve();
  private failed = false;
  private disposed = false;

  public constructor(private readonly options: WorldPersistenceOptions) {
    this.dimensions = options.dimensions ?? VOXEL_DIMENSIONS;
    this.regionPrefix = `${options.root.replace(/\/+$/, "")}/regions`;
    this.baseProvider = (coordinate) => options.generateBase(coordinate);
  }

  public get isFailed(): boolean {
    return this.failed;
  }

  /** Restores every stored region that matches the current world fingerprints. */
  public async restore(): Promise<void> {
    if (this.failed) {
      return;
    }
    try {
      const paths = await this.options.driver.list(this.regionPrefix);
      for (const path of paths) {
        if (!path.endsWith(REGION_EXTENSION)) {
          continue;
        }
        const bytes = await this.options.driver.read(path);
        if (!bytes) {
          continue;
        }
        if (!this.matchesFingerprints(bytes)) {
          await this.options.driver.delete(path);
          continue;
        }
        for (const chunk of decodeVoxelRegion(bytes, this.baseProvider)) {
          this.options.world.adoptChunk(chunk);
        }
      }
    } catch (error) {
      this.fail(error);
    }
  }

  /** Queues the region containing an edited chunk for a debounced save. */
  public markEdited(coordinate: { x: number; z: number }): void {
    if (this.failed || this.disposed) {
      return;
    }
    this.dirtyRegions.add(
      regionKey(chunkRegionCoordinate(coordinate.x), chunkRegionCoordinate(coordinate.z)),
    );
    if (this.timer === null) {
      this.timer = setTimeout(() => {
        this.timer = null;
        void this.flush();
      }, this.options.debounceMs ?? 600);
    }
  }

  /** Encodes and writes every dirty region. Safe to call concurrently. */
  public flush(): Promise<void> {
    this.flushChain = this.flushChain
      .then(() => this.flushInternal())
      .catch((error: unknown) => {
        this.fail(error);
      });
    return this.flushChain;
  }

  /** Removes every stored region; the next load starts from generated terrain. */
  public async clear(): Promise<void> {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.dirtyRegions.clear();
    await this.flushChain;
    try {
      await this.options.driver.removeDirectory(this.regionPrefix);
    } catch (error) {
      this.fail(error);
    }
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.dirtyRegions.size > 0 && !this.failed) {
      void this.flush();
    }
  }

  private matchesFingerprints(bytes: Uint8Array): boolean {
    try {
      const header = readVoxelRegionHeader(bytes);
      return (
        header.blockFingerprint === this.options.blockFingerprint &&
        header.generatorFingerprint === this.options.generatorFingerprint
      );
    } catch {
      return false;
    }
  }

  private regionPath(key: string): string {
    return `${this.regionPrefix}/${key}${REGION_EXTENSION}`;
  }

  private async flushInternal(): Promise<void> {
    if (this.failed || this.dirtyRegions.size === 0) {
      return;
    }
    const pending = [...this.dirtyRegions];
    this.dirtyRegions.clear();

    let bytes = 0;
    let regions = 0;
    for (const key of pending) {
      const { regionX, regionZ } = parseRegionKey(key);
      const chunks: VoxelChunk[] = [];
      this.options.world.forEachEditedChunk((chunk) => {
        if (
          chunkRegionCoordinate(chunk.x) === regionX &&
          chunkRegionCoordinate(chunk.z) === regionZ
        ) {
          chunks.push(chunk);
        }
      });

      if (chunks.length === 0) {
        await this.options.driver.delete(this.regionPath(key));
        continue;
      }

      const encoded = encodeVoxelRegion(chunks, {
        dimensions: this.dimensions,
        blockFingerprint: this.options.blockFingerprint,
        generatorFingerprint: this.options.generatorFingerprint,
        regionX,
        regionZ,
        baseProvider: this.baseProvider,
      });
      await this.options.driver.write(this.regionPath(key), encoded);
      bytes += encoded.length;
      regions += 1;
    }

    if (pending.length > 0) {
      this.options.onSaved?.({
        editedChunks: this.countEditedChunks(),
        bytes,
        regions,
      });
    }
  }

  private countEditedChunks(): number {
    let count = 0;
    this.options.world.forEachEditedChunk(() => {
      count += 1;
    });
    return count;
  }

  private fail(error: unknown): void {
    if (this.failed) {
      return;
    }
    this.failed = true;
    this.options.onError?.(error);
  }
}
