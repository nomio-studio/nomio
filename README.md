# nomio

`nomio` is a small browser-based voxel garden built with Three.js, TypeScript, HTML, and CSS. The MVP is intentionally compact: enter a floating island, walk around it, mine blocks, place new blocks, and reset the world whenever you want a clean canvas.

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
│   ├── config.ts          # Injectable camera, player, input, and render tuning
│   ├── game-session.ts    # Runtime composition, loop, selection, and reset
│   ├── input.ts           # Keyboard, mouse, touch, and virtual controls
│   ├── interactor.ts      # Raycast targeting and break/place actions
│   ├── player.ts          # First-person look, movement, gravity, collision
│   ├── procedural-textures.ts # Deterministic 64×64 tile drawer library
│   ├── texture-atlas.ts   # Shared atlas canvas, UV geometry, and materials
│   ├── texture-types.ts   # Texture recipe and face contracts
│   ├── types.ts           # Shared voxel and game contracts
│   ├── world.ts           # Data-first voxel storage and AABB queries
│   ├── world-generator.ts # Deterministic starter island
│   └── world-renderer.ts  # Three.js block meshes and target highlight
├── ui/
│   ├── game-shell.ts      # Canvas and UI DOM shell
│   └── hud.ts             # HUD, palette, prompt, and touch controls
├── main.ts                # Minimal browser bootstrap
└── style.css              # Responsive field-note interface
```

`NomioApplication` owns the browser entrypoint and creates a disposable `GameSession`. The session composes the scene runtime, world, renderer, player, interactor, input, and HUD. `SceneRuntime` owns Three.js setup and resize handling; event-driven services expose `dispose()` so sessions can be restarted, tested, or replaced without leaking listeners.

`BlockRegistry` is the catalog boundary. The HUD, atlas, renderer, and selection logic consume it instead of importing block order directly, so a session can provide a different catalog/order. `GameSession` also accepts `GameConfig` overrides and a world factory for tuning or test fixtures.

Every block definition declares a palette, seed, pattern, and material properties. The procedural texture registry renders separate 64×64 top, side, and bottom tiles, and `BlockTextureAtlas` packs all tiles into one shared `CanvasTexture`, rewrites cached block UVs, and applies the atlas to Three.js meshes. Register a new drawer with `registerTexturePattern()` and reference it from a block recipe without changing the renderer.

The world currently renders one mesh per block. That keeps the MVP easy to understand and leaves a clear seam for chunk meshing, texture atlases, persistence, or procedural generators in a later iteration.

## Extension seams

- Add block definitions in `src/game/blocks.ts` and expose their order through a `BlockRegistry`.
- Add a texture family with `registerTexturePattern()` in `src/game/procedural-textures.ts`.
- Give a new block a `TextureRecipe`; the atlas automatically creates its side, top, and bottom tiles and UV geometry.
- Swap or compose terrain generators with `GameSessionOptions.worldFactory`.
- Tune movement, camera, interaction, and rendering through `GameConfigOverrides`.
- Replace the per-block renderer in `src/game/world-renderer.ts` with chunk meshing later.

## Git and quality

The repository uses Conventional Commits, Husky, lint-staged, ESLint, Prettier, and strict TypeScript. Changes for the MVP are kept in atomic commits so the gameplay foundation and documentation remain easy to review independently.
