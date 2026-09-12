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
- `1`, `2`, `3`: select lichen, stone, or crystal
- Mobile: drag the world to look, use the directional pad to move, and use Mine / Place buttons

## Architecture

The game is split into small modules so the world model can evolve independently from the presentation and controls:

```text
src/
├── game/
│   ├── blocks.ts          # Block palette and definitions
│   ├── input.ts           # Keyboard, mouse, touch, and virtual controls
│   ├── interactor.ts      # Raycast targeting and break/place actions
│   ├── player.ts          # First-person look, movement, gravity, collision
│   ├── types.ts           # Shared voxel and game contracts
│   ├── world.ts           # Data-first voxel storage and AABB queries
│   ├── world-generator.ts # Deterministic starter island
│   └── world-renderer.ts  # Three.js block meshes and target highlight
├── ui/
│   └── hud.ts             # HUD, palette, prompt, and touch controls
├── main.ts                # Composition root and render loop
└── style.css              # Responsive field-note interface
```

The world currently renders one mesh per block. That keeps the MVP easy to understand and leaves a clear seam for chunk meshing, texture atlases, persistence, or procedural generators in a later iteration.

## Git and quality

The repository uses Conventional Commits, Husky, lint-staged, ESLint, Prettier, and strict TypeScript. Changes for the MVP are kept in atomic commits so the gameplay foundation and documentation remain easy to review independently.
