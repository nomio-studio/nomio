# Notes: nomio terrain generation and meshing

## Baseline

- The repository contains a playable floating-island voxel MVP with a data-first `VoxelWorld`.
- Three.js `0.186.0`, Vite `8.3.0`, strict TypeScript, ESLint, Prettier, Husky, and commitlint are already configured.
- `main.ts` should remain a minimal browser bootstrap; `NomioApplication` owns the app lifecycle and `GameSession` owns runtime composition.
- `BlockTextureAtlas` already provides a good renderer seam but is constructed from global block definitions.
- `InputManager`, `Hud`, and the UI components own `AbortController`-based listener cleanup and expose `dispose()`.
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

## Infinite streaming delivered

- `chunk-streamer.ts` tracks the player's chunk and streams a configurable window around it, requesting missing chunks nearest-first and unloading chunks beyond the view distance.
- Unloading uses a one-chunk hysteresis band so crossing a boundary back and forth does not regenerate the same chunks.
- When a chunk loads or unloads, the streamer rebuilds that chunk plus its loaded neighbors, keeping greedy border faces correct without a full-world rebuild.
- `VoxelWorld` snapshots chunks that the player edits, so a modified chunk leaves and returns from memory and is not overwritten by terrain regeneration.
- `VoxelWorldRenderer` gained incremental `applyMesh`, `removeChunk`, and `clear` methods; interaction signals the streamer to re-mesh only the chunks touched by an edit.
- `viewDistance` defaults to `16`, and terrain generation is a pure function of world coordinates, so neighboring chunks are seamless.

## View distance 16 and performance work

- `terrain-config.ts` now defaults `viewDistance` to `16`; `SceneRuntime` derives the camera far plane and fog range from it so the extended world reads correctly.
- The streamed window is circular (`createChunkCircle`) instead of square, loading roughly 797 chunks instead of 1089 at radius 16.
- `chunk-mesher.ts` flattens greedy quads into transferable typed arrays, and `terrain-generation.worker.ts` runs both generation and meshing.
- `terrain-worker.ts` is a pool of module workers sized from `navigator.hardwareConcurrency`, dispatching each request to the least busy worker so generation and meshing stay parallel.
- `ChunkStreamer` consumes finished meshes under a `render.meshBudgetMs` budget per frame, nearest-first, so GPU uploads never block a frame.
- Shadow maps use `renderer.shadowMap.autoUpdate = false` and refresh on demand; only chunks within `render.shadowChunkRadius` cast shadows and the sun target follows the player.
- Player physics starts once a small ready radius is loaded while the rest of the 16-chunk window streams in, keeping startup responsive.
- `VoxelWorld` tracks dirty chunks from edits; `ChunkStreamer` drains them and re-meshes the edited chunk plus its neighbors, so edits no longer need an interactor callback.
- `BlockTextureAtlas` deduplicates materials by surface signature, collapsing the 17 block types to 4 shared material slots so a typical chunk issues one draw call per material slot instead of one per block type.
- Chunk meshes set `frustumCulled = true` and rely on streaming unload for distance culling, with fog and the far plane derived from the view distance.

## Dynamic sky delivered

- `dynamic-sky.ts` renders an inverted sphere with a custom `ShaderMaterial`: a vertical zenith/horizon/ground gradient, a warm horizon glow toward the sun, a soft sun halo and disk, planar-projection fbm clouds that drift over time, and hashed twinkling stars at night.
- `SkyPalette.compute(sunDirection)` maps the sun's elevation to day, dusk, and night color stops, plus sun intensity, star intensity, sunset strength, and cloud amount, so all sky elements change together.
- `SceneRuntime` advances a configurable `sky.cycleDuration` cycle from `sky.startTime`, computes the sun direction, updates the dome, and drives the directional sun light, hemisphere light, and fog color from the same palette.
- The sun light orbits the player and flips to a soft "moon" direction below the horizon; the shadow map refreshes a few times per second instead of every frame, and the sky mesh uses `depthTest: false` with a negative render order so it is a cheap background.
- The shader includes Three's `tonemapping_fragment` and `colorspace_fragment` so the sky tone-maps and color-converts consistently with the terrain.
- Browser verification sampled rendered pixels: noon sky is blue-dominant (rgb 138/176/202), midnight is dark (luma 10), and the sunset horizon is warm (rgb 241/192/160), with no shader compile errors.

