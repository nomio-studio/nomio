# nomio

`nomio` is a small browser-based voxel garden built with Three.js, TypeScript, HTML, and CSS. The MVP is intentionally compact: step into an endless island, walk in any direction while the world streams around you, mine blocks, place new blocks, and reset the world whenever you want a clean canvas.

## Run it

```bash
npm install
npm run dev
```

Then open the local Vite URL shown in the terminal.

Production checks and build:

```bash
npm run typecheck
npm run lint
npm run format:check
npm run build
npm run bench:voxel-format
npm run test:saves
```

`bench:voxel-format` round-trips every codec and compares NSVF against `node:zlib` gzip on representative terrain, edits, caves, and noise. `test:saves` drives the `SaveSystem` and per-save `WorldPersistence` on an in-memory driver to verify multiple worlds, multiple save slots, duplication, deletion, round-tripping, fingerprint invalidation, and clearing.

## Controls

- `WASD` or arrow keys: move
- Mouse: look around after selecting “Enter the island”
- `Space`: hop
- Left mouse button: mine the highlighted block
- Right mouse button: place the selected block on the highlighted face
- `1`–`0`, `-`, `=`: select the first twelve materials
- `[` / `]`: cycle through all materials
- `Esc`: pause (Resume, Settings, Reset, Return to title)
- Click a material swatch in the palette to select any block
- Touch: a floating analog stick moves, dragging elsewhere looks, and the Mine / Place / Jump buttons act on the aimed block; tap a material to select it

## Architecture

The game is split into small modules so the world model can evolve independently from the presentation and controls:

```text
src/
├── app/
│   └── application.ts     # Browser lifecycle and composition entrypoint
├── game/
│   ├── block-registry.ts  # Injectable block definitions and ordering
│   ├── blocks.ts          # Default block catalog
│   ├── chunk-lighting.ts  # Padded sky/block light propagation for meshing
│   ├── chunk-mesher.ts    # Pure greedy meshing into transferable buffers
│   ├── chunk-streamer.ts  # Loads/unloads chunks around the player
│   ├── chunk-types.ts     # Chunk dimensions and transfer contracts
│   ├── color-grade.ts     # Tone mapping + grading uniforms and white balance
│   ├── config.ts          # Injectable camera, player, input, and render tuning
│   ├── dynamic-sky.ts     # Animated sky dome shader and day/night palette
│   ├── fog.ts             # Height + inscattering atmosphere uniforms
│   ├── game-session.ts    # Runtime composition, loop, selection, and reset
│   ├── global-illumination.ts # Sky-driven tint for the baked indirect bounce
│   ├── input.ts           # Keyboard, mouse, and pointer/touch look and movement
│   ├── interactor.ts      # Raycast targeting and break/place actions
│   ├── greedy-mesher.ts   # Face-culling greedy quad generation
│   ├── open-simplex2.ts   # Dependency-free 2D OpenSimplex2 noise
│   ├── player.ts          # First-person look, movement, gravity, collision
│   ├── procedural-textures.ts # Deterministic 64×64 tile drawer library
│   ├── render-pipeline.ts # TAA resolve, variance clamp, sharpening, tone map
│   ├── texture-atlas.ts   # Shared atlas canvas, UV tiles, and materials
│   ├── texture-types.ts   # Texture recipe and face contracts
│   ├── terrain-config.ts   # Seed, fBm, and heightmap tuning
│   ├── terrain-generation.ts # Pure chunk heightmap and block layering
│   ├── terrain-generation.worker.ts # Worker-side generation and meshing
│   ├── terrain-worker.ts   # Pool of worker clients for generation and meshing
│   ├── save-system.ts     # World (map) and save-slot catalog over storage
│   ├── storage.ts         # Path-based OPFS/localStorage/memory drivers
│   ├── types.ts           # Shared voxel and game contracts
│   ├── voxel-format.ts    # NSVF chunk codecs, region and archive containers
│   ├── voxel-store.ts     # Debounced per-save world persistence
│   ├── world.ts           # Chunked Uint8Array storage and AABB queries
│   └── world-renderer.ts  # Incremental chunk meshes and target highlight
├── ui/
│   ├── dialogs.ts         # Pause, settings, and reset-confirm modals
│   ├── dom.ts             # Small DOM, formatting, and tab-order helpers
│   ├── game-shell.ts      # Canvas and UI DOM shell
│   ├── hud.ts             # In-game HUD, palette, and touch controls
│   ├── library.ts         # Worlds/saves library dialog
│   ├── screens.ts         # Loading and title screens
│   ├── settings.ts        # Persisted UI settings and normalization
│   ├── toasts.ts          # Transient action feedback
│   ├── tokens.ts          # Shared palette/three.js color tokens
│   ├── touch-controls.ts  # Analog stick and Mine / Place / Jump buttons
│   └── ui.ts              # Screen state machine and UI composition
├── main.ts                # Minimal browser bootstrap
└── style.css              # Responsive field-note interface
```

