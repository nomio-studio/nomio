# Notes: nomio maintainability refactor

## Baseline

- The repository contains a playable floating-island voxel MVP with a data-first `VoxelWorld`.
- Three.js `0.186.0`, Vite `8.3.0`, strict TypeScript, ESLint, Prettier, Husky, and commitlint are already configured.
- `main.ts` should remain a minimal browser bootstrap; `NomioApplication` owns the app lifecycle and `GameSession` owns runtime composition.
- `BlockTextureAtlas` already provides a good renderer seam but is constructed from global block definitions.
- `InputManager` and `Hud` attach browser listeners but do not expose disposal methods.
- `PlayerController` consumes grouped `PlayerConfig` values and exposes its collision bounds to interaction systems.
- `VoxelWorld` is data-first but exposes a static player-bounds helper, mixing world storage with player collision details.

## Refactor direction

- `NomioApplication` should own the browser lifecycle and expose `start()` / `dispose()`.
- `GameSession` should compose world, renderer, player, interactor, HUD, input, and timer without leaking composition into `main.ts`.
- `SceneRuntime` should own renderer/camera/lights and resize behavior.
- `BlockRegistry` should be the single source for definitions and order; HUD, atlas, and selection should depend on it.
- `GameConfig` should group camera, player, interaction, and rendering tuning with defaults.
- Each event-driven service should use an `AbortController` or explicit listener cleanup.

## Refactor delivered

- Added `NomioApplication`, `GameSession`, `SceneRuntime`, `GameShell`, `GameConfig`, and `BlockRegistry` boundaries.
- Added injectable world factories and configuration overrides for fixtures, alternate generators, and tuning.
- Added `VoxelWorld.replace()` / `toArray()` and moved player AABB ownership into `PlayerController`.
- Added deterministic cleanup for input, HUD, timer, renderer, atlas, and resize listeners.
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
