# Task Plan: nomio procedural block textures

## Goal

Extend the playable nomio voxel game with an extensible procedural texture system that generates refined Minecraft-like 64×64 block textures for at least a dozen basic materials.

## Phases

- [x] Phase 1: Audit current block/material seams and design the procedural texture contracts
- [x] Phase 2: Implement deterministic 64×64 texture generation and face-aware material sets
- [x] Phase 3: Expand the block catalog to a dozen-plus materials and expose it in gameplay
- [x] Phase 4: Verify visual/runtime integration, quality gates, documentation, and atomic commits

## Key Questions

1. How can new block textures be registered without modifying the renderer?
2. Which deterministic pattern families cover natural, crafted, transparent, and ore materials?
3. How do 64×64 face textures preserve crisp pixel character while still looking refined at runtime?

## Decisions Made

- Keep the data-first `VoxelWorld` and separate block definitions from rendering.
- Describe each block with a `TextureRecipe` containing pattern, palette, seed, and material properties.
- Register procedural pattern drawers in a map so texture families can be added independently of the factory.
- Generate separate top, side, and bottom CanvasTextures at `64 × 64`, using nearest filtering for pixel clarity.
- Keep the dependency-light approach: browser Canvas + Three.js, with no downloaded image assets.

## Errors Encountered

- Previous MVP work is complete and provides the integration baseline.

## Status

**Complete** - The 64×64 texture factory, 17-block catalog, renderer integration, documentation, quality gates, and atomic commits are complete.
