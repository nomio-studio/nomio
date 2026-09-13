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
