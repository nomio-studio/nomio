# Task Plan: nomio maintainability refactor

## Goal

Refactor the current nomio voxel game into a standardized, highly modular runtime that is easy to maintain, test, and extend without changing the game’s behavior.

## Phases

- [x] Phase 1: Map current coupling and define refactor boundaries
- [x] Phase 2: Extract application composition, scene runtime, and game configuration
- [x] Phase 3: Introduce registries, lifecycle cleanup, and reusable service contracts
- [x] Phase 4: Verify behavior, update documentation, and create atomic commits

## Key Questions

1. Which modules should own lifecycle, configuration, data, rendering, input, and UI concerns?
2. How can custom block registries and game configuration be injected without global imports?
3. Can every event-driven service be disposed cleanly for tests, hot reload, and future scene switching?

## Decisions Made

- Keep `main.ts` as a minimal browser bootstrap and move dependency wiring into an application layer.
- Inject `BlockRegistry` and `GameConfig` into systems that currently import global constants or hard-code tuning.
- Make input, HUD, scene runtime, and game session own explicit `dispose()` lifecycles.
- Preserve the existing atlas, world, and player behavior while reducing per-frame allocations and duplicated wiring.

## Errors Encountered

- The existing MVP and procedural atlas are the integration baseline.

## Status

**Complete** - The modular runtime is implemented, documented, browser-smoke-tested, and ready in atomic commits.
