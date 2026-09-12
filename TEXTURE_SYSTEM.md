# nomio procedural texture system

## Contract

Each block owns a `TextureRecipe`:

```ts
{
  pattern: "cobblestone",
  palette: ["#8f938c", "#777d77", "#5d625d", "#3d443f"],
  seed: 23,
  roughness: 0.86,
  metalness: 0
}
```

The procedural drawer library uses that recipe to create three temporary HTML canvas tiles—`side`, `top`, and `bottom`—at exactly `64 × 64` pixels. `BlockTextureAtlas` packs every tile into one shared atlas canvas with a two-pixel extruded border per tile. With 17 blocks and three faces, the current layout is eight columns by seven rows of `68 × 68` cells: `544 × 476` pixels containing 51 tiles.

Each block receives cached UV geometry that points its six cube faces into the shared atlas in the standard BoxGeometry face order:

```text
[ side, side, top, bottom, side, side ]
```

The atlas uses `THREE.SRGBColorSpace`, nearest magnification, `NearestMipmapLinearFilter` minification, mipmaps, and deterministic seeded sampling. Each tile's edge pixels are extruded into its padding so mipmap sampling and filtering never bleed colors between adjacent pixel-art tiles while distant blocks stay crisp instead of shimmering.

## Built-in families

- `grass`, `dirt`, `stone`: layered pixel noise and surface grain.
- `cobblestone`, `mossy-cobblestone`: irregular masonry silhouettes and seams.
- `sand`, `snow`: fine grain with face-specific edge bands.
- `oak-log`, `oak-planks`: rings, grain, board seams, and knots.
- `leaves`: clustered canopy pixels.
- `glass`: translucent base, frame, diagonal reflection, and flecks.
- `bricks`: staggered mortar grid with tonal variation.
- `netherrack`, `obsidian`, `crystal`: specialized mineral color fields and streaks.
- `ore`: reusable host-stone pattern with palette-driven ore clusters for coal and iron.

## Adding a pattern

Pattern drawers are registered by string key, so extending the library does not require editing the renderer:

```ts
registerTexturePattern("my-pattern", ({ context, palette, size }) => {
  context.fillStyle = palette[0];
  context.fillRect(0, 0, size, size);
});
```

Then assign `pattern: "my-pattern"` to a block’s recipe in `src/game/blocks.ts`. The atlas handles tile sizing, packing, seeded context setup, UV remapping, color space, filtering, material properties, and disposal.