## Smooth lighting + vertex AO delivered

- `chunk-lighting.ts` builds an 18×H×18 padded block volume from a chunk and its eight horizontal neighbors, then flood-fills sky light (from vertically exposed air) and emitted block light through air cells, losing one level per step.
- Block definitions gained an optional `lightEmission`; crystal emits 13, and `BLOCK_TYPE_LIGHT` exposes the per-type lookup.
- `greedy-mesher.ts` computes the classic four-level corner AO from the two edge neighbors and the diagonal, averages the light of the surrounding air cells, and encodes block type + four AO values + four light values into the merge key so greedy quads only merge when they shade identically.
- `chunk-mesher.ts` samples AO/light from the padded volume and serializes them as transferable `ao`/`light` buffers; `ChunkMeshNeighbors` is now a map of the eight surrounding chunks.
- `VoxelWorldRenderer` bakes `ao × light` into a per-vertex `color` attribute with a subtle cool shadow tint, and the atlas materials enable `vertexColors`.
- Edits mark chunks dirty, and `ChunkStreamer` relights/re-meshes the surrounding 3×3 chunk neighborhood so propagated light stays correct across borders.
- Browser verification covers six lighting checks: isolated blocks are fully lit and unoccluded, a solid chunk culls interior faces, a wall darkens the adjacent AO vertex, crystal light falls off 13→12→10, and a ceiling reduces sky light from 15 to 0; the renderer exposes matching per-vertex color data.

## Lighting quality pass

- Baked AO/light is no longer multiplied into albedo. A small `onBeforeCompile` patch reads the `aLight` attribute and scales only `reflectedLight.indirectDiffuse`/`indirectSpecular`, so direct sunlight is never darkened and recesses read as soft contact shadows.
- The shader applies a floor (`mix(0.6, 1.0, ao × light)`) and the light curve uses a 0.6 ambient floor, removing the pitch-black corners the vertex-color approach produced.
- Chunk load/unload now re-meshes all eight neighbors (previously only the four orthogonal ones); AO and light at chunk corners sample diagonal blocks, so the missing diagonals left lit seams at chunk borders.
- The directional shadow uses a 2048² map over a ±40 frustum, `normalBias = 0.04`, `bias = -0.0002`, and `PCFSoftShadowMap`, fixing the acne/light bleed at block edges.
- The sun shadow focus follows the player continuously and only re-renders on a short timer, so shadows no longer jump by whole chunks (the previous 16-block steps looked misaligned).

## UI system refactor delivered

- `src/ui/ui.ts` owns a four-state machine (`loading`, `title`, `playing`, `paused`) and composes the pieces; `GameSession` no longer builds HTML and talks only to `GameUi`.
- Screens and overlays were split into focused modules: `screens.ts` (loading with a determinate `ChunkStreamer.loadProgress` bar, title), `dialogs.ts` (native `<dialog>` pause, live settings form, reset confirmation), `hud.ts` (in-game layer), `toasts.ts` (polite live-region feedback), `settings.ts` (normalized, `localStorage`-persisted UI settings), `tokens.ts` (palette shared with Three.js), and `dom.ts` helpers.
- The interaction loop is closed: boot progress → title → enter → play (HUD, toasts for mine/place/fall/reset) → `Esc` pause → resume / settings / reset-confirm / return to title. Pointer-lock loss opens the pause menu, and focus is restored on close.
- `PlayerController` gained mutable `lookSensitivity` and `invertLook`; `SceneRuntime` gained `setFieldOfView`; `InputManager` gained `setInteractive`, `exitPointerLock`, and a promise-returning `requestPointerLock`. Settings apply live and persist.
- Accessibility/polish pass: native dialog focus trapping, roving-tabindex hotbar toolbar with arrow keys, accessible names on every control, one page-level `<h1>`, tokenized palette with text shadows over the world, and verified WCAG AA contrast on every text pair. `style.css` was rewritten around custom-property tokens and honors reduced motion/transparency and increased contrast.

## Temporal antialiasing delivered

