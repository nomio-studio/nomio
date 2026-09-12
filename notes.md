# Notes: nomio voxel game MVP

## Current state

- The repository is a clean Vite + TypeScript + Three.js starter with one rotating `MeshNormalMaterial` cube.
- Three.js `0.186.0`, Vite `8.3.0`, strict TypeScript, ESLint, Prettier, Husky, and commitlint are already configured.
- No tests or gameplay modules exist yet.

## MVP shape

- A compact floating-island sandbox gives the player an immediate place to move and edit.
- Core loop: enter the scene, walk and look, select a block type, remove a targeted block, place a block on an adjacent face, and reset the island.
- Block palette: grass, stone, and crystal, each represented by a generated color material so the project has no asset pipeline dependency.
- HUD: title/status, crosshair, block palette, controls, reset action, and a first-run pointer-lock prompt.

## Visual direction

- Subject: a quiet, jewel-like voxel garden called “nomio,” with the game world treated as the main visual artifact.
- Palette: deep ink `#101820`, mineral blue `#6d97a8`, warm stone `#d6c3a5`, lichen `#98b27f`, and signal coral `#f27b63`.
- Signature: a thin coral targeting reticle and block palette that uses tactile swatches rather than generic icon buttons.
- UI typography: a condensed utility face for labels and a readable system sans for instructions.

## Verification targets

- `npm run typecheck`
- `npm run lint`
- `npm run format:check`
- `npm run build`
- Manual browser check of movement, pointer lock, block removal/placement, reset, resize, and mobile fallback.
