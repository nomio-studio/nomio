# Notes: nomio terrain generation and meshing

## Baseline

- The repository contains a playable floating-island voxel MVP with a data-first `VoxelWorld`.
- Three.js `0.186.0`, Vite `8.3.0`, strict TypeScript, ESLint, Prettier, Husky, and commitlint are already configured.
- `main.ts` should remain a minimal browser bootstrap; `NomioApplication` owns the app lifecycle and `GameSession` owns runtime composition.
- `BlockTextureAtlas` already provides a good renderer seam but is constructed from global block definitions.
- `InputManager` and `Hud` attach browser listeners but do not expose disposal methods.
- `PlayerController` consumes grouped `PlayerConfig` values and exposes its collision bounds to interaction systems.
- `VoxelWorld` is data-first but exposes a static player-bounds helper, mixing world storage with player collision details.

## Terrain requirements

- OpenSimplex2 must be the base 2D noise function; fBm must superpose multiple octaves.
- A heightmap samples `(x, z)` and maps the result to integer surface `y` values.
- Chunks must store block values in `Uint8Array`, with `0` reserved for air.
- Generation must run in a Web Worker and transfer generated buffers without copying.
- Rendering must emit only exposed faces and merge adjacent coplanar faces with greedy meshing.

## Existing terrain constraints

- The old hand-authored starter island has been replaced by worker-generated terrain chunks.
- The renderer now creates one greedy Three.js mesh per loaded chunk, and the player/interactor query numeric chunk storage through `VoxelWorld`.
- The atlas already provides one material per block ID, which can be reused by greedy mesh groups.

## Planned contracts

- `chunk-types.ts`: fixed chunk dimensions, chunk coordinates, numeric block values, and transferable generated chunk payloads.
- `terrain-config.ts`: seed, scale, octave, height, and layering parameters shared by main thread and worker.
- `open-simplex2.ts`: deterministic 2D OpenSimplex2 implementation with no DOM or Three.js dependencies.
- `terrain-generation.ts`: pure chunk generation using OpenSimplex2 fBm and stone/dirt/grass layers.
- `terrain-generation.worker.ts`: request/response protocol and transferable `ArrayBuffer` ownership.
- `greedy-mesher.ts`: face culling plus orientation-specific maximal rectangle merging.
- `world.ts`: main-thread chunk map with world-coordinate access and generated chunk replacement.

## Refactor direction

- `NomioApplication` should own the browser lifecycle and expose `start()` / `dispose()`.
- `GameSession` should compose world, renderer, player, interactor, HUD, input, and timer without leaking composition into `main.ts`.
- `SceneRuntime` should own renderer/camera/lights and resize behavior.
- `BlockRegistry` should be the single source for definitions and order; HUD, atlas, and selection should depend on it.
- `GameConfig` should group camera, player, interaction, rendering, and terrain tuning with defaults.
- Each event-driven service should use an `AbortController` or explicit listener cleanup.

## Terrain implementation delivered so far

- `OpenSimplex2` implements the 2D OpenSimplex2S lattice evaluator with deterministic seeded gradients.
- `sampleFbm` superposes configurable octaves; `sampleTerrainHeight` maps normalized `(x, z)` samples to integer surface `y` values.
- `generateTerrainChunk` emits stone beneath two dirt layers and a grass surface into a 10,240-byte `Uint8Array`.
- `TerrainWorker` uses a module Web Worker and transfers each generated `ArrayBuffer` back to the main thread.
- `buildGreedyMesh` culls faces against `VoxelWorld.getBlockType()` and merges contiguous same-type masks per orientation.
- `VoxelWorldRenderer` creates one grouped geometry per loaded chunk, preserving atlas materials and picking through hit points.

## Verification evidence

- Vite emitted a separate `terrain-generation.worker` bundle and the browser loaded it without page or console errors.
- A generated chunk is deterministic for the same seed and contains 256 grass, 512 dirt, and 4,231 stone values in a 10,240-byte buffer.
- A fully solid synthetic chunk produces 6 greedy quads; supplying a solid +X neighbor reduces it to 5, proving face culling across a chunk boundary.
- Browser reset returns the terrain to the same 39,594-block state, and block selection remains functional.

## Refactor delivered

- Added `NomioApplication`, `GameSession`, `SceneRuntime`, `GameShell`, `GameConfig`, and `BlockRegistry` boundaries.
- Added terrain configuration overrides for seed, fBm, heightmap, and initial chunk view distance.
- Added worker-generated transferable chunk buffers and flat `Uint8Array` storage with `0` reserved for air.
- Added neighbor-aware greedy meshing that merges same-material visible faces into chunk geometries.
- Added deterministic cleanup for input, HUD, timer, worker, renderer, atlas, and resize listeners.
- Reused player movement vectors to avoid allocating several Three.js vectors per frame.

## Block catalog delivered

- Natural: grass, dirt, stone, cobblestone, sand, snow, leaves.
- Crafted: oak log, oak planks, bricks, mossy cobblestone.
- Mineral / special: coal ore, iron ore, obsidian, crystal, glass, netherrack.

## Existing visual direction

- Subject: a quiet, jewel-like voxel garden called “nomio,” with the game world treated as the main visual artifact.
- Palette: deep ink `#101820`, mineral blue `#6d97a8`, warm stone `#d6c3a5`, lichen `#98b27f`, and signal coral `#f27b63`.
- Signature: a thin coral targeting reticle and block palette that uses tactile swatches rather than generic icon buttons.
- UI typography: a condensed utility face for labels and a readable system sans for instructions.

## Verification targets

- `npm run typecheck`
- `npm run lint`
- `npm run format:check`
- `npm run build`
- Local Vite smoke check plus manual/browser inspection of texture rendering, block selection, placement, and reset.
