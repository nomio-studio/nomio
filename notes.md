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