`NomioApplication` owns the browser entrypoint, the persistent UI, and the storage driver. It resolves a world (map) and save slot through `SaveSystem`, then creates a disposable `GameSession` for that save and swaps it when the player opens another one. The session composes the scene runtime, world, renderer, player, interactor, input, and HUD. `SceneRuntime` owns Three.js setup and resize handling; event-driven services expose `dispose()` so sessions can be restarted, tested, or replaced without leaking listeners.

`BlockRegistry` is the catalog boundary. The HUD, atlas, renderer, and selection logic consume it instead of importing block order directly, so a session can provide a different catalog/order. `GameSession` accepts `GameConfig` overrides, including terrain seed and fBm settings.

Every block definition declares a palette, seed, pattern, and material properties. The procedural texture registry renders separate 64×64 top, side, and bottom tiles, and `BlockTextureAtlas` packs all tiles into one shared `CanvasTexture`, exposes face UVs, and supplies shared Three.js materials to greedy chunk meshes. Register a new drawer with `registerTexturePattern()` and reference it from a block recipe without changing the renderer.

The world sits under a dynamic sky. `SceneRuntime` advances a configurable day/night cycle, and `DynamicSky` renders an inverted sphere with a shader gradient: day and night zenith colors, a warm sunrise/sunset glow around the sun, a sun disk and halo, drifting noise clouds, and twinkling stars after dusk. `SkyPalette` derives every color from the sun's elevation, so the sky dome, directional sun light, hemisphere light, and fog color always agree. The sun light tracks the cycle around the player, and the shadow map refreshes only a few times per second to keep the moving sun cheap.

Player edits are durable through the **Nomio Voxel Storage Format (NSVF)**, a purpose-built, dependency-free format in `src/game/voxel-format.ts`. Every 16×16×40 chunk is encoded independently by trying a family of voxel-aware codecs and keeping the smallest; a one-byte tag selects the codec on decode. The codecs are `constant`, palette `bitpack`, `RLE`, `column-dict` (deduplicated vertical columns), `surface-profile` (a shared layer profile plus one surface height per column), `sparse` (only cells that differ from a baseline), and canonical `Huffman`. Chunks group into 32×32 regions (magic `NVRG`) that carry block/generator fingerprints and a per-chunk CRC32 directory for random access and corruption detection, and regions group into a single seekable archive (magic `NSVF`).

Storage is layered so the codec never touches a browser API. `src/game/storage.ts` exposes a path-based `StorageDriver` (`read`/`write`/`delete`/`list`/`removeDirectory`) with `OpfsStorageDriver` (default), `LocalStorageStorageDriver`, and `MemoryStorageDriver`; `createDefaultStorageDriver()` picks the most durable available, requiring a secure context for OPFS. On top of it, `src/game/save-system.ts` defines the library model: a **world (map)** owns a terrain definition (seed and shape) and any number of **save slots**, stored as `catalog.json`, `maps/<mapId>/saves.json`, and `maps/<mapId>/saves/<saveId>/regions/<x>,<z>.nvrg`. `src/game/voxel-store.ts` then wires `WorldPersistence` to a single save root, storing edited chunks as `sparse` deltas against the deterministic terrain generator so untouched world costs nothing and a save is typically a few hundred bytes. The block catalog and terrain parameters are fingerprinted, so a stale save is discarded after a generator change; saves are debounced (600 ms), restored before streaming begins, and cleared on reset. `SaveSystem` also updates each save's edit count and timestamp after an autosave, which the library shows.

