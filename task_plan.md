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
