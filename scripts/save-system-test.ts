import assert from "node:assert/strict";
import { CHUNK_VOLUME } from "../src/game/chunk-types.ts";
import { saveRoot, SaveSystem } from "../src/game/save-system.ts";
import { MemoryStorageDriver } from "../src/game/storage.ts";
import { WorldPersistence } from "../src/game/voxel-store.ts";
import { VoxelWorld } from "../src/game/world.ts";

/**
 * Verifies multiple maps, multiple save files, and per-save world persistence.
 *
 * Run with:  node --no-warnings --experimental-transform-types scripts/save-system-test.ts
 */

let passed = 0;

const check = (label: string, condition: boolean): void => {
  assert.ok(condition, `FAIL: ${label}`);
  passed += 1;
  console.log(`  ok  ${label}`);
};

const emptyBase = (): Uint8Array => new Uint8Array(CHUNK_VOLUME);

const main = async (): Promise<void> => {
  const driver = new MemoryStorageDriver();
  const saves = new SaveSystem(driver);

  console.log("== Catalog ==");
  await saves.init();
  const initialMaps = await saves.listMaps();
  check("default world is created", initialMaps.length === 1);
  const defaultMap = initialMaps[0]!;
  check("default save is created", (await saves.listSaves(defaultMap.id)).length === 1);
  check("catalog is a JSON file", (await driver.read("catalog.json")) !== null);

  console.log("== Multiple maps ==");
  const mapB = await saves.createMap({ name: "Second world", seed: 42 });
  check("map keeps its seed", mapB.terrain.seed === 42);
  check("map count grows", (await saves.listMaps()).length === 2);
  check("map can be fetched", (await saves.getMap(mapB.id))?.name === "Second world");

  console.log("== Multiple saves ==");
  const saveB = await saves.createSave(mapB.id, "Fresh");
  const rootB = saveRoot(mapB.id, saveB.id);
  await driver.write(`${rootB}/regions/0,0.nvrg`, Uint8Array.from([1, 2, 3, 4]));
  check("save list grows", (await saves.listSaves(mapB.id)).length === 1);
  check("region file stored under the save", (await driver.list(`${rootB}/regions`)).length === 1);

  await saves.duplicateSave(mapB.id, saveB.id);
  const savesB = await saves.listSaves(mapB.id);
  check("duplicate save listed", savesB.length === 2);
  const copy = savesB.find((save) => save.name === "Fresh copy");
  check("duplicate is named", copy !== undefined);
  const copied = copy ? await driver.read(`${saveRoot(mapB.id, copy.id)}/regions/0,0.nvrg`) : null;
  check("duplicate copies region blobs", copied !== null && copied[0] === 1);

  console.log("== Rename and stats ==");
  await saves.renameMap(mapB.id, "Renamed world");
  check("map renamed", (await saves.getMap(mapB.id))?.name === "Renamed world");
  await saves.renameSave(mapB.id, saveB.id, "Renamed save");
  check("save renamed", (await saves.getSave(mapB.id, saveB.id))?.name === "Renamed save");
  await saves.recordSave(mapB.id, saveB.id, { editedChunks: 7 });
  check("edit count recorded", (await saves.getSave(mapB.id, saveB.id))?.editedChunks === 7);

  console.log("== Delete ==");
  const bareMap = await saves.createMap({ name: "Bare world", seed: 7 });
  check("new world starts with no saves", (await saves.listSaves(bareMap.id)).length === 0);
  await saves.deleteMap(bareMap.id);
  check("world without saves can be deleted", (await saves.getMap(bareMap.id)) === null);

  await saves.deleteSave(mapB.id, saveB.id);
  check("save deleted", (await saves.getSave(mapB.id, saveB.id)) === null);
  check("save regions removed", (await driver.list(rootB)).length === 0);
  await saves.deleteMap(mapB.id);
  check("map deleted", (await saves.getMap(mapB.id)) === null);
  check("map subtree removed", (await driver.list(`maps/${mapB.id}`)).length === 0);
  check("other map survives", (await saves.listMaps()).length === 1);

  console.log("== Per-save world persistence ==");
  const world = new VoxelWorld();
  const blocks = new Uint8Array(CHUNK_VOLUME);
  blocks[0] = 1;
  blocks[100] = 5;
  blocks[5000] = 9;
  world.adoptChunk({ x: 0, z: 0, blocks });
  const persistence = new WorldPersistence({
    world,
    driver,
    root: "test-roundtrip",
    blockFingerprint: 111,
    generatorFingerprint: 222,
    generateBase: emptyBase,
  });
  persistence.markEdited({ x: 0, z: 0 });
  await persistence.flush();
  check(
    "persistence writes one region",
    (await driver.list("test-roundtrip/regions")).length === 1,
  );

  const restored = new VoxelWorld();
  const restorePersistence = new WorldPersistence({
    world: restored,
    driver,
    root: "test-roundtrip",
    blockFingerprint: 111,
    generatorFingerprint: 222,
    generateBase: emptyBase,
  });
  await restorePersistence.restore();
  const restoredChunk = restored.getChunk({ x: 0, z: 0 });
  check(
    "edited chunk round-trips through a save",
    restoredChunk !== null && restoredChunk.blocks[0] === 1 && restoredChunk.blocks[5000] === 9,
  );

  console.log("== Fingerprint invalidation ==");
  const stale = new VoxelWorld();
  const stalePersistence = new WorldPersistence({
    world: stale,
    driver,
    root: "test-roundtrip",
    blockFingerprint: 111,
    generatorFingerprint: 999,
    generateBase: emptyBase,
  });
  await stalePersistence.restore();
  check("stale save is not restored", stale.getChunk({ x: 0, z: 0 }) === null);
  check(
    "stale region file is discarded",
    (await driver.list("test-roundtrip/regions")).length === 0,
  );

  console.log("== Clear ==");
  persistence.markEdited({ x: 0, z: 0 });
  await persistence.flush();
  await persistence.clear();
  check("clear removes every region", (await driver.list("test-roundtrip/regions")).length === 0);

  console.log(`\nAll save system checks passed (${passed}).`);
};

await main();
