# Task Plan: nomio terrain generation and meshing

## Goal

Develop and integrate a mature chunked terrain pipeline using OpenSimplex2 + fBm heightmaps, Uint8Array voxel storage, worker generation with transferable buffers, greedy meshing, and face culling.

## Phases

- [x] Phase 1: Define chunk, numeric block, terrain, and worker contracts
- [x] Phase 2: Implement OpenSimplex2 fBm heightmap generation in a worker
- [x] Phase 3: Replace world storage and renderer with chunk Uint8Array + greedy meshing
- [x] Phase 4: Integrate async loading, player collision, interaction, and reset behavior
- [x] Phase 5: Verify runtime, visual output, performance seams, documentation, and atomic commits

## Key Questions

1. Which chunk coordinate and voxel index contracts keep worker, world, and mesher data-compatible?
2. How should OpenSimplex2 and fBm parameters map to stable, playable block heights?
3. How can chunk-boundary neighbor lookups guarantee face culling without synchronous worker coupling?
4. How can the async generator be disposed and restarted without stale worker results mutating the world?

## Decisions Made

- Preserve the previous modular application/session boundary while replacing only terrain and world-rendering internals.
- Use fixed-size X/Z chunks and a bounded Y range so each chunk has a compact transferable `Uint8Array`.
- Reserve voxel value `0` for air and keep block values stable through a centralized block-type mapping.
- Generate a configurable 3×3 initial chunk window asynchronously, then rebuild affected meshes when neighbors arrive.
- Use greedy meshing per visible face orientation and cull faces whose neighboring voxel is solid.

## Errors Encountered

- The existing MVP and procedural atlas are the integration baseline; terrain work is replacing its Map/per-block-mesh path.

## Status

**Complete** - The terrain pipeline is integrated, structurally verified, browser-smoke-tested, visually inspected, documented, and ready for commit.

---

# Task Plan: touch-directed editing and break feedback refinement

## Goal

Make touch editing target the user's tap/hold position instead of the center crosshair, remove the touch reticle, and make block breaking feedback feel physical, readable, and bounded in cost.

## Phases

- [x] Phase 1: Trace current touch aim, HUD reticle, interactor, and debris contracts
- [x] Phase 2: Implement touch-directed placement/mining and responsive HUD behavior
- [x] Phase 3: Refine break-stage animation and pooled collision-aware debris
- [x] Phase 4: Run type, lint, format, browser interaction, visual, and performance checks

## Key Questions

1. How can touch tap/hold raycasts use the active pointer position while desktop remains crosshair-driven?
2. Which state changes must cancel a touch mine gesture or hide its indicator?
3. How can richer debris avoid per-break allocations, excess draw calls, and persistent particles?

## Decisions Made

- Preserve the existing desktop crosshair workflow and only use pointer-position rays for touch editing.
- Keep touch look and editing on one captured pointer, distinguishing tap, drag, and hold through the existing gesture state.
- Keep break debris instanced and pooled; enrich motion, shape, tint, and collision response within a bounded capacity.

## Errors Encountered

- Existing uncommitted changes already contain an initial touch/break feedback pass; treat them as user-owned work and validate/refine in place.

## Status

**Complete** - Touch-directed editing, touch reticle removal, authored break feedback, and bounded debris were implemented and validated with repository checks, browser smoke tests, and visual captures.

---

# Task Plan: dramatic terrain and topography upgrade

## Goal

Transform Nomio's procedural terrain into a diverse, striking playable landscape with distinct landforms, landmark-scale silhouettes, biome variation, and material cues while preserving deterministic chunk streaming.

## Phases

- [x] Phase 1: Audit the terrain, meshing, scene, and current visual baseline
- [x] Phase 2: Implement layered biome and landform generation with landmark features
- [x] Phase 3: Tune terrain material distribution and world presentation for readable visual contrast
- [x] Phase 4: Verify determinism, streaming, build health, performance budget, and live visual captures

## Key Questions

1. Which height, biome, and feature signals can make the silhouette feel authored without introducing cross-chunk seams?
2. How should block strata and landmark materials reinforce each biome at a distance and close up?
3. How can the richer terrain remain fast enough for the existing worker, greedy mesher, and streaming budget?

## Decisions Made

- Retain deterministic, pure worker generation so saves and streaming remain compatible with the existing architecture.
- Favor large-scale silhouettes first (ridges, cliffs, peaks, basins, coasts), then layer surface-biome detail and sparse landmarks.
- Keep the existing vertical chunk window; relief rises from low basin floors to capped peaks instead of increasing storage, lighting, and mesh work per chunk.
- Set the spawn on a nearby meadow shelf facing the first mountain fold so the game opens onto the new terrain rather than into a cliff.

## Errors Encountered

- None yet.

## Status

**Complete** - The terrain upgrade is implemented and verified through deterministic landform tests, full repository checks, worker generation timing, and live-browser visual captures.

---

# Task Plan: concise vector identity and complete PWA support

## Goal

Give Nomio a compact voxel-inspired vector mark and make the production app installable, theme-aware, offline-capable, and pleasant to relaunch from a device home screen.

## Phases

- [x] Phase 1: Audit the app shell and build setup
- [x] Phase 2: Add the vector icon, manifest, service worker, offline fallback, and registration
- [x] Phase 3: Verify production build, install metadata, cached reload, and icon rendering

## Decisions Made

- Keep the icon as a dependency-free SVG with an isometric cube silhouette that echoes the game world.
- Use PNG exports for manifest and Apple touch icons while retaining the SVG as the browser favicon and mask icon.
- Register the service worker only in production/preview so Vite HMR is never cached during development.

## Verification

- `npm run build`, `npm run typecheck`, `npm run lint`, and `npm run format:check` pass.
- Preview smoke test confirms manifest MIME/status, service-worker registration and control, 200 offline reload, cached icon responses, and zero page errors.
- The production bundle retains the existing large Three.js chunk warning; this is unrelated to the PWA layer.

## Status

**Complete** - Nomio has a cohesive vector identity and production-ready, base-path-safe PWA support.

---

# Task Plan: monumental terrain escalation

## Goal

Turn Nomio's world into a huge, high-relief landscape with steep ranges, deep basins, and relentless macro undulation while retaining deterministic generation, safe spawning, and streamable chunk performance.

## Phases

- [x] Phase 1: Audit terrain limits, persistence coupling, and current landform tests
- [x] Phase 2: Expand the vertical world and rebuild macro terrain signals for extreme relief
- [x] Phase 3: Tune material/features/spawn for the new scale and invalidate incompatible save deltas
- [x] Phase 4: Verify deterministic generation, performance, and live visual impact

## Decisions Made

- Increase the vertical terrain window rather than compressing a taller silhouette into the former 40-block limit.
- Favor wide tectonic landforms, cliffs, cirques, and deep cuts over noisy single-block spikes.
- Preserve deterministic, coordinate-only generation so worker streaming and persistence continue to function.

## Status

## Verification

- Terrain diagnostics measure a 92-block regional elevation span (`-32` to `60`) and retain all six biome families.
- The 225-chunk terrain generation sample completed in 563.5 ms (2.50 ms/chunk), under the 3 ms budget.
- A live browser capture confirms the opening meadow faces a mountain wall with steep terraces, giant snow-capped forms, and no page errors.
- `npm run build`, `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run test:terrain`, and `npm run test:saves` pass.

## Status

**Complete** - The terrain now uses a much larger vertical world and an aggressively folded macro landscape designed for immediate visual impact.