- `render-pipeline.ts` replaces direct rendering when `GameConfig.antialiasing.enabled` and WebGL2 are available. The scene pass writes to a linear `HalfFloatType` target (falling back to 8-bit) with a depth texture; materials run with `NoToneMapping` so the composite owns exposure, tone mapping, grading, and the sRGB encode.
- A Halton(2,3) sequence jitters the projection by up to half a pixel each frame (period 8). The render path restores the unjittered projection after the scene pass, so raycasts and gameplay stay pixel-accurate.
- The temporal pass reconstructs world position from depth with the inverse unjittered view-projection and reprojects with the previous view-projection. Sky pixels never write depth, so they reproject as translation-free directions and the camera-locked skybox does not smear.
- Ghosting is handled by variance clipping in YCoCg (`mean ± 1.35σ`) rather than a depth test: a hard depth rejection rejects history at every silhouette edge, which is exactly where convergence is needed. History weight is also scaled down as pixel motion grows.
- Bug fix: the YCoCg inverse used `Y - Cg` for green instead of `Y + Cg`, so every temporally accumulated frame progressively drained the green channel and desaturated grass and other green-dominant blocks toward grey. It only appeared after the first frame (frame 0 resets history), which is why single-frame and non-TAA captures looked correct.
- Temporal softness is countered with a 4-tap unsharp mask clamped to the local min/max, so it sharpens without ringing. Sharpness, history weight, and the toggle are configurable.
- History clears on teleport, fall recovery, world reset, `setTimeOfDay` jumps, and player break/place edits. Resizing recreates the targets.
- Verification: a synthetic diagonal-edge harness shows TAA resolves a hard edge into gradient pixels (198 vs 0 without TAA) with a transition of at most two pixels, sharpening raises edge contrast, consecutive jittered frames differ while non-TAA frames are identical, and camera motion never freezes. On a captured game frame, aliased edge pixels dropped from 0.60% to 0.24%.

## Atmosphere / fog delivered

- `fog.ts` owns a `FogController` with shared uniform holders and derives color, sun color, and glow strength from the same `SkyPalette` the dome and lights use, so the atmosphere and sky never disagree. It is optional (`GameConfig.fog.enabled`) and injected into the terrain materials.
- The fog is analytic and layered: an exponential distance term from `start`, a height term (`exp(-max(y - height, 0) * falloff)`) that pools mist in low ground and thins with altitude, and a single-octave drifting world-space value noise for mist banks.
- Sun inscattering mixes the fog color toward the sun color by `pow(max(dot(viewDir, sunDir), 0), sharpness)`, weighted toward the horizon, and strongest at dawn/dusk via `palette.sunsetStrength`.
- The fog body is injected after `#include <opaque_fragment>` so it blends in linear space before tone mapping in both the TAA and fallback paths; the built-in Three fog is disabled (`material.fog = false`) and `scene.fog` was removed. Fog color therefore tone-maps identically to the sky horizon and distant terrain disappears into it.
- A hash dither in the fog body and a matching dither in the composite break up banding in wide gradients. The vertex shader passes `vFogWorldPosition`; distance uses `cameraPosition` and world height, so it works with the instanced-free chunk meshes without extra buffers.
- Verification: a synthetic harness confirms near-field clarity, far-field shift toward the fog color, lower ground hazier than higher ground at equal distance, warmer fog toward the sun, and day/night color from the palette. Captured frames show a warm `rgb(219,190,129)` sunset horizon over `rgb(39,41,43)` near terrain and a deep-blue `rgb(1,6,13)` night.

## Global illumination delivered

