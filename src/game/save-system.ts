import { DEFAULT_TERRAIN_CONFIG, type TerrainConfig } from "./terrain-config";
import { readJson, writeJson, type StorageDriver } from "./storage";

/**
 * Save system: a catalog of worlds (maps) and, for each world, any number of
 * named save slots. A map owns the terrain definition (seed and shape); a save
 * owns the player's edits inside that map.
 *
 * Layout on the storage driver:
 *
 * ```text
 * catalog.json
 * maps/<mapId>/saves.json
 * maps/<mapId>/saves/<saveId>/regions/<regionX>,<regionZ>.nvrg
 * ```
 *
 * Metadata is JSON, voxel data is the compact NSVF region format, and every
 * layer sits on the generic `StorageDriver` seam.
 */

export const SAVE_SCHEMA = 1;

export interface MapRecord {
  id: string;
  name: string;
  terrain: TerrainConfig;
  createdAt: number;
  updatedAt: number;
}

export interface SaveRecord {
  id: string;
  mapId: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  /** Number of chunks the player has edited, for the library list. */
  editedChunks: number;
  /** Optional accumulated play time in seconds. */
  playtimeSeconds: number;
}

/** The slice of `SaveSystem` the library dialog needs to render and mutate. */
export interface SaveLibraryController {
  listMaps(): Promise<MapRecord[]>;
  listSaves(mapId: string): Promise<SaveRecord[]>;
  createMap(input: { name: string; seed: number }): Promise<MapRecord>;
  renameMap(mapId: string, name: string): Promise<void>;
  deleteMap(mapId: string): Promise<void>;
  createSave(mapId: string, name: string): Promise<SaveRecord>;
  renameSave(mapId: string, saveId: string, name: string): Promise<void>;
  duplicateSave(mapId: string, saveId: string): Promise<void>;
  deleteSave(mapId: string, saveId: string): Promise<void>;
}

interface MapCatalog {
  schema: number;
  maps: MapRecord[];
}

interface SaveCatalog {
  schema: number;
  saves: SaveRecord[];
}

const CATALOG_PATH = "catalog.json";

export const mapRoot = (mapId: string): string => `maps/${mapId}`;

export const saveRoot = (mapId: string, saveId: string): string =>
  `${mapRoot(mapId)}/saves/${saveId}`;

const saveCatalogPath = (mapId: string): string => `${mapRoot(mapId)}/saves.json`;

