import { BLOCK_DEFINITIONS, BLOCK_ORDER, type BlockDefinition } from "./blocks";
import type { BlockId } from "./types";

export class BlockRegistry {
  private readonly definitions: ReadonlyMap<BlockId, BlockDefinition>;
  private readonly orderedIds: readonly BlockId[];

  public constructor(
    definitions: Readonly<Record<BlockId, BlockDefinition>>,
    order: readonly BlockId[],
  ) {
    const seen = new Set<BlockId>();
    for (const id of order) {
      if (!definitions[id]) {
        throw new Error(`Block order references an unknown block: ${id}`);
      }
      if (seen.has(id)) {
        throw new Error(`Block order contains a duplicate block: ${id}`);
      }
      seen.add(id);
    }

    for (const [key, definition] of Object.entries(definitions)) {
      if (key !== definition.id) {
        throw new Error(`Block definition key does not match its id: ${key}`);
      }
    }

    this.definitions = new Map(Object.entries(definitions) as [BlockId, BlockDefinition][]);
    this.orderedIds = Object.freeze([...order]);
  }

  public get ids(): readonly BlockId[] {
    return this.orderedIds;
  }

  public get size(): number {
    return this.orderedIds.length;
  }

  public get(id: BlockId): BlockDefinition {
    const definition = this.definitions.get(id);
    if (!definition) {
      throw new Error(`Unknown block: ${id}`);
    }
    return definition;
  }

  public has(id: BlockId): boolean {
    return this.definitions.has(id);
  }

  public indexOf(id: BlockId): number {
    return this.orderedIds.indexOf(id);
  }

  public forEach(callback: (definition: BlockDefinition) => void): void {
    for (const id of this.orderedIds) {
      callback(this.get(id));
    }
  }
}

export const DEFAULT_BLOCK_REGISTRY = new BlockRegistry(BLOCK_DEFINITIONS, BLOCK_ORDER);