- `chunk-lighting.ts` now computes three fields in the padded volume: scalar skylight, interleaved RGB colored light, and scalar luminance for the existing AO shading and greedy merge key. Emitters seed the RGB field with their `emissionColor` (crystal is cold cyan); `BLOCK_TYPE_ALBEDO` and `BLOCK_TYPE_EMISSION_COLOR` in `blocks.ts` expose the per-type values.
- One bounce of global illumination runs after the direct passes: every non-emitter solid reflects the skylight and emissive light in its adjacent air cell back into that air cell, tinted by its own albedo, and the colored result floods through the world. Emitters are skipped so they do not double-count and wash out.
- The bounce is multiplied by `BOUNCE_GAIN` before quantization so low-intensity albedo differences survive the 4-bit-per-channel packing; `GlobalIllumination` divides the gain back out and tints the result by the sky ambient each frame, giving indirect light a day/night rhythm.
- `greedy-mesher.ts` samples the RGB indirect at the quad's anchor cell and emits it per vertex; it is deliberately not part of the merge key, so greedy merging behavior is unchanged and only emitted quads pay for the extra sampling. `chunk-mesher.ts` packs it into a `Uint16Array` and `VoxelWorldRenderer` expands it to an `aIndirect` vec3 attribute. The atlas patch adds `reflectedLight.indirectDiffuse += vIndirect * uGiColor * occlusion`.
- Optimizations: the propagation uses a growable `Int32Array` queue reused across meshes instead of a `number[]`; the emissive and bounce floods are skipped when there is no emitter or no bounce seed; and a fully solid volume exits with all-zero light.
- Verification: a synthetic harness confirms sunlit grass bounces green onto a nearby wall, a crystal spreads cyan, disabling GI removes all indirect light, a solid volume propagates none, real chunk meshes carry colored indirect, and the renderer's `aIndirect` attribute matches the vertex count with a green bias from grass.

## Tone mapping + color grading delivered

- `color-grade.ts` owns a `ColorGrade` controller with the composite uniforms. White balance is derived on the CPU from a Kelvin blackbody fit (Tanner Helland) divided by the D65 reference and luminance-normalized, so a neutral 6500 K grade leaves exposure untouched; tint shifts green/magenta. Exposure is applied in stops on top of the base `render.exposure`.
- The composite applies, in order: the clamped unsharp mask, white balance and exposure in linear, AgX or ACES tone mapping, then a display-referred grade — pivot contrast, luminance-preserving saturation with a vibrance boost for low-saturation pixels, highlight recovery, shadow lift — and a vignette, before the sRGB encode and dither.
- AgX is copied from Three.js r186 (inset/outset matrices, log2 encoding, `agxDefaultContrastApprox`, Rec2020 round-trip); ACES is the existing RRT/ODT fit. `uToneMapping` selects between them at runtime.
- `SceneRuntime.setGrading(partial)` merges and clamps a partial grade and returns the effective config; the fallback path also updates `renderer.toneMapping`/`toneMappingExposure`. The settings panel gained a Color group (tone mapping select, exposure/contrast/saturation/temperature sliders) with live application and persistence.
- Verification: a synthetic full-screen-color harness confirms exposure raises brightness, contrast pushes darks down and lights up, saturation scales chroma from grey to boosted, temperature warms/cools white, AgX and ACES differ and roll off highlights below 1, the AgX curve is monotonic, and the vignette darkens corners. Captured frames show warm 3800 K at r−b ≈ +35 and a cool, saturated 9500 K punch grade at r−b ≈ −110 against the AgX baseline.

## Touch controls delivered

- Touch is detected once from `navigator.maxTouchPoints`, falling back to `(any-pointer: coarse)`; the UI root gets an `is-touch` class that reveals `touch-controls.ts` and hides the keyboard field-kit card. A first real `pointerdown` with `pointerType === "touch"` also enables it, so hybrid laptops gain touch controls the moment a finger is used.
- Movement is a floating analog stick: `pointerdown` anywhere in the left zone drops the base under the thumb, drags are clamped to a 58 px radius, a 0.16 dead zone is subtracted and the remainder rescaled to full range, and the resulting vector keeps its magnitude so a half-push walks at half speed. The knob returns to a resting lower-left hint on release or resize.
- Look uses Pointer Events instead of raw touch events: `InputManager` captures the first non-mouse pointer on the canvas by id, applies `movement` deltas scaled by a dedicated touch sensitivity, and ignores a second look pointer. Because the stick zone and buttons are separate DOM targets that capture their own pointers, a stick in one hand and a look drag in the other work at the same time.
- Mine and Place fire immediately on `pointerdown` and then repeat every 170 ms after a 280 ms hold, matching click-and-hold without adding an edit timer; Jump is a single action. Buttons get `touch-action: none`, pointer capture, a pressed state, and `-webkit-user-select: none` so a drag off the button still releases cleanly.
- Stuck input is impossible by construction: `pointerup`, `pointercancel`, `lostpointercapture`, `window.blur`, and `visibilitychange` all release the stick and clear hold timers, and `InputManager.clear()` drops keys, move vector, look, jump, and actions.
- The layout is capability-gated rather than width-gated, so tablets in landscape get controls too, and both the controls and the hotbar/pause affordances are offset by `env(safe-area-inset-*)` with `viewport-fit=cover`. On touch, pointer lock is skipped and the title screen lists touch instructions in place of the WASD rows.
- Verification: a Playwright touch context (`hasTouch`, `isMobile`, 390×844) driven by CDP `Input.dispatchTouchEvent` passes 17/17 checks — capability detection, no pointer lock, drag-look retargeting, place/mine/jump, stick activation and walking, simultaneous stick + look, hold-to-repeat, palette tap, landscape survival, and zero console errors.

