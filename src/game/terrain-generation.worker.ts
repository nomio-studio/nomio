import type { TerrainWorkerGenerateRequest, TerrainWorkerResponse } from "./chunk-types";
import { generateTerrainChunk } from "./terrain-generation";

interface TerrainWorkerScope {
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<TerrainWorkerGenerateRequest>) => void,
  ): void;
  postMessage(message: TerrainWorkerResponse, transfer: Transferable[]): void;
}

const workerScope = self as unknown as TerrainWorkerScope;

workerScope.addEventListener("message", (event) => {
  const request = event.data;
  if (request.type !== "generate") {
    return;
  }

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
});