const createId = (prefix: string): string => {
  const random =
    globalThis.crypto?.randomUUID?.().slice(0, 8) ?? Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now().toString(36)}-${random}`;
};

const sanitizeName = (value: string, fallback: string): string => {
  const trimmed = value.trim().replace(/\s+/g, " ");
  return trimmed.length > 0 ? trimmed.slice(0, 48) : fallback;
};

const randomSeed = (): number => Math.floor(Math.random() * 0xffffffff) >>> 0;

const cloneMap = (map: MapRecord): MapRecord => ({
  ...map,
  terrain: { ...map.terrain },
});

const isMap = (value: unknown): value is MapRecord => {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<MapRecord>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.name === "string" &&
    typeof candidate.terrain === "object" &&
    candidate.terrain !== null
  );
};

const isSave = (value: unknown): value is SaveRecord => {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<SaveRecord>;
  return typeof candidate.id === "string" && typeof candidate.name === "string";
};

/**
 * Owns the world/save catalog and every metadata write. Region blobs are left
 * to `WorldPersistence`; this class only knows where each save lives.
 */
export class SaveSystem implements SaveLibraryController {
  private catalog: MapCatalog | null = null;
  private readonly saveCatalogs = new Map<string, SaveCatalog>();

  public constructor(private readonly driver: StorageDriver) {}

  /** Loads the catalog, creating a first world and save when storage is empty. */
  public async init(): Promise<void> {
    const catalog = await this.loadCatalog();
    if (catalog.maps.length === 0) {
      const map = await this.createMap({ name: "First Island", seed: DEFAULT_TERRAIN_CONFIG.seed });
      await this.createSave(map.id, "New journey");
    }
  }

  /** The world/save to open on a clean launch. */
  public async ensureDefault(): Promise<{ map: MapRecord; save: SaveRecord }> {
    await this.init();
    const map = (await this.listMaps())[0];
    if (!map) {
      throw new Error("Save system has no worlds");
    }
    const saves = await this.listSaves(map.id);
    const save = saves[0] ?? (await this.createSave(map.id, "New journey"));
    return { map, save };
  }

  public async listMaps(): Promise<MapRecord[]> {
    const catalog = await this.loadCatalog();
    return [...catalog.maps].sort((a, b) => b.updatedAt - a.updatedAt).map((map) => cloneMap(map));
  }

  public async getMap(mapId: string): Promise<MapRecord | null> {
    const catalog = await this.loadCatalog();
    const map = catalog.maps.find((candidate) => candidate.id === mapId);
    return map ? cloneMap(map) : null;
  }

  public async createMap(input: { name: string; seed: number }): Promise<MapRecord> {
    const catalog = await this.loadCatalog();
    const now = Date.now();
    const seed = Number.isFinite(input.seed) ? Math.trunc(input.seed) >>> 0 : randomSeed();
    const map: MapRecord = {
      id: createId("map"),
      name: sanitizeName(input.name, "Untitled world"),
      terrain: { ...DEFAULT_TERRAIN_CONFIG, seed },
      createdAt: now,
      updatedAt: now,
    };
    catalog.maps.push(map);
    await this.persistCatalog();
    return cloneMap(map);
  }

  public async renameMap(mapId: string, name: string): Promise<void> {
    const catalog = await this.loadCatalog();
    const map = catalog.maps.find((candidate) => candidate.id === mapId);
    if (!map) {
      return;
    }
    map.name = sanitizeName(name, map.name);
    map.updatedAt = Date.now();
    await this.persistCatalog();
  }

  public async deleteMap(mapId: string): Promise<void> {
    const catalog = await this.loadCatalog();
    const index = catalog.maps.findIndex((candidate) => candidate.id === mapId);
    if (index < 0) {
      return;
    }
    catalog.maps.splice(index, 1);
    this.saveCatalogs.delete(mapId);
    await this.persistCatalog();
    await this.driver.removeDirectory(mapRoot(mapId));
  }

  public async listSaves(mapId: string): Promise<SaveRecord[]> {
    const catalog = await this.loadSaveCatalog(mapId);
    return [...catalog.saves]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((save) => ({ ...save }));
  }

  public async getSave(mapId: string, saveId: string): Promise<SaveRecord | null> {
    const catalog = await this.loadSaveCatalog(mapId);
    const save = catalog.saves.find((candidate) => candidate.id === saveId);
    return save ? { ...save } : null;
  }

  public async createSave(mapId: string, name: string): Promise<SaveRecord> {
    const catalog = await this.loadSaveCatalog(mapId);
    const now = Date.now();
    const save: SaveRecord = {
      id: createId("save"),
      mapId,
      name: sanitizeName(name, "New journey"),
      createdAt: now,
      updatedAt: now,
      editedChunks: 0,
      playtimeSeconds: 0,
    };
    catalog.saves.unshift(save);
    await this.persistSaveCatalog(mapId);
    await this.touchMap(mapId);
    return { ...save };
  }

  public async renameSave(mapId: string, saveId: string, name: string): Promise<void> {
    const catalog = await this.loadSaveCatalog(mapId);
    const save = catalog.saves.find((candidate) => candidate.id === saveId);
    if (!save) {
      return;
    }
    save.name = sanitizeName(name, save.name);
    save.updatedAt = Date.now();
    await this.persistSaveCatalog(mapId);
  }

  public async duplicateSave(mapId: string, saveId: string): Promise<void> {
    const catalog = await this.loadSaveCatalog(mapId);
    const source = catalog.saves.find((candidate) => candidate.id === saveId);
    if (!source) {
      return;
    }
    const copy = await this.createSave(mapId, `${source.name} copy`);
    await this.copyTree(
      `${saveRoot(mapId, source.id)}/regions`,
      `${saveRoot(mapId, copy.id)}/regions`,
    );
    await this.recordSave(mapId, copy.id, {
      editedChunks: source.editedChunks,
      playtimeSeconds: source.playtimeSeconds,
    });
  }

  public async deleteSave(mapId: string, saveId: string): Promise<void> {
    const catalog = await this.loadSaveCatalog(mapId);
    const index = catalog.saves.findIndex((candidate) => candidate.id === saveId);
    if (index < 0) {
      return;
    }
    catalog.saves.splice(index, 1);
    await this.persistSaveCatalog(mapId);
    await this.driver.removeDirectory(saveRoot(mapId, saveId));
  }

  /** Records a successful autosave: edit count and timestamp. */
  public async recordSave(
    mapId: string,
    saveId: string,
    stats: { editedChunks: number; playtimeSeconds?: number },
  ): Promise<void> {
    const catalog = await this.loadSaveCatalog(mapId);
    const save = catalog.saves.find((candidate) => candidate.id === saveId);
    if (!save) {
      return;
    }
    save.updatedAt = Date.now();
    save.editedChunks = stats.editedChunks;
    if (stats.playtimeSeconds !== undefined) {
      save.playtimeSeconds = stats.playtimeSeconds;
    }
    await this.persistSaveCatalog(mapId);
    await this.touchMap(mapId);
  }

  private async loadCatalog(): Promise<MapCatalog> {
    if (this.catalog) {
      return this.catalog;
    }
    const stored = await readJson<MapCatalog>(this.driver, CATALOG_PATH);
    this.catalog =
      stored && Array.isArray(stored.maps)
        ? { schema: SAVE_SCHEMA, maps: stored.maps.filter(isMap).map(cloneMap) }
        : { schema: SAVE_SCHEMA, maps: [] };
    return this.catalog;
  }

  private async persistCatalog(): Promise<void> {
    await writeJson(this.driver, CATALOG_PATH, this.catalog ?? { schema: SAVE_SCHEMA, maps: [] });
  }

  private async loadSaveCatalog(mapId: string): Promise<SaveCatalog> {
    const cached = this.saveCatalogs.get(mapId);
    if (cached) {
      return cached;
    }
    const stored = await readJson<SaveCatalog>(this.driver, saveCatalogPath(mapId));
    const catalog: SaveCatalog =
      stored && Array.isArray(stored.saves)
        ? { schema: SAVE_SCHEMA, saves: stored.saves.filter(isSave).map((save) => ({ ...save })) }
        : { schema: SAVE_SCHEMA, saves: [] };
    this.saveCatalogs.set(mapId, catalog);
    return catalog;
  }

  private async persistSaveCatalog(mapId: string): Promise<void> {
    await writeJson(this.driver, saveCatalogPath(mapId), this.saveCatalogs.get(mapId));
  }

  private async touchMap(mapId: string): Promise<void> {
    const catalog = await this.loadCatalog();
    const map = catalog.maps.find((candidate) => candidate.id === mapId);
    if (!map) {
      return;
    }
    map.updatedAt = Date.now();
    await this.persistCatalog();
  }

  private async copyTree(fromPrefix: string, toPrefix: string): Promise<void> {
    for (const path of await this.driver.list(fromPrefix)) {
      const bytes = await this.driver.read(path);
      if (!bytes) {
        continue;
      }
      const relative = path.slice(fromPrefix.length).replace(/^\/+/, "");
      await this.driver.write(`${toPrefix}/${relative}`, bytes);
    }
  }
}