## Voxel storage format delivered

- `voxel-format.ts` defines the **Nomio Voxel Storage Format (NSVF)**, a dependency-free, worker-friendly codec that imports no block or terrain definitions. It is a byte-level format over `(sizeX, sizeY, sizeZ, minY)` dimensions, so it can run on the main thread, in a worker, or in a plain Node script.
- **Per-chunk layer**: every chunk is encoded independently by running the whole codec family and keeping the smallest result, tagged with a one-byte codec id in `CHUNK_CODEC`.
  - `CONSTANT` — a single fill value (2 bytes for an all-air or all-stone chunk).
  - `BITPACK` — a per-chunk palette plus fixed-width bit-packed indices.
  - `RLE` — a per-chunk palette with run-length encoding over the canonical plane-major buffer.
  - `COLUMN_DICT` — deduplicates identical vertical columns, RLE-encodes each unique column, then RLE-encodes the column-id grid; strong for cave-like or repeated columns.
  - `SURFACE_PROFILE` — derives a majority-vote surface-depth profile from the top down, collapses the repeating tail, and stores one surface height per column plus sparse exceptions. This matches layered heightmap terrain and stays exact after surface-relative edits.
  - `SPARSE` — stores only cells that differ from a baseline as sorted index deltas plus a palette. The baseline is either all-zero or an injected base buffer, which makes it the delta codec.
  - `HUFFMAN` — canonical Huffman coding of the palette indices, chosen for high-entropy chunks where dictionary codecs lose; it still beats gzip because the alphabet is only the chunk's palette.
  - Small integer grids (heights, column ids, profiles) are themselves compressed with the best of raw / bitpack / RLE via `readCompactSequence` / `writeCompactSequence`.
- **Region container** (`NVRG` magic): 32×32 chunks per region with dimensions and block/generator fingerprints in the header and a directory of `(local index, offset, length, CRC32)` entries. It gives random access to a single chunk and detects corruption on decode.
- **Archive container** (`NSVF` magic): a master header, region directory, and region blobs with a trailing footer CRC, so a whole map is one seekable file for download, upload, or a server.
- `storage.ts` is the single backend seam: a path-based `StorageDriver` (`read`/`write`/`delete`/`list`/`removeDirectory`) with `OpfsStorageDriver`, `LocalStorageStorageDriver`, and `MemoryStorageDriver`, and `createDefaultStorageDriver()` prefers OPFS (secure-context aware) over `localStorage` over memory. Path segments map to nested OPFS directories; `createWritable()` replaces a file on close, so an edit only rewrites the small region file it touched.
- Persistence stores only chunks the player edited, as `SPARSE` deltas against `generateTerrainChunk`, so a world of untouched terrain costs zero bytes and an edit costs a handful of bytes. `fingerprintTerrain` (seed/fBm/height plus `TERRAIN_SCHEMA`) and `fingerprintBlocks` (the block-id byte sequence) are written into every region header; a save that does not match the current build is deleted on restore rather than loaded. `WorldPersistence` now takes a `driver` plus a save `root` and writes `<root>/regions/<x>,<z>.nvrg`, so many saves share one backend.
- `GameSession` restores stored regions before streaming begins (`bootstrap` → `persistence.restore()` → `restored` guard → `beginStreaming`), debounces saves 600 ms after an edit, and clears storage on reset. `WorldPersistence.dispose()` flushes any pending region, and `onSaved` reports the current edit count so the catalog stays in sync. `VoxelWorld` gained `onChunkEdited`, `adoptChunk`, and `forEachEditedChunk` for the same purpose.
- Verification: `scripts/voxel-format-bench.ts` (`npm run bench:voxel-format`) round-trips every codec and the region/archive containers (including negative coordinates and a CRC corruption check) and compares against `node:zlib` gzip. Structured voxel data is about 1.98× smaller than gzip (434 B vs 859 B), a 16-chunk edited-world save is about 47× smaller (529 B vs 24,883 B gzip), an untouched uniform chunk is about 23× smaller, and a delta chunk is about 8.8× smaller. Only adversarial random noise is roughly on par (`adversarial: true`), and it is reported separately. A 200-chunk encode runs at about 420 µs/chunk.
- `tsconfig.scripts.json` typechecks the scripts with Node types; the format module is deliberately free of parameter properties, enums, and value imports so Node's strip-only TypeScript mode can execute the benchmark directly. The save-system test imports browser-targeted modules, so it runs under `--experimental-transform-types` with `scripts/ts-loader.mjs`, a tiny resolve hook that appends `.ts` to the source's bundler-style extensionless imports.