Chunks are shaded with smooth lighting and vertex ambient occlusion. Before a chunk is meshed, `chunk-lighting.ts` copies it plus its eight horizontal neighbors into a padded volume and propagates sky light (from vertically exposed cells) and emitted block light (`lightEmission`, e.g. crystal) through air with one level lost per step. The greedy mesher samples the three blocks around every face corner for the classic four-level AO term and averages nearby light levels, then merges cells only when their block type, AO, and light all match. `VoxelWorldRenderer` bakes the result into a per-vertex `aLight` attribute (AO and light), which a small standard-material patch multiplies into the **indirect** lighting only — direct sun keeps its full strength, so recesses become soft contact shadows instead of pitch black. Block edits flag their chunk dirty and relight the surrounding 3×3 chunk neighborhood, and every chunk load/unload re-meshes all eight neighbors so AO/light never seams across chunk borders.

The interface has its own state machine (`src/ui/ui.ts`) with four states — loading, title, playing, and paused — that drives which screen is visible and keeps the gameplay layer free of DOM code. An application-owned `GameUi` composes the loading screen, title, HUD, native `<dialog>` pause/settings/reset surfaces, a polite toast region, and the **worlds/saves library** (`src/ui/library.ts`), from which the player creates, renames, duplicates, deletes, and opens worlds and saves. `GameSession` posts state to `GameUi` and subscribes to it but never owns it, which lets the application swap sessions without rebuilding the interface. Settings (look sensitivity, touch sensitivity, field of view, invert look, control hints, reduced motion) are normalized, persisted to `localStorage`, and applied live; every command has a keyboard path, focus moves into dialogs and returns on close, the hotbar uses a roving tabindex, and game feedback appears as transient toasts. The stylesheet declares the palette as custom properties and honors `prefers-reduced-motion`, `prefers-reduced-transparency`, and `prefers-contrast`.

Touch devices are detected from `navigator.maxTouchPoints` (falling back to the coarse-pointer query) and the UI is marked `is-touch`, which reveals `src/ui/touch-controls.ts` instead of the keyboard hints. Movement is a floating analog stick: touching anywhere in the left zone drops the base under the thumb and emits a dead-zoned, magnitude-preserving vector, so a half-push walks slowly. `InputManager` tracks the first non-mouse pointer on the canvas by id for look, scaled by a separate touch sensitivity, while any number of other pointers drive the stick and buttons, so both thumbs work at once. Mine and Place fire on press and repeat while held, Jump is a single action, every pointer has `touch-action: none` and pointer capture, and blur, `visibilitychange`, and `pointercancel` all release inputs so a dropped finger can never leave the player walking. The layout respects `env(safe-area-inset-*)` for notches and home indicators, and pointer lock is skipped entirely on touch.

Anti-aliasing runs through `RenderPipeline`. The scene renders into a linear HDR target from a camera jittered by a Halton(2,3) sequence; a temporal pass reprojects the previous resolved frame using depth and the camera matrices, variance-clips the history in YCoCg to remove ghosting without smearing, and scales the history weight down as motion grows. A final composite applies a clamped unsharp mask (to counter temporal softness), exposure, tone mapping, and the sRGB encode. Sky pixels are reprojected as directions so the rotating skybox does not smear. History resets on teleport, world reset, time-of-day jumps, and player edits. Tone mapping moved out of the materials and into the composite, so the scene pass stays in linear HDR; when the pipeline is disabled or WebGL2 is unavailable, rendering falls back to the direct tone-mapped path.

The composite is also the tone-mapping and color-grading stage. `src/game/color-grade.ts` owns the uniforms: white balance and exposure are applied in linear (white balance derived from a Kelvin blackbody fit, luminance-normalized so a neutral grade does not change exposure), then **AgX** or **ACES** tone mapping, then a display-referred grade of pivot contrast, luminance-preserving saturation, vibrance, highlight recovery, shadow lift, and a vignette, finished with a dither before the sRGB encode. `ColorGrade` also drives the fallback path's `renderer.toneMapping`, and the whole grade is tunable at runtime and through the settings panel.

