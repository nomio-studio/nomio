import type {
  ChunkCoordinate,
  TerrainWorkerGenerateRequest,
  TerrainWorkerResponse,
  VoxelChunk,
} from "./chunk-types";
import type { TerrainConfig } from "./terrain-config";

interface PendingRequest {
  resolve: (chunk: VoxelChunk) => void;
  reject: (error: Error) => void;
}

export class TerrainWorker {
  private readonly worker: Worker;
  private readonly pending = new Map<number, PendingRequest>();
  private nextRequestId = 1;
  private disposed = false;

  public constructor(private readonly config: TerrainConfig) {
    this.worker = new Worker(new URL("./terrain-generation.worker.ts", import.meta.url), {
      type: "module",
    });
    this.worker.onmessage = this.handleMessage;
    this.worker.onerror = this.handleError;
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
      this.pending.set(requestId, { resolve, reject });
      this.worker.postMessage(request);
    });
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.worker.onmessage = null;
    this.worker.onerror = null;
    this.worker.terminate();
    const error = new Error("Terrain worker was disposed");
    for (const request of this.pending.values()) {
      request.reject(error);
    }
    this.pending.clear();
  }

  private readonly handleMessage = (event: MessageEvent<TerrainWorkerResponse>): void => {
    const response = event.data;
    if (response.type !== "generated") {
      return;
    }

    const request = this.pending.get(response.requestId);
    if (!request) {
      return;
    }
    this.pending.delete(response.requestId);
    request.resolve({ x: response.x, z: response.z, blocks: new Uint8Array(response.buffer) });
  };

  private readonly handleError = (event: ErrorEvent): void => {
    const error = event.error instanceof Error ? event.error : new Error(event.message);
    for (const request of this.pending.values()) {
      request.reject(error);
    }
    this.pending.clear();
  };
}