## Worlds and saves library delivered

- `SaveSystem` (`src/game/save-system.ts`) is the catalog over a `StorageDriver`: worlds (`MapRecord`) own a terrain definition, and each world owns any number of save slots (`SaveRecord` with edit count and timestamps). Layout is `catalog.json`, `maps/<mapId>/saves.json`, and `maps/<mapId>/saves/<saveId>/regions/<x>,<z>.nvrg`; `init()` seeds a first world and save, and every mutation is a small JSON write.
- `SaveLibrary` (`src/ui/library.ts`) is the modal browser: pick a world, then open/create/rename/duplicate/delete its saves, or create a world from a name and seed. Delete asks for confirmation inline, the active save and its world cannot be deleted while playing, and every mutation goes through the `SaveLibraryController` interface so the dialog owns no storage logic.
- Ownership moved up a level. `GameUi` is now created by `NomioApplication` and lives for the whole page, while `GameSession` receives it and never disposes it; a session subscribes to UI state instead of owning the state machine. `NomioApplication` resolves a world and save, builds a session scoped to that save's root, and disposes and recreates the session when the player opens another one. `GameSession` exposes intent methods (`beginPlay`, `pause`, `resume`, `reset`, `selectBlock`, `setMoveVector`, `requestJump`, `applyUiSettings`) that the application routes to the live session.
- The title screen and pause menu gained a **Worlds** entry point and show the loaded save; `GameUi` gained `addStateListener`, `setWorldLabel`, and `setActiveSave`, and the library reopens the pause menu after closing when it was opened from there.
- Verification: `scripts/save-system-test.ts` (`npm run test:saves`) drives `SaveSystem` and per-save `WorldPersistence` on a `MemoryStorageDriver` and asserts 24 checks — default seeding, multiple worlds with seeds, multiple saves, region storage per save, duplication with blob copy, rename, edit-count recording, save/map deletion and subtree cleanup, edited-chunk round-trip through persistence, fingerprint invalidation of stale regions, and `clear()`.

## Control feel pass delivered

- Movement now auto-hops one-block ledges. `PlayerConfig` gained `autoJump` and `stepHeight`; when a horizontal step is blocked and the player is grounded, `PlayerController` probes the target one block up — if that space is clear it applies a jump impulse, so a one-block rise is climbed while a two-block wall still simply blocks. A deterministic Node harness walks into 1- and 2-high steps and confirms the climb, the stall when `autoJump` is off, and the wall guard.
- Defaults were raised for a snappier feel: walk speed 4.2 → 5.2 blocks/s and base look sensitivity 0.0022 → 0.003, with touch inheriting the same lift through its multiplier.
- Touch editing moved off the answer buttons. `touch-controls.ts` now renders only the floating stick and a Jump button; the Mine and Place buttons are gone. The first non-mouse canvas pointer is both the look and the edit gesture: moving past a 16 px slop drags the view, a quick tap places on the aimed face, and a stationary 400 ms hold starts mining, which continues while the finger stays down. Break and place are gated on the playing state, so a dropped finger cannot edit a paused world.
- Verification: a fake-DOM Node harness asserts the gesture state machine (tap places, a short hold still places, a long press breaks, holding repeats, a drag looks without editing, sloppy taps place, and moving after a hold cancels the repeat), and a CDP touch run against the dev server enters play, drags to aim, taps to place (`Placed Grass`), and holds to mine (`Mined Grass`) with no console errors.