The atmosphere is a custom analytic fog (`src/game/fog.ts`) injected into the terrain materials after the opaque fragment, so it runs in linear space before tone mapping in both the TAA and fallback paths. Distance fog follows an exponential falloff from `fog.start`, modulated by a height term that pools mist in low ground and thins it with altitude, and broken up by slowly drifting world-space mist banks. It adds warm sun inscattering toward the sun (strongest along the horizon at dawn and dusk) and is dithered to keep wide gradients from banding; the composite adds a matching dither for the sky. `FogController` drives its shared uniforms from the same `SkyPalette` as the dome and lights, so fog color always matches the horizon, and it is disabled cleanly through `GameConfig.fog.enabled`.

Global illumination is baked in the workers alongside the smooth lighting. `chunk-lighting.ts` propagates colored emissive light (each glowing block carries an `emissionColor`) and then performs one bounce: every surface reflects the skylight and emissive light it receives back into the air, tinted by its own albedo, and that colored light floods through the world. The result is packed as a per-vertex `aIndirect` RGB attribute, so sunlit grass bleeds green onto nearby walls, sand warms the air around it, and crystals spread a cold cyan glow. `GlobalIllumination` tints that indirect term by the sky ambient at runtime, giving the bounce a day/night rhythm, and the whole feature is governed by `GameConfig.lighting`. The passes are optimized with a reused typed-array light queue, and the emissive and bounce floods are skipped when there is nothing to propagate; a fully solid volume does no work.

## Configuration

`GameConfig.sky` controls the cycle: `enabled` toggles the animated sky, `cycleDuration` is the length of a full day in seconds, and `startTime` is the starting fraction of the day (0 midnight, 0.25 sunrise, 0.5 noon, 0.75 sunset).

`GameConfig.antialiasing` controls the temporal pipeline: `enabled` toggles temporal accumulation and deferred tone mapping, `historyBlend` (0–0.95) trades smoothness for responsiveness, and `sharpen` (0–1) counters temporal softness.

`GameConfig.fog` controls the atmosphere: `density` and `start` set the distance falloff, `height` and `heightFalloff` set where ground mist pools, `sunStrength` and `sunSharpness` set the inscattering glow, and `mistStrength` and `mistScale` set the drifting mist banks.

`GameConfig.lighting` controls global illumination: `globalIllumination` toggles the one-bounce pass, `bounceStrength` sets how much light surfaces reflect, and `skyBounce` sets how much skylight participates.

`GameConfig.grading` controls tone mapping and color grading: `toneMapping` selects `agx` or `aces`, `exposure` is in stops, `temperature` is white balance in Kelvin, and `contrast`, `saturation`, `vibrance`, `highlights`, `shadows`, and `vignette` shape the final image. `SceneRuntime.setGrading()` applies partial changes at runtime, which is how the settings sliders drive it.

Terrain is generated in 16×16×40 chunks and is effectively endless, with a default view distance of 16 chunks. `ChunkStreamer` watches the player's chunk, requests missing chunks nearest-first inside a circular window, and unloads chunks beyond the view distance with a one-chunk hysteresis band so walking back and forth does not thrash. `TerrainWorker` is a pool of module Web Workers: it both generates chunks and runs greedy meshing off the main thread, returning transferable `Uint8Array` blocks and compact quad buffers. `ChunkStreamer` uploads those meshes to the GPU under a per-frame time budget (nearest chunks first) so a large view distance never blocks a frame. When a chunk arrives or leaves, its mesh and its loaded neighbors' meshes are rebuilt so greedy border faces stay correct. Player edits mark their chunk dirty in `VoxelWorld`; the streamer drains those flags, re-meshes the chunk and its neighbors, and snapshots the edit so a modified chunk is restored from memory instead of being regenerated when the player returns. The renderer keeps one greedy-meshed Three.js geometry per loaded chunk, culls solid-neighbor faces, groups quads by material slot, and only lets nearby chunks cast shadows while the shadow map is refreshed on demand.

## Performance notes

