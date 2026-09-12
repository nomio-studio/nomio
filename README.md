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
```

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
- Mobile: drag the world to look, use the directional pad to move, and use Mine / Place buttons

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
│   ├── input.ts           # Keyboard, mouse, touch, and virtual controls
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
│   ├── types.ts           # Shared voxel and game contracts
│   ├── world.ts           # Chunked Uint8Array storage and AABB queries
│   └── world-renderer.ts  # Incremental chunk meshes and target highlight
├── ui/
│   ├── dialogs.ts         # Pause, settings, and reset-confirm modals
│   ├── dom.ts             # Small DOM, formatting, and tab-order helpers
│   ├── game-shell.ts      # Canvas and UI DOM shell
│   ├── hud.ts             # In-game HUD, palette, and touch controls
│   ├── screens.ts         # Loading and title screens
│   ├── settings.ts        # Persisted UI settings and normalization
│   ├── toasts.ts          # Transient action feedback
│   ├── tokens.ts          # Shared palette/three.js color tokens
│   └── ui.ts              # Screen state machine and UI composition
├── main.ts                # Minimal browser bootstrap
└── style.css              # Responsive field-note interface
```

`NomioApplication` owns the browser entrypoint and creates a disposable `GameSession`. The session composes the scene runtime, world, renderer, player, interactor, input, and HUD. `SceneRuntime` owns Three.js setup and resize handling; event-driven services expose `dispose()` so sessions can be restarted, tested, or replaced without leaking listeners.

`BlockRegistry` is the catalog boundary. The HUD, atlas, renderer, and selection logic consume it instead of importing block order directly, so a session can provide a different catalog/order. `GameSession` accepts `GameConfig` overrides, including terrain seed and fBm settings.

Every block definition declares a palette, seed, pattern, and material properties. The procedural texture registry renders separate 64×64 top, side, and bottom tiles, and `BlockTextureAtlas` packs all tiles into one shared `CanvasTexture`, exposes face UVs, and supplies shared Three.js materials to greedy chunk meshes. Register a new drawer with `registerTexturePattern()` and reference it from a block recipe without changing the renderer.

The world sits under a dynamic sky. `SceneRuntime` advances a configurable day/night cycle, and `DynamicSky` renders an inverted sphere with a shader gradient: day and night zenith colors, a warm sunrise/sunset glow around the sun, a sun disk and halo, drifting noise clouds, and twinkling stars after dusk. `SkyPalette` derives every color from the sun's elevation, so the sky dome, directional sun light, hemisphere light, and fog color always agree. The sun light tracks the cycle around the player, and the shadow map refreshes only a few times per second to keep the moving sun cheap.

Chunks are shaded with smooth lighting and vertex ambient occlusion. Before a chunk is meshed, `chunk-lighting.ts` copies it plus its eight horizontal neighbors into a padded volume and propagates sky light (from vertically exposed cells) and emitted block light (`lightEmission`, e.g. crystal) through air with one level lost per step. The greedy mesher samples the three blocks around every face corner for the classic four-level AO term and averages nearby light levels, then merges cells only when their block type, AO, and light all match. `VoxelWorldRenderer` bakes the result into a per-vertex `aLight` attribute (AO and light), which a small standard-material patch multiplies into the **indirect** lighting only — direct sun keeps its full strength, so recesses become soft contact shadows instead of pitch black. Block edits flag their chunk dirty and relight the surrounding 3×3 chunk neighborhood, and every chunk load/unload re-meshes all eight neighbors so AO/light never seams across chunk borders.

The interface has its own state machine (`src/ui/ui.ts`) with four states — loading, title, playing, and paused — that drives which screen is visible and keeps the gameplay layer free of DOM code. `GameSession` talks to `GameUi`, which composes the loading screen, title, HUD, native `<dialog>` pause/settings/reset surfaces, and a polite toast region. Settings (look sensitivity, field of view, invert look, control hints, reduced motion) are normalized, persisted to `localStorage`, and applied live; every command has a keyboard path, focus moves into dialogs and returns on close, the hotbar uses a roving tabindex, and game feedback appears as transient toasts. The stylesheet declares the palette as custom properties and honors `prefers-reduced-motion`, `prefers-reduced-transparency`, and `prefers-contrast`.

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
- Add a screen or dialog by extending the `UiState` union in `src/ui/ui.ts` and composing a component in `src/ui/screens.ts` or `src/ui/dialogs.ts`.
- Add a user setting to `src/ui/settings.ts`; the settings panel renders the label/value/control and persistence is automatic.
- Persist `VoxelWorld` edited chunks to storage or a server instead of keeping them in memory.

## Git and quality

The repository uses Conventional Commits, Husky, lint-staged, ESLint, Prettier, and strict TypeScript. Changes for the MVP are kept in atomic commits so the gameplay foundation and documentation remain easy to review independently.