## Breaking feedback pass delivered

- Mining is held, not instant. `InputState` carries a `breaking` flag (pointer-lock LMB or a touch long press) instead of discrete `break` actions; `VoxelInteractor.advanceMining` accumulates per-target progress over `InteractionConfig.breakDuration` (0.4 s) and only removes the block at full progress. Progress resets the moment the aimed block changes or the input is released, so a fresh crack starts on the next block.
- The aimed block grows a destroy-stage overlay: a slightly larger transparent cube whose crack texture advances through the ten `createBreakStageTexture` stages as progress climbs. The overlay hides whenever mining stops, the target changes, or the world resets.
- A break throws a burst of tinted debris. `BreakParticles` pools 96 instanced cubes in a single draw call, tints them from the broken block's `color`, and integrates gravity, spin, and a tail-end shrink before retiring them.
- The reticle is pointer-only now: `#ui.is-touch .crosshair` hides it, while desktop keeps it as the mining target.
- `InputManager.setInteractive(false)` clears held input, so pausing mid-mine cannot leave the break latched.
- Verification: `mining-progress.ts` asserts half-progress no-break, the exact full-progress break, per-target reset, and release and target-loss resets; the fake-DOM gesture harness passes its tap/hold/drag checks; a CDP touch run enters play, taps to place, and holds to mine (`Mined Grass`) with no console errors; a reticle probe confirms the crosshair shows on desktop and hides on touch; and screenshots confirm the crack overlay and debris render.

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

## Touch editing and feedback refinement findings

- The current uncommitted implementation already routes touch/pen gestures through normalized pointer coordinates: a stationary tap queues placement at that point, a long press holds mining at that point, and a drag becomes look input.
- A real Playwright touch context at 390×844 reached `playing` with `#ui.is-touch`, no page or console errors, and `getComputedStyle(.crosshair).display === "none"`.
- Non-center touch input at visible terrain coordinates successfully produced `Placed Grass`; a long press at a non-center coordinate successfully produced `Mined Grass` and decremented the live block count.
- The current code still has fragile edges: coarse-pointer CSS should be a second reticle-removal path, aim state should reset mining/overlay state atomically when the target changes, and break feedback should emphasize a short impact pulse and grounded, palette-aware shards while keeping the instanced pool bounded.

## Refinement implementation

- `pointercancel` now releases a touch gesture without queuing a placement, preventing browser interruption events from becoming accidental edits.
- `VoxelInteractor.update()` compares the next picked voxel before assigning it and clears mining progress immediately when the target changes or disappears.
- The break overlay now uses progressive opacity, a small stage-change pulse, double-sided crack faces, and explicit reset state; `GameSession` advances that pulse every frame.
- Break debris uses one bounded `InstancedMesh` pool and tetrahedral shards, retaining palette tinting, collision-aware motion, spin, bounce, and fade with fewer triangles than cube fragments; flat shading keeps the facets readable.
- Coarse-pointer CSS hides the desktop crosshair and centre target readout before JavaScript touch detection runs; pen input also activates the touch UI mode.

## Terrain upgrade baseline

- The existing generator samples a single five-octave 2D fBm signal, resulting in a narrow grass/dirt/stone height band (the live capture reads as gently stepped plains with no distinct silhouette).
- The worker and streaming architecture is already well suited to a richer pure generator: chunks are generated off-thread, mesh uploads are budgeted, and every terrain query can remain world-coordinate deterministic.
- The vertical chunk window is `y=-12..27`; the new landscape must create strong relief within that limit rather than expand chunk height and inflate generation, lighting, and mesh costs.
- Available block vocabulary can communicate terrain character without new assets: sand for basins, netherrack for dry mesas, snow for alpine caps, mossy cobble for lush rock, obsidian plus crystal for rare landmarks, and logs/leaves for forest silhouettes.
- Visual baseline capture: `/tmp/nomio-terrain-before.png` (flat, biome-neutral stepped terrain under an otherwise strong sky/fog presentation).

## Terrain upgrade implementation