- **Face culling + greedy meshing**: `greedy-mesher.ts` drops solid-neighbor faces and merges coplanar same-material faces into maximal quads.
- **Chunking + dirty flags + incremental updates**: the world is chunked, edits flag dirty chunks which are re-meshed incrementally, and the renderer applies, replaces, and removes a single chunk mesh at a time.
- **Multithreaded async mesh generation**: a worker pool sized from `navigator.hardwareConcurrency` generates chunks and runs greedy meshing off the main thread.
- **Texture atlas + batching**: the padded, mipmapped atlas shares one texture, and blocks with identical surface parameters share a material slot. The 17 block types collapse to 4 material slots, so a typical terrain chunk draws in one material group instead of three or more.
- **Frustum + distance culling + fog**: each chunk mesh has its own bounding sphere and is frustum-culled by Three.js; chunks past the streaming distance are unloaded (distance culling), and camera far plane plus fog scale with `terrain.viewDistance` so the boundary stays hidden.
- **Smooth lighting + vertex AO**: light propagation and AO are computed in the worker and baked into one per-vertex `aLight` attribute; a material patch applies it to indirect light only, so greedy merges still collapse flat regions and direct sun never crushes shadows to black.
- **Shadow quality**: the sun shadow uses a 2048² map over a tight ±40 frustum with `normalBias` and soft PCF, and the sun follows the player in small timed steps so shadows neither shimmer nor leak around block edges.
- **Voxel-aware persistence**: NSVF picks the smallest per-chunk codec and stores saves as generator-relative deltas, so structured terrain chunks are about 2× smaller than gzip and an edited-world save is about 47× smaller.
- The streamed window is circular, cutting roughly 27% of the chunks a square window would load at the same radius.
- Chunk meshes are uploaded under `render.meshBudgetMs` per frame, nearest-first, so frame time stays bounded while the world fills in.
- Shadow maps use `autoUpdate = false` and refresh only when geometry changes or the shadow focus moves; only chunks within `render.shadowChunkRadius` cast shadows.

## Extension seams

- Add block definitions in `src/game/blocks.ts` and expose their order through a `BlockRegistry`.
- Add a texture family with `registerTexturePattern()` in `src/game/procedural-textures.ts`.
- Give a new block a `TextureRecipe`; the atlas automatically creates its side, top, and bottom tiles and exposes their UV bounds to the mesher.
- Tune movement, camera, interaction, and rendering through `GameConfigOverrides`.
- Tune terrain seed, frequency, octaves, lacunarity, gain, base height, amplitude, and view distance through `GameConfigOverrides.terrain`.
- Tune the day/night cycle through `GameConfigOverrides.sky`; extend `DynamicSky` uniforms for weather, moon phases, or a custom palette.
- Tune temporal antialiasing through `GameConfigOverrides.antialiasing`; extend `render-pipeline.ts` with object motion vectors to cover animated geometry.
- Tune the atmosphere through `GameConfigOverrides.fog`; `FogController` uniforms can drive weather, volumetric light shafts, or biome-specific haze.
- Tune global illumination through `GameConfigOverrides.lighting`; extend `chunk-lighting.ts` with additional bounces or a per-block albedo texture for richer color bleeding.
- Tune the grade through `GameConfigOverrides.grading` or `SceneRuntime.setGrading()`; add filmic stages (lift/gamma/gain, split toning, LUTs) in the composite's `applyGrade`.
- Tune streaming concurrency and the unload hysteresis band through `ChunkStreamerOptions`.
- Add a screen or dialog by extending the `UiState` union in `src/ui/ui.ts` and composing a component in `src/ui/screens.ts`, `src/ui/dialogs.ts`, or `src/ui/library.ts`.
- Add a user setting to `src/ui/settings.ts`; the settings panel renders the label/value/control and persistence is automatic.
- Back the save system with a different `StorageDriver` (or stream NSVF archives to a server) by implementing `read`/`write`/`delete`/`list`/`removeDirectory` in `src/game/storage.ts`; the format is self-describing and fingerprinted, so new storage layers do not touch the codec, the save catalog, or the UI.

## Git and quality

The repository uses Conventional Commits, Husky, lint-staged, ESLint, Prettier, and strict TypeScript. Changes for the MVP are kept in atomic commits so the gameplay foundation and documentation remain easy to review independently.

## License

Licensed under the GNU Affero General Public License, version 3 or later (`AGPL-3.0-or-later`). See [LICENSE](LICENSE) for the full text.
