# nomio MVP status

## Delivered

- Three.js scene with an atmospheric floating island generated from data.
- Seventeen block materials with deterministic procedural textures: grass, dirt, stone, cobblestone, sand, oak log, oak planks, leaves, glass, bricks, snow, netherrack, obsidian, coal ore, iron ore, mossy cobblestone, and crystal.
- A shared texture atlas that packs all 51 face tiles into one 512×448 CanvasTexture, with cached per-block materials and nearest-neighbor filtering.
- Face-aware 64×64 procedural tiles with seeded pixel noise, grain, seams, clusters, rings, transparency, and material properties.
- OpenSimplex2S 2D noise with configurable fBm octaves mapped into a deterministic terrain heightmap.
- Asynchronous Web Worker chunk generation with zero-copy transferable `Uint8Array` buffers.
- 16×16×40 chunk storage, stone/dirt/grass layering, neighbor-aware face culling, and greedy meshing into one mesh per chunk.
- First-person pointer-lock controls for desktop.
- Touch look, virtual movement pad, and Mine / Place actions for smaller screens.
- Gravity, jumping, simple voxel-aware player collision, and fall recovery.
- Center-screen raycast targeting with an accent-colored block highlight.
- Break, place, block palette selection, block count, and reset interactions.
- Responsive HUD with keyboard-visible focus states and reduced-motion handling.

## Extension seams

- Add block definitions in `src/game/blocks.ts` and expose their order through a `BlockRegistry`.
- Adjust terrain seed and fBm/heightmap settings through `GameConfigOverrides.terrain`.
- Add a texture family with `registerTexturePattern()` in `src/game/procedural-textures.ts`.
- Give a new block a `TextureRecipe`; the atlas automatically creates its side, top, and bottom tiles and exposes their UV bounds to the mesher.
- Tune movement, camera, interaction, and rendering through `GameConfigOverrides`.
- Tune terrain seed, frequency, octaves, lacunarity, gain, base height, amplitude, and view distance through `GameConfigOverrides.terrain`.
- Add tools or actions through `GameAction` and `VoxelInteractor`.
- Persist or synchronize world data from the `VoxelWorld` API without changing the HUD.

## Verification

The current implementation passes:

- `npm run typecheck`
- `npm run lint`
- `npm run format:check`
- `npm run build`

The local Vite server also served the updated game entrypoint successfully during the final smoke check.