- `sampleTerrainColumn()` now composes domain-warped continental land, rolling foothills, folded mountain ridges, dry terraced mesas, and carved riverbeds into one coordinate-only surface query. It resolves one of six biome families: basin, meadow, forest, badlands, alpine, or snow.
- Surface and strata respond to that family: sand in basins and river cuts, grass/dirt in fertile ground, netherrack in mesas, stone and cobble talus in alpine rock, snow caps at elevation, and mossy cobble on forest cliffs. Deep deterministic hashes add sparse coal, iron, and obsidian seams.
- Forests are stamped from a world-space lattice, not chunk-local randomness, so trunks and crowns continue cleanly across chunk borders. A lower-density lattice adds obsidian-rooted crystal spires in alpine/badland terrain.
- The terrain schema is now version 2, intentionally invalidating edits generated against the previous single-height-field world. The default player spawn moved to `(-5.5, 26, -6.5)`, a meadow shelf looking north into the first mountain fold.
- `/tmp/nomio-terrain-spawn.png` visually confirms a playable sand basin, tree-lined meadow, alpine walls, and snowy horizons in the real browser scene.
- `npm run test:terrain` verifies 15 terrain invariants. A 225-chunk regional generation sample completed in 278.3 ms (1.24 ms/chunk) while producing every targeted surface/landmark material.
- Final validation after formatting: typecheck, lint, Prettier, production build, save-system checks, voxel-format benchmark, and terrain suite all pass. The terrain suite measured 1.49 ms/chunk in its final run; the Vite worker bundle is 17.39 kB.
- A fresh live browser capture had no page or console errors and streamed about 4.82 million terrain blocks. The headless rAF probe is deliberately not treated as a hardware performance result: Chrome reports the `SwiftShader Device (Subzero)` software renderer in this environment.

## PWA implementation baseline

- The app currently has a minimal root `index.html`, a minimal `src/main.ts` bootstrap, and no `public/` asset directory or PWA dependencies.
- Vite already supports a root-scoped production build, including GitHub Pages base-path handling; the PWA layer should therefore use root-relative public assets and avoid hard-coded source-module URLs.
- The PWA will cache the built document and same-origin runtime assets on first production launch, serve an offline fallback for navigation, and use a versioned cache for safe updates.
- The final implementation uses `./` manifest and HTML asset URLs plus `import.meta.env.BASE_URL` service-worker registration, so root hosting and GitHub Pages project paths both resolve correctly.
- The 512px icon is an isometric cube with lichen top, mineral-blue left, warm-stone right, deep-ink field, and coral structural lines; the 192px export is used for touch icons and both are declared as `any maskable` in the manifest.
- Final preview verification: manifest 200 with `application/manifest+json`, worker registered and controlling `/`, offline reload 200 with `#app` present, both PNG icons available from cache, and no page errors.

## Monumental terrain baseline

- The current terrain generator has a sound layered structure, but it clamps terrain into a 40-block vertical window (`y=-12..27`), yielding only 24 blocks of validated regional relief.
- The generator, world index, save voxel dimensions, and meshing derive their vertical extent from `CHUNK_MIN_Y` and `CHUNK_HEIGHT`, so expanding that shared definition is the correct way to create genuinely tall terrain without changing the worker contract.
- Existing persistence fingerprints include generator configuration but not terrain dimensions; a terrain schema bump is required when the vertical world shape changes.
- The default forward camera faces north (`-Z`). A deterministic meadow shelf at `(64, -60)` starts around `y=3` and looks toward a 60-block snow range beginning roughly 55 blocks ahead, giving the first view a deliberate monumental composition.

## Monumental terrain implementation

- The vertical chunk window is now `y=-48..63` (112 cells), replacing the former `-12..27` window. This lets the generator use real altitude rather than a visually compressed height range.
- The height field now combines 92-block domain warping, broad continental plates, wide folded ranges, razor escarpments, sparse summit accents, four-octave foothill noise, tall badland shelves, and deep river cuts.
- Biome thresholds have been lifted to match the new scale: alpine terrain begins at `y=25` and snow begins at `y=43`, leaving low basins and meadows visually subordinate to the major ranges.
- Terrain persistence is schema 3, deliberately discarding deltas from the former dimensions and landform shape.
- Final deterministic test sample: `-32..60` height range, 92 blocks of relief, 2.50 ms/chunk across 225 chunks, all landform/material checks passing. Live capture: `/tmp/nomio-monumental-spawn.png`.
