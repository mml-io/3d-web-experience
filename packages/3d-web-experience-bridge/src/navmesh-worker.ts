/**
 * Worker thread for background navmesh generation.
 * Runs generateTiledNavMesh in a separate thread so the main event loop
 * is never blocked by Recast WASM voxelization.
 *
 * Protocol:
 *   Main → Worker: { type: "generate", requestId, positions, indices, jumpLinks, config }
 *   Worker → Main: { type: "result", requestId, success, navMeshData?, debugPositions?, debugIndices?, error? }
 */
import { parentPort } from "worker_threads";

import { init, exportNavMesh, type OffMeshConnectionParams } from "@recast-navigation/core";
import { generateSoloNavMesh, generateTiledNavMesh } from "@recast-navigation/generators";

import { debug } from "./logger";

if (!parentPort) {
  throw new Error("navmesh-worker must be run in a worker thread");
}

const port = parentPort;
let recastReady = false;

interface GenerateMessage {
  type: "generate";
  requestId: number;
  positions: ArrayBuffer;
  indices: ArrayBuffer;
  jumpLinks: OffMeshConnectionParams[];
  config: Record<string, any>;
}

port.on("message", async (msg: GenerateMessage) => {
  if (msg.type !== "generate") return;

  try {
    if (!recastReady) {
      await init();
      recastReady = true;
    }

    const positions = new Float32Array(msg.positions);
    const indices = new Uint32Array(msg.indices);
    const triCount = indices.length / 3;

    // Log input geometry bounds for debugging
    let minX = Infinity,
      minY = Infinity,
      minZ = Infinity;
    let maxX = -Infinity,
      maxY = -Infinity,
      maxZ = -Infinity;
    for (let i = 0; i < positions.length; i += 3) {
      minX = Math.min(minX, positions[i]);
      minY = Math.min(minY, positions[i + 1]);
      minZ = Math.min(minZ, positions[i + 2]);
      maxX = Math.max(maxX, positions[i]);
      maxY = Math.max(maxY, positions[i + 1]);
      maxZ = Math.max(maxZ, positions[i + 2]);
    }
    debug(
      `[navmesh-worker] Input: ${triCount} tris, bounds: (${minX.toFixed(1)},${minY.toFixed(1)},${minZ.toFixed(1)}) to (${maxX.toFixed(1)},${maxY.toFixed(1)},${maxZ.toFixed(1)})`,
    );
    debug(
      `[navmesh-worker] Config: cs=${msg.config.cs} ch=${msg.config.ch} tileSize=${msg.config.tileSize} walkableHeight=${msg.config.walkableHeight} walkableClimb=${msg.config.walkableClimb} walkableRadius=${msg.config.walkableRadius}`,
    );

    // Try tiled generation first (handles large scenes within Detour's 16-bit vertex limit)
    let result = generateTiledNavMesh(positions, indices, {
      ...msg.config,
      offMeshConnections: msg.jumpLinks,
    });

    // Diagnostic: check tile count
    if (result.success && result.navMesh) {
      const maxTiles = result.navMesh.getMaxTiles();
      let nonEmptyTiles = 0;
      for (let i = 0; i < maxTiles; i++) {
        const tile = result.navMesh.getTile(i);
        if (tile.header()) nonEmptyTiles++;
      }
      const [dbgPos, dbgIdx] = result.navMesh.getDebugNavMesh();
      debug(
        `[navmesh-worker] Tiled result: maxTiles=${maxTiles}, nonEmpty=${nonEmptyTiles}, debugPositions=${dbgPos.length}, debugIndices=${dbgIdx.length}`,
      );

      // If tiled produced an empty navmesh, fall back to solo
      if (nonEmptyTiles === 0) {
        console.warn(`[navmesh-worker] Tiled generation produced 0 tiles, falling back to solo...`);
        result.navMesh.destroy();
        result = { success: false } as any;
      }
    }

    // Fallback: solo generation (works for smaller scenes, no tile overhead)
    if (!result.success || !result.navMesh) {
      debug(
        `[navmesh-worker] Trying solo generation (${triCount} tris, ${msg.jumpLinks.length} links)...`,
      );
      const soloResult = generateSoloNavMesh(positions, indices, {
        ...msg.config,
        offMeshConnections: msg.jumpLinks,
      });

      if (!soloResult.success && msg.jumpLinks.length > 0) {
        console.warn(`[navmesh-worker] Solo failed with links, retrying without...`);
        const soloNoLinks = generateSoloNavMesh(positions, indices, msg.config);
        if (soloNoLinks.success && soloNoLinks.navMesh) {
          debug("[navmesh-worker] Solo succeeded without off-mesh connections");
          result = soloNoLinks as any;
        }
      } else if (soloResult.success && soloResult.navMesh) {
        result = soloResult as any;
      }
    }

    if (result.success && result.navMesh) {
      // Extract debug geometry BEFORE export — the detail mesh data
      // (used by getDebugNavMesh) may not survive the export/import cycle.
      const [debugPositions, debugIndices] = result.navMesh.getDebugNavMesh();
      debug(
        `[navmesh-worker] Final debug mesh: ${debugPositions.length / 3} verts, ${debugIndices.length / 3} tris`,
      );

      const exported = exportNavMesh(result.navMesh);
      const buffer = exported.buffer.slice(0);
      result.navMesh.destroy();

      port.postMessage(
        {
          type: "result",
          requestId: msg.requestId,
          success: true,
          navMeshData: buffer,
          debugPositions,
          debugIndices,
        },
        [buffer as ArrayBuffer],
      );
    } else {
      port.postMessage({
        type: "result",
        requestId: msg.requestId,
        success: false,
        error:
          (result as any).error ||
          `NavMesh generation failed (${triCount} tris, ${msg.jumpLinks.length} links)`,
      });
    }
  } catch (err: any) {
    console.error("[navmesh-worker] Exception:", err);
    port.postMessage({
      type: "result",
      requestId: msg.requestId,
      success: false,
      error: err.message,
    });
  }
});
