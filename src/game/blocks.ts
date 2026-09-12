import type { TextureRecipe } from "./texture-types";
import type { BlockId } from "./types";

export interface BlockDefinition {
  id: BlockId;
  label: string;
  color: number;
  accent: string;
  description: string;
  texture: TextureRecipe;
}

const recipe = (
  pattern: string,
  palette: readonly string[],
  seed: number,
  options: Omit<TextureRecipe, "pattern" | "palette" | "seed"> = {},
): TextureRecipe => ({ pattern, palette, seed, ...options });

export const BLOCK_DEFINITIONS: Record<BlockId, BlockDefinition> = {
  grass: {
    id: "grass",
    label: "Grass",
    color: 0x98b27f,
    accent: "#98b27f",
    description: "soft ground",
    texture: recipe("grass", ["#6f8d5b", "#9fbd83", "#526b48", "#c1d69a"], 7),
  },
  dirt: {
    id: "dirt",
    label: "Dirt",
    color: 0x8b5a3c,
    accent: "#8b5a3c",
    description: "earthy loam",
    texture: recipe("dirt", ["#8b5a3c", "#9e6a48", "#6e432f", "#b27a50"], 13),
  },
  stone: {
    id: "stone",
    label: "Stone",
    color: 0x858985,
    accent: "#858985",
    description: "quiet weight",
    texture: recipe("stone", ["#858985", "#9b9d97", "#626762", "#b5b7af"], 19),
  },
  cobblestone: {
    id: "cobblestone",
    label: "Cobble",
    color: 0x737873,
    accent: "#737873",
    description: "rough masonry",
    texture: recipe("cobblestone", ["#8f938c", "#777d77", "#5d625d", "#3d443f"], 23),
  },
  sand: {
    id: "sand",
    label: "Sand",
    color: 0xd7bd80,
    accent: "#d7bd80",
    description: "sun-warmed grain",
    texture: recipe("sand", ["#d7bd80", "#e5ce96", "#b19562", "#f0dca6"], 29),
  },
  oak_log: {
    id: "oak_log",
    label: "Oak Log",
    color: 0x9b673b,
    accent: "#9b673b",
    description: "living timber",
    texture: recipe("oak-log", ["#c18c55", "#8e5c35", "#633b25", "#3e281d"], 31),
  },
  oak_planks: {
    id: "oak_planks",
    label: "Oak Planks",
    color: 0xb17b46,
    accent: "#b17b46",
    description: "crafted boards",
    texture: recipe("oak-planks", ["#b17b46", "#ca965c", "#704326", "#e0b477"], 37),
  },
  leaves: {
    id: "leaves",
    label: "Leaves",
    color: 0x4f7e47,
    accent: "#4f7e47",
    description: "canopy green",
    texture: recipe("leaves", ["#6e9b53", "#4f7e47", "#315c3b", "#92b96d"], 41),
  },
  glass: {
    id: "glass",
    label: "Glass",
    color: 0x9fcfce,
    accent: "#9fcfce",
    description: "clear window",
    texture: recipe("glass", ["#9fcfce", "#e2ffff", "#6eafb5"], 43, {
      transparent: true,
      opacity: 0.62,
      roughness: 0.2,
      metalness: 0.05,
    }),
  },
  bricks: {
    id: "bricks",
    label: "Bricks",
    color: 0xa34e3f,
    accent: "#a34e3f",
    description: "fired red clay",
    texture: recipe("bricks", ["#a34e3f", "#b85f4d", "#6e332e", "#d17a5b"], 47),
  },
  snow: {
    id: "snow",
    label: "Snow",
    color: 0xe3edeb,
    accent: "#e3edeb",
    description: "winter crust",
    texture: recipe("snow", ["#e3edeb", "#f8fffc", "#b7d1d2", "#89aab4"], 53),
  },
  netherrack: {
    id: "netherrack",
    label: "Netherrack",
    color: 0x873e3b,
    accent: "#873e3b",
    description: "warm underworld",
    texture: recipe("netherrack", ["#873e3b", "#a24e43", "#551d24", "#d17959"], 59),
  },
  obsidian: {
    id: "obsidian",
    label: "Obsidian",
    color: 0x28223d,
    accent: "#65508e",
    description: "violet glassstone",
    texture: recipe("obsidian", ["#28223d", "#35284f", "#744aa0", "#b38ee0"], 61, {
      roughness: 0.48,
      metalness: 0.14,
    }),
  },
  coal_ore: {
    id: "coal_ore",
    label: "Coal Ore",
    color: 0x555a55,
    accent: "#363a38",
    description: "charcoal seam",
    texture: recipe("ore", ["#777b76", "#999d96", "#292d2a", "#20231f"], 67),
  },
  iron_ore: {
    id: "iron_ore",
    label: "Iron Ore",
    color: 0x807873,
    accent: "#ae7860",
    description: "rusted seam",
    texture: recipe("ore", ["#807873", "#a99f96", "#795b4e", "#b87b60"], 71),
  },
  mossy_cobblestone: {
    id: "mossy_cobblestone",
    label: "Mossy Cobble",
    color: 0x647765,
    accent: "#647765",
    description: "green weathering",
    texture: recipe(
      "mossy-cobblestone",
      ["#8f938c", "#777d77", "#5d625d", "#3d443f", "#72955c"],
      73,
    ),
  },
  crystal: {
    id: "crystal",
    label: "Crystal",
    color: 0x6d97a8,
    accent: "#6d97a8",
    description: "cold light",
    texture: recipe("crystal", ["#315d79", "#467c95", "#9fd6df", "#d6ffff"], 79, {
      roughness: 0.34,
      metalness: 0.16,
    }),
  },
};

export const BLOCK_ORDER: BlockId[] = [
  "grass",
  "dirt",
  "stone",
  "cobblestone",
  "sand",
  "oak_log",
  "oak_planks",
  "leaves",
  "glass",
  "bricks",
  "snow",
  "netherrack",
  "obsidian",
  "coal_ore",
  "iron_ore",
  "mossy_cobblestone",
  "crystal",
];
