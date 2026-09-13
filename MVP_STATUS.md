# nomio MVP status

## Delivered

- Three.js scene with an atmospheric floating island generated from data.
- A dynamic sky dome with a configurable day/night cycle: day/night gradients, warm sunrise/sunset glow, a sun disk and halo, drifting clouds, and twinkling stars, with matching sun, hemisphere light, and fog colors.
- Smooth lighting and vertex ambient occlusion: propagated sky and block light plus four-level corner AO baked into a per-vertex `aLight` attribute and applied to indirect light, with crystal emitting light, all eight neighbor chunks relit on load/unload, and soft `normalBias` shadows.
- Temporal anti-aliasing (`render-pipeline.ts`): the scene renders to a linear HDR target from a Halton-jittered camera, a temporal pass reprojects and variance-clips the history in YCoCg, and a composite pass sharpens and applies tone mapping/sRGB. Ghosting is bounded by variance clipping and motion-adaptive blending, temporal softness is countered by a clamped unsharp mask, and history resets on teleport, reset, time jumps, and edits. Tone mapping and grading are deferred to the composite; the direct path remains as a fallback.
- A layered atmosphere (`fog.ts`): exponential distance fog with a height term that pools mist in valleys, slowly drifting world-space mist banks, warm sun inscattering that peaks along the horizon at dawn and dusk, and gradient dithering. Fog color is driven by the same sky palette as the dome and lights, injected into the terrain materials in linear space, and tunable or disabled through `GameConfig.fog`.
- Voxel global illumination: `chunk-lighting.ts` propagates colored emissive light from each glowing block and performs one colored bounce pass where surfaces reflect received skylight and emissive light tinted by their own albedo. The result is packed as a per-vertex `aIndirect` RGB attribute, so grass bleeds green, sand warms, and crystals spread cyan. `GlobalIllumination` tints the bounce by the sky ambient at runtime, and it is tunable or disabled through `GameConfig.lighting`.
- Lighting optimizations: a reused typed-array light queue instead of `number[]`, emissive and bounce floods that are skipped when there is nothing to propagate, an early-out for fully solid volumes, and the bounce stored at 4 bits per channel with a gain so albedo color survives quantization.
- A complete tone-mapping and color-grading stage (`color-grade.ts`) in the composite: luminance-normalized Kelvin white balance and exposure in linear, a selectable **AgX** or **ACES** tone-mapping curve, then a display-referred grade of pivot contrast, luminance-preserving saturation, vibrance, highlight recovery, shadow lift, and vignette, finished with a dither. The grade is tunable at runtime and exposed in the settings panel with live sliders and persistence.
- Seventeen block materials with deterministic procedural textures: grass, dirt, stone, cobblestone, sand, oak log, oak planks, leaves, glass, bricks, snow, netherrack, obsidian, coal ore, iron ore, mossy cobblestone, and crystal.
- A shared texture atlas that packs all 51 face tiles into one padded 544×476 CanvasTexture with mipmaps and anisotropic nearest-neighbor filtering, plus cached per-block materials.
- Face-aware 64×64 procedural tiles with seeded pixel noise, grain, seams, clusters, rings, transparency, and material properties.
- OpenSimplex2S 2D noise with configurable fBm octaves mapped into a deterministic terrain heightmap.
- Asynchronous chunk generation and greedy meshing in a module Web Worker pool sized from the device's hardware concurrency.
- A 16×16×40 chunk storage format, stone/dirt/grass layering, neighbor-aware face culling, and greedy meshing into transferable quad buffers.
- Incremental chunk updates driven by `VoxelWorld` dirty flags, so an edit only re-meshes the affected chunk and its neighbors.
- Draw-call batching: blocks with identical surface parameters share material slots (17 block types collapse to 4 materials), alongside the padded, mipmapped texture atlas.
- An endless streaming world at a 16-chunk view distance: chunks load in a circular window around the player, unload beyond it, and rebuild their loaded neighbors at the seams.
- GPU mesh uploads are time-budgeted per frame and prioritized nearest-first so the large view distance stays responsive.
- Frustum culling per chunk mesh, distance culling through streaming unload, and fog/camera-far that scale with the view distance.
- Shadow maps refresh on demand and only nearby chunks cast shadows.
- Persistent player edits: modified chunks are snapshotted in memory when the player leaves and returns, and durably saved through the **Nomio Voxel Storage Format (NSVF)**.
- A self-designed voxel storage format (`voxel-format.ts`): every 16×16×40 chunk is encoded independently by the smallest of seven voxel-aware codecs (`constant`, palette bitpack, RLE, column dictionary, surface profile, sparse baseline delta, and canonical Huffman), tagged with one byte. Chunks group into 32×32-chunk regions (magic `NVRG`) with block/generator fingerprints and a per-chunk CRC32 directory, and regions group into one seekable archive (magic `NSVF`).
- Delta persistence (`voxel-store.ts`): only edited chunks are stored, as sparse deltas against the deterministic terrain generator, so untouched world costs zero bytes and saves are a few hundred bytes. A path-based `StorageDriver` seam (`storage.ts`) provides OPFS (default), `localStorage`, and in-memory backends; saves are debounced 600 ms, restored before streaming begins, fingerprinted so stale saves are discarded after a generator change, and cleared on reset.
- Multiple worlds and multiple save files (`save-system.ts`): a world owns a terrain definition and any number of named saves, catalogued as JSON over the storage driver (`catalog.json`, `maps/<id>/saves.json`, `maps/<id>/saves/<id>/regions/*.nvrg`). The in-game **worlds library** (`ui/library.ts`) creates, renames, duplicates, deletes, and opens worlds and saves, and shows each save's edit count and timestamp; the active save and its world are protected from deletion while playing. `NomioApplication` owns the persistent UI and storage and swaps the `GameSession` (and therefore the terrain and save root) when the player opens another save.
- First-person pointer-lock controls for desktop.
- Touch support: a floating analog movement stick, drag-to-look with per-pointer tracking, tap-to-place and hold-to-mine canvas gestures with crack and debris feedback, and a Jump button, enabled automatically on touch devices and laid out around safe-area insets. The center reticle is hidden on touch.
- Gravity, jumping, automatic one-block step hops, simple voxel-aware player collision, and fall recovery.
- Center-screen raycast targeting with an accent-colored block highlight.
- Break, place, block palette selection, block count, and reset interactions.
- A complete UI state machine (`loading → title → playing ↔ paused`) in `src/ui/ui.ts`, with a boot screen showing terrain progress, a title screen, an in-game HUD, native `<dialog>` pause / settings / reset-confirm surfaces, a worlds/saves library, and transient toasts for mining, placing, fall recovery, and reset.
- Persisted, live-applied settings for look sensitivity, touch sensitivity, field of view, invert look, control hints, and reduced motion, with a restore-defaults action.
- Keyboard-complete controls: focus moves into dialogs and returns on close, the hotbar is a toolbar with a roving tabindex and arrow-key navigation, every control has an accessible name, and game feedback is announced through a polite live region.
- A token-based palette in CSS custom properties (shared with Three.js through `src/ui/tokens.ts`), concentric surfaces, layered shadows, `scale(0.96)` press feedback, tabular numerals, and `prefers-reduced-motion` / `-transparency` / `-contrast` handling.

