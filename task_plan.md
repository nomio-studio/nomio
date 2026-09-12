# Task Plan: nomio procedural block textures

## Goal

Extend the playable nomio voxel game with an extensible procedural texture system that generates refined Minecraft-like 64×64 block textures for at least a dozen basic materials.

## Phases

- [x] Phase 1: Audit current block/material seams and design the procedural texture contracts
- [x] Phase 2: Implement deterministic 64×64 tiles and pack them into a shared texture atlas
- [x] Phase 3: Remap cached block UVs and preserve per-block material properties
- [x] Phase 4: Verify atlas runtime integration, quality gates, documentation, and atomic commits

## Key Questions

1. How can new block textures be registered without modifying the renderer?
2. Which deterministic pattern families cover natural, crafted, transparent, and ore materials?
3. How do 64×64 face textures preserve crisp pixel character while still looking refined at runtime?

## Decisions Made

- Keep the data-first `VoxelWorld` and separate block definitions from rendering.
- Describe each block with a `TextureRecipe` containing pattern, palette, seed, and material properties.
- Register procedural pattern drawers in a map so texture families can be added independently of the atlas.
- Generate separate top, side, and bottom tiles at `64 × 64`, then pack them into one atlas CanvasTexture.
- Cache one UV-remapped geometry per block ID and keep material properties recipe-driven.
- Keep the dependency-light approach: browser Canvas + Three.js, with no downloaded image assets.

## Errors Encountered

- Previous MVP work is complete and provides the integration baseline.

## Status

**Complete** - The shared atlas, UV remapping, renderer integration, documentation, quality gates, and atomic commits are complete.
