import type { BlockId } from "./types";

export interface BlockDefinition {
  id: BlockId;
  label: string;
  color: number;
  accent: string;
  description: string;
}

export const BLOCK_DEFINITIONS: Record<BlockId, BlockDefinition> = {
  grass: {
    id: "grass",
    label: "Lichen",
    color: 0x98b27f,
    accent: "#98b27f",
    description: "soft ground",
  },
  stone: {
    id: "stone",
    label: "Stone",
    color: 0xd6c3a5,
    accent: "#d6c3a5",
    description: "quiet weight",
  },
  crystal: {
    id: "crystal",
    label: "Crystal",
    color: 0x6d97a8,
    accent: "#6d97a8",
    description: "cold light",
  },
};

export const BLOCK_ORDER: BlockId[] = ["grass", "stone", "crystal"];
