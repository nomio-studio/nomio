# Repository Guidelines

## Project Structure & Module Organization

Nomio is a Vite + TypeScript + Three.js browser voxel game. Runtime composition lives in `src/app`; gameplay systems (chunks, terrain workers, rendering, input, saves, and persistence) live in `src/game`; DOM screens and controls live in `src/ui`. `src/main.ts` is the minimal browser bootstrap and `src/style.css` contains the responsive UI styling. Utility validation scripts are in `scripts/`, documentation is kept in root Markdown files, and visual references belong in `screenshots/`. There is no dedicated test directory.

## Build, Test, and Development Commands

- `npm install` installs the pinned dependencies (Node.js 20+).
- `npm run dev` starts Vite on `http://localhost:5173/`.
- `npm run typecheck` runs strict TypeScript checks for app, config, and scripts.
- `npm run lint` runs ESLint; use `npm run lint:fix` for safe automatic fixes.
- `npm run format:check` verifies Prettier formatting; `npm run format` applies it.
- `npm run build` runs type checks and creates the production bundle in `dist/`.
- `npm run test:saves` exercises save/catalog persistence with an in-memory driver.
- `npm run bench:voxel-format` benchmarks voxel codecs and round trips representative data.
- `npm run preview` serves the built bundle locally.

## Coding Style & Naming Conventions

Use Prettier defaults (two-space indentation, semicolons, double quotes) and strict TypeScript. Prefer small modules with explicit interfaces and type-only imports. Use kebab-case filenames, PascalCase classes, camelCase functions and variables, and `UPPER_SNAKE_CASE` constants. Keep browser/DOM concerns in `src/ui` and inject configurable registries or runtime options rather than coupling systems to defaults.

## Testing Guidelines

There is no test framework or coverage threshold. Run `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run test:saves`, and `npm run bench:voxel-format` before submitting changes. For gameplay or visual work, also run the dev server and manually verify loading, streaming, editing, reset behavior, touch layout, and console errors at desktop and mobile-sized viewports.

## Commit & Pull Request Guidelines

Commits follow Conventional Commits, such as `feat: add held mining`, `fix: align movement`, or `docs: document terrain pipeline`. Keep commits focused and atomic. Pull requests should explain the user-visible and architectural impact, list validation commands, link an issue when applicable, and include screenshots or short recordings for UI, rendering, texture, or interaction changes. Do not commit secrets or generated `dist/` output.