## Extension seams

- Add block definitions in `src/game/blocks.ts` and expose their order through a `BlockRegistry`.
- Adjust terrain seed and fBm/heightmap settings through `GameConfigOverrides.terrain`.
- Add a texture family with `registerTexturePattern()` in `src/game/procedural-textures.ts`.
- Give a new block a `TextureRecipe`; the atlas automatically creates its side, top, and bottom tiles and exposes their UV bounds to the mesher.
- Tune movement, camera, interaction, and rendering through `GameConfigOverrides`.
- Tune the day/night cycle through `GameConfigOverrides.sky`, or extend `DynamicSky` for weather and sky events.
- Tune terrain seed, frequency, octaves, lacunarity, gain, base height, amplitude, and view distance through `GameConfigOverrides.terrain`.
- Tune streaming concurrency, the unload hysteresis band, ready radius, and mesh upload budget through `ChunkStreamerOptions` and `RenderConfig`.
- Tune the shadow-casting band and mesh budget through `RenderConfig`.
- Add tools or actions through `GameAction` and `VoxelInteractor`.
- Swap or add a persistence backend by implementing the `StorageDriver` interface in `src/game/storage.ts`, or stream NSVF archives to a server, without changing the codec, the save catalog, or the HUD.

## Verification

The current implementation passes:

- `npm run typecheck`
- `npm run lint`
- `npm run format:check`
- `npm run build`
- `npm run bench:voxel-format`
- `npm run test:saves`

The voxel format benchmark round-trips every codec plus the region and archive containers (negative coordinates and CRC corruption included) and beats `node:zlib` gzip on structured voxel data (about 1.98× smaller) and edited-world saves (about 47× smaller: 529 B vs 24,883 B); only adversarial random noise is roughly on par and is reported separately. The save-system test runs the catalog and per-save persistence on an in-memory driver and passes 24 checks (multiple worlds and saves, duplication, deletion, round-trip, fingerprint invalidation, and clear).

The local Vite server also served the updated game entrypoint successfully during the final smoke check. Browser suites cover the terrain/streaming pipeline (30 checks), the sky shader (5 checks), the UI flow (24 checks: boot → title → play → pause → settings → reset-confirm → quit, roving-tabindex hotbar, focus placement, persisted settings, reduced motion, and a 320px no-overflow check), the antialiasing pipeline (10 checks: deferred tone mapping, jitter/accumulation, non-TAA determinism, diagonal-edge resolve, narrow transition band, sharpen contrast, and camera motion), the atmosphere (7 checks: near-field clarity, far-field color shift, height mist, sun inscattering, and palette-driven color), and global illumination (10 checks: green grass bounce, cyan crystal bleed, disabled GI producing zero indirect, a solid volume doing no work, and the renderer's per-vertex indirect attribute), and the tone-mapping/color-grading stage (8 checks: exposure, contrast, saturation, white balance, distinct AgX/ACES highlight rolloff, a monotonic AgX curve, and vignette). A static token audit confirms every text pair meets WCAG AA (≥4.5:1) over both the ink scene and the brightest terrain. On a captured game frame, TAA reduced hard-edged (aliased) pixels from 0.60% to 0.24% of the frame while keeping edge transitions within two pixels, and captured atmosphere frames show the sunset horizon at rgb(219,190,129) against near terrain at rgb(39,41,43) and a deep-blue rgb(1,6,13) night sky.
