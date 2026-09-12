import { meshTransferables, meshVoxelChunk } from "./chunk-mesher";
import type { TerrainWorkerRequest, TerrainWorkerResponse } from "./chunk-types";
import { generateTerrainChunk } from "./terrain-generation";

interface TerrainWorkerScope {
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<TerrainWorkerRequest>) => void,
  ): void;
  postMessage(message: TerrainWorkerResponse, transfer: Transferable[]): void;
}

const workerScope = self as unknown as TerrainWorkerScope;

workerScope.addEventListener("message", (event) => {
  const request = event.data;

  if (request.type === "generate") {
    const chunk = generateTerrainChunk(request, request.config);
    const buffer = chunk.blocks.buffer as ArrayBuffer;
    workerScope.postMessage(
      {
        type: "generated",
        requestId: request.requestId,
        x: request.x,
        z: request.z,
        buffer,
      },
      [buffer],
    );
    return;
  }

  if (request.type === "mesh") {
    const mesh = meshVoxelChunk(
      { x: request.x, z: request.z, blocks: request.blocks },
      request.neighbors,
      request.lighting,
    );
    workerScope.postMessage(
      {
        type: "meshed",
        requestId: request.requestId,
        x: request.x,
        z: request.z,
        mesh,
      },
      meshTransferables(mesh),
    );
  }
});
