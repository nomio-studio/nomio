import type {
  ChunkCoordinate,
  ChunkMeshBuffers,
  ChunkMeshNeighbors,
  TerrainWorkerGenerateRequest,
  TerrainWorkerMeshRequest,
  TerrainWorkerResponse,
  VoxelChunk,
} from "./chunk-types";
import { DEFAULT_LIGHTING, type LightingConfig } from "./config";
import type { TerrainConfig } from "./terrain-config";

type PendingRequest =
  | {
      readonly kind: "generate";
      readonly slot: WorkerSlot;
      readonly resolve: (chunk: VoxelChunk) => void;
      readonly reject: (error: Error) => void;
    }
  | {
      readonly kind: "mesh";
      readonly slot: WorkerSlot;
      readonly resolve: (mesh: ChunkMeshBuffers) => void;
      readonly reject: (error: Error) => void;
    };

interface WorkerSlot {
  readonly worker: Worker;
  active: number;
}

const defaultWorkerCount = (): number => {
  const cores =
    typeof navigator !== "undefined" && navigator.hardwareConcurrency
      ? navigator.hardwareConcurrency
      : 4;
  return Math.max(1, Math.min(4, cores - 1));
};

/**
 * Pool of module Web Workers that generate terrain chunks and build greedy
 * chunk meshes off the main thread. Requests are dispatched to the least busy
 * worker so generation and meshing stay parallel.
 */
export class TerrainWorker {
  private readonly slots: WorkerSlot[] = [];
  private readonly pending = new Map<number, PendingRequest>();
  private nextRequestId = 1;
  private disposed = false;

  public constructor(
    private readonly config: TerrainConfig,
    workerCount: number = defaultWorkerCount(),
    private readonly lighting: LightingConfig = DEFAULT_LIGHTING,
  ) {
    if (workerCount < 1) {
      throw new Error("TerrainWorker requires at least one worker");
    }
    for (let index = 0; index < workerCount; index += 1) {
      const worker = new Worker(new URL("./terrain-generation.worker.ts", import.meta.url), {
        type: "module",
      });
      const slot: WorkerSlot = { worker, active: 0 };
      worker.onmessage = (event: MessageEvent<TerrainWorkerResponse>): void =>
        this.handleMessage(slot, event);
      worker.onerror = (event: ErrorEvent): void => this.handleError(slot, event);
      this.slots.push(slot);
    }
  }

  public generate(coordinate: ChunkCoordinate): Promise<VoxelChunk> {
    if (this.disposed) {
      return Promise.reject(new Error("Terrain worker has been disposed"));
    }

    const requestId = this.nextRequestId;
    this.nextRequestId += 1;
    const request: TerrainWorkerGenerateRequest = {
      type: "generate",
      requestId,
      x: coordinate.x,
      z: coordinate.z,
      config: this.config,
    };

    return new Promise<VoxelChunk>((resolve, reject) => {
      const slot = this.pickSlot();
      slot.active += 1;
      this.pending.set(requestId, { kind: "generate", slot, resolve, reject });
      slot.worker.postMessage(request);
    });
  }

  public mesh(
    coordinate: ChunkCoordinate,
    blocks: Uint8Array,
    neighbors: ChunkMeshNeighbors,
  ): Promise<ChunkMeshBuffers> {
    if (this.disposed) {
      return Promise.reject(new Error("Terrain worker has been disposed"));
    }

    const requestId = this.nextRequestId;
    this.nextRequestId += 1;
    const request: TerrainWorkerMeshRequest = {
      type: "mesh",
      requestId,
      x: coordinate.x,
      z: coordinate.z,
      blocks,
      neighbors,
      lighting: this.lighting,
    };

    return new Promise<ChunkMeshBuffers>((resolve, reject) => {
      const slot = this.pickSlot();
      slot.active += 1;
      this.pending.set(requestId, { kind: "mesh", slot, resolve, reject });
      slot.worker.postMessage(request);
    });
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    for (const slot of this.slots) {
      slot.worker.onmessage = null;
      slot.worker.onerror = null;
      slot.worker.terminate();
    }
    const error = new Error("Terrain worker was disposed");
    for (const request of this.pending.values()) {
      request.reject(error);
    }
    this.pending.clear();
  }

  private pickSlot(): WorkerSlot {
    let best = this.slots[0];
    for (const slot of this.slots) {
      if (slot.active < best.active) {
        best = slot;
      }
    }
    return best;
  }

  private handleMessage(slot: WorkerSlot, event: MessageEvent<TerrainWorkerResponse>): void {
    const response = event.data;
    const request = this.pending.get(response.requestId);
    if (!request) {
      return;
    }

    this.pending.delete(response.requestId);
    slot.active = Math.max(0, slot.active - 1);

    if (request.kind === "generate" && response.type === "generated") {
      request.resolve({ x: response.x, z: response.z, blocks: new Uint8Array(response.buffer) });
    } else if (request.kind === "mesh" && response.type === "meshed") {
      request.resolve(response.mesh);
    }
  }

  private handleError(slot: WorkerSlot, event: ErrorEvent): void {
    const error = event.error instanceof Error ? event.error : new Error(event.message);
    for (const [requestId, request] of this.pending) {
      if (request.slot === slot) {
        request.reject(error);
        this.pending.delete(requestId);
      }
    }
    slot.active = 0;
  }
}
