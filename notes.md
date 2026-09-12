# Notes: nomio procedural block textures

## Baseline and result

- The repository contains a playable floating-island voxel MVP with a data-first `VoxelWorld`.
- Three.js `0.186.0`, Vite `8.3.0`, strict TypeScript, ESLint, Prettier, Husky, and commitlint are already configured.
- `VoxelWorldRenderer` now consumes face-aware material sets from `ProceduralTextureFactory`.
- The block catalog now contains 17 recipe-driven definitions.

## Texture direction

- Generate each face into a 64×64 HTML canvas and wrap it in a `THREE.CanvasTexture`.
- Preserve a Minecraft-like pixel vocabulary with hard-edged pixels, small tonal clusters, seams, grain, and face variation rather than photographic noise.
- Use seeded random sampling so a block’s texture is stable between reloads and easy to art-direct.
- Built-in pattern families should cover: noise, speckle/ore, cobble, planks, log rings, leaves, glass, brick, snow, netherrack, and obsidian.
- Renderer should use `[side, side, top, bottom, side, side]` against `BoxGeometry`’s standard material groups.

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
