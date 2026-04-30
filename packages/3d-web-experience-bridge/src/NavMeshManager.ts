import { createHash } from "crypto";
import { EventEmitter } from "events";
import path from "path";
import { fileURLToPath } from "url";
import { Worker } from "worker_threads";

import {
  init,
  NavMeshQuery,
  QueryFilter,
  importNavMesh,
  type NavMesh,
  type OffMeshConnectionParams,
} from "@recast-navigation/core";
import { generateTiledNavMesh } from "@recast-navigation/generators";
import * as THREE from "three";

import { GeometryCache } from "./GeometryCache";
import { debug } from "./logger";
import type { Position } from "./tools/utils";

export type { Position } from "./tools/utils";

// --- Region-based navmesh generation ---
// Half-size of the square region (in world units) centred on the avatar.
// 25 gives a 50×50 unit navigable area, which balances coverage with generation speed.
const REGION_HALF_SIZE = 25;
// Distance the avatar must move from the region centre before triggering regeneration.
// Set to ~half the region size so there's always overlap with the prior region.
const REGEN_DISTANCE_THRESHOLD = 12;

// --- Jump-link detection ---
const JUMP_AREA_TYPE = 1;
// Cost multiplier for navmesh edges that require jumping (discourages unnecessary jumps).
const JUMP_COST_MULTIPLIER = 2.0;
// Maximum vertical distance (m) between two surfaces that can be connected by a jump.
// With default physics (jumpForce=17, doubleJumpForce=16.7, gravity=37), a double jump
// can reach ~7.7m. Use 7.0 as a conservative limit to allow multi-platform navigation.
const MAX_JUMP_HEIGHT = 7.0;
// Maximum horizontal (XZ) distance (m) for a jump link.
const MAX_JUMP_XZ = 5.0;
// Height difference below which two surfaces are considered the same walkable layer
// (no jump needed). This value is in world units and corresponds to the walkableClimb
// in NAVMESH_CONFIG (converted: walkableClimb * ch = 2 * 0.25 = 0.5).
const WALKABLE_CLIMB = 0.5;

// Minimum XZ extent for a mesh to be included in navmesh generation.
const MIN_MESH_XZ = 0.3;

// Grid cell size (m) used to spatially bucket walkable surfaces for jump detection.
const JUMP_GRID_CELL = 2.0;
// Global cap on total jump links to prevent Recast from being overwhelmed.
const MAX_JUMP_LINKS = 256;
// Per-cell-pair cap to avoid redundant links between the same two grid cells.
const MAX_LINKS_PER_CELL_PAIR = 2;

// Recast navmesh generation config.
// walkableClimb is in voxel units (multiply by ch to get world units: 2 * 0.25 = 0.5).
// This must stay consistent with WALKABLE_CLIMB above.
export const NAVMESH_CONFIG = {
  // Tiled navmesh: each tile is 32×32 voxel cells (16×16 world units at cs=0.5).
  // Splits geometry across tiles so each stays within Detour's per-tile
  // 16-bit vertex limit (65535). Essential for dense GLB models.
  tileSize: 32,

  cs: 0.5, // cell size (XZ voxel resolution)
  ch: 0.25, // cell height (Y voxel resolution)
  walkableHeight: 8, // in voxels: 8 * 0.25 = 2.0m agent height
  walkableRadius: 3, // in voxels: 3 * 0.5 = 1.5m agent radius (accounts for capsule 0.45m + simplification error + path corner clearance)
  walkableClimb: 2, // in voxels: 2 * 0.25 = 0.5m — must equal WALKABLE_CLIMB
  walkableSlopeAngle: 60,
  maxEdgeLen: 24,
  maxSimplificationError: 0.5,
  minRegionArea: 1,
  mergeRegionArea: 10,
  maxVertsPerPoly: 6,
  detailSampleDist: 6,
  detailSampleMaxError: 1,
};

export type PathWithJumpInfo = {
  path: Position[];
  jumpIndices: Set<number>;
};

export type PlacementSpot = {
  position: Position;
  dimensions: {
    width: number;
    depth: number;
    height: number;
  };
  flatness: {
    yRange: number;
    avgSlopeAngle: number;
    quality: "flat" | "gentle_slope" | "sloped" | "irregular";
  };
  surfaceY: number;
  reachable: boolean;
  distanceFromAgent: number;
};

// Placement spot computation constants
const PLACEMENT_GRID_CELL = 2.0;
const PLACEMENT_MIN_SEPARATION = 4.0;
const PLACEMENT_MAX_HEIGHT = 20.0;
const PLACEMENT_FLATNESS_THRESHOLD = 0.3;
const PLACEMENT_GENTLE_SLOPE_THRESHOLD = 0.8;
const PLACEMENT_SLOPE_THRESHOLD = 1.5;

export type NavMeshOptions = {
  maxY?: number;
  jumpLinksEnabled?: boolean;
  config?: Partial<typeof NAVMESH_CONFIG>;
};

export class NavMeshManager extends EventEmitter {
  private navMesh: NavMesh | null = null;
  private navMeshQuery: NavMeshQuery | null = null;
  private initialized = false;
  private options: NavMeshOptions = {};
  private regionCenter: Position | null = null;
  private isGenerating = false;
  private generationPromise: Promise<boolean> | null = null;
  private pendingCenter: Position | undefined = undefined;
  private hasPendingGeneration = false;
  private pendingResolvers: Array<(value: boolean) => void> = [];
  private jumpFilter: QueryFilter | null = null;

  private geometryCache = new GeometryCache();

  private lastJumpLinksHash: string | null = null;
  private lastJumpLinks: OffMeshConnectionParams[] = [];

  // Generation counter for debug cache invalidation
  private generation = 0;

  // Debug geometry — extracted in the worker before export because the
  // detail mesh data doesn't survive the export/import serialization cycle.
  private debugPositions: number[] = [];
  private debugIndices: number[] = [];

  // Placement spots — computed after navmesh generation
  private placementSpots: PlacementSpot[] = [];

  private worker: Worker | null = null;
  private workerReady = false;
  private requestCounter = 0;
  private pendingRequests = new Map<
    number,
    { resolve: (msg: any) => void; timer: ReturnType<typeof setTimeout> }
  >();

  constructor(options?: NavMeshOptions) {
    super();
    if (options) this.options = options;
  }

  updateOptions(options: NavMeshOptions): void {
    this.options = options;
    this.geometryCache.invalidateAll();
    this.lastJumpLinksHash = null;
    this.lastJumpLinks = [];
    debug(`[navmesh] Options updated: ${JSON.stringify(options)}`);
  }

  getOptions(): NavMeshOptions {
    return { ...this.options };
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    await init();
    this.initialized = true;

    try {
      const dirname = path.dirname(fileURLToPath(import.meta.url));
      const workerPath = path.join(dirname, "navmesh-worker.js");
      this.worker = new Worker(workerPath);
      this.worker.on("message", (msg: any) => this.handleWorkerMessage(msg));
      this.worker.on("error", (err) => {
        console.error("[navmesh-worker] Error:", err);
        this.workerReady = false;
        for (const [id, pending] of this.pendingRequests) {
          clearTimeout(pending.timer);
          pending.resolve({ success: false, error: String(err) });
          this.pendingRequests.delete(id);
        }
        // Terminate the broken worker so it doesn't linger
        this.worker?.terminate();
        this.worker = null;
      });
      this.workerReady = true;
      debug("[navmesh] Background worker started");
    } catch (err) {
      console.warn("[navmesh] Failed to start background worker, using main thread:", err);
      this.workerReady = false;
    }

    debug("[navmesh] Recast WASM initialized");
  }

  private handleWorkerMessage(msg: any): void {
    if (msg.type === "result" && this.pendingRequests.has(msg.requestId)) {
      const pending = this.pendingRequests.get(msg.requestId)!;
      clearTimeout(pending.timer);
      this.pendingRequests.delete(msg.requestId);
      pending.resolve(msg);
    }
  }

  private async runNavMeshGeneration(
    positions: Float32Array,
    indices: Uint32Array,
    jumpLinks: OffMeshConnectionParams[],
    navConfig: typeof NAVMESH_CONFIG = NAVMESH_CONFIG,
  ): Promise<{ success: boolean; navMesh?: NavMesh }> {
    if (this.worker && this.workerReady) {
      // Cancel any existing pending requests
      for (const [id, pending] of this.pendingRequests) {
        clearTimeout(pending.timer);
        pending.resolve({ success: false, cancelled: true });
        this.pendingRequests.delete(id);
      }

      const requestId = ++this.requestCounter;

      // Copy buffers so the originals remain usable after transfer to the worker
      const posBuffer = positions.buffer.slice(0) as ArrayBuffer;
      const idxBuffer = indices.buffer.slice(0) as ArrayBuffer;

      const WORKER_TIMEOUT_MS = 60_000;
      const resultPromise = new Promise<any>((resolve) => {
        const timer = setTimeout(() => {
          this.pendingRequests.delete(requestId);
          console.warn(
            `[navmesh] Worker request ${requestId} timed out after ${WORKER_TIMEOUT_MS}ms`,
          );
          resolve({ success: false, error: "Worker timeout" });
        }, WORKER_TIMEOUT_MS);
        this.pendingRequests.set(requestId, { resolve, timer });
      });

      this.worker.postMessage(
        {
          type: "generate",
          requestId,
          positions: posBuffer,
          indices: idxBuffer,
          jumpLinks,
          config: navConfig,
        },
        [posBuffer, idxBuffer],
      );

      const result = await resultPromise;

      if (!result.success) {
        if (result.cancelled) {
          debug("[navmesh] Background generation cancelled (superseded)");
        } else {
          console.error("[navmesh] Background generation failed:", result.error);
        }
        return { success: false };
      }

      // Store debug geometry sent from the worker (extracted before export)
      this.debugPositions = result.debugPositions ?? [];
      this.debugIndices = result.debugIndices ?? [];
      debug(
        `[navmesh] Debug data from worker: ${this.debugPositions.length / 3} verts, ${this.debugIndices.length / 3} tris`,
      );

      const imported = importNavMesh(new Uint8Array(result.navMeshData));
      if (!imported.navMesh) {
        console.error("[navmesh] Failed to import navmesh from worker");
        return { success: false };
      }

      // Diagnostic: verify imported navmesh has tiles
      const maxTiles = imported.navMesh.getMaxTiles();
      let nonEmptyTiles = 0;
      for (let i = 0; i < maxTiles; i++) {
        const tile = imported.navMesh.getTile(i);
        if (tile.header()) nonEmptyTiles++;
      }
      debug(`[navmesh] Imported navmesh: maxTiles=${maxTiles}, nonEmpty=${nonEmptyTiles}`);

      return { success: true, navMesh: imported.navMesh };
    }

    // Fallback: main thread generation (tiled)
    const result = generateTiledNavMesh(positions, indices, {
      ...navConfig,
      offMeshConnections: jumpLinks,
    });

    if (!result.success || !result.navMesh) {
      return { success: false };
    }

    // Extract debug geometry directly (no export/import lossiness on main thread)
    const [dbgPos, dbgIdx] = result.navMesh.getDebugNavMesh();
    this.debugPositions = dbgPos;
    this.debugIndices = dbgIdx;

    return { success: true, navMesh: result.navMesh };
  }

  async generateFromScene(scene: THREE.Scene, center?: Position): Promise<boolean> {
    if (this.isGenerating && this.generationPromise) {
      debug("[navmesh] Generation already in progress, queuing re-generation");
      this.pendingCenter = center;
      this.hasPendingGeneration = true;
      return new Promise<boolean>((resolve) => {
        this.pendingResolvers.push(resolve);
      });
    }

    this.isGenerating = true;
    const t0 = Date.now();
    const doGenerate = async (): Promise<boolean> => {
      try {
        if (!this.initialized) {
          await this.init();
        }

        const tInit = Date.now();

        scene.updateMatrixWorld(true);

        let regionBox: THREE.Box3 | null = null;
        if (center) {
          const yHalf = 15;
          regionBox = new THREE.Box3(
            new THREE.Vector3(
              center.x - REGION_HALF_SIZE,
              center.y - yHalf,
              center.z - REGION_HALF_SIZE,
            ),
            new THREE.Vector3(
              center.x + REGION_HALF_SIZE,
              center.y + yHalf,
              center.z + REGION_HALF_SIZE,
            ),
          );
        }

        const allMeshes: THREE.Mesh[] = [];
        scene.traverse((obj) => {
          if ((obj as THREE.Mesh).isMesh) {
            allMeshes.push(obj as THREE.Mesh);
          }
        });

        if (allMeshes.length === 0) {
          console.warn("[navmesh] No meshes found in scene");
          return false;
        }

        const tTraverse = Date.now();

        const { perMesh: filteredPerMesh, changed: geometryChanged } =
          this.geometryCache.getFilteredGeometry(allMeshes, regionBox, MIN_MESH_XZ);

        const tFilter = Date.now();

        const regionMoved =
          !center ||
          !this.regionCenter ||
          Math.abs(center.x - this.regionCenter.x) > 0.5 ||
          Math.abs(center.z - this.regionCenter.z) > 0.5;

        if (!geometryChanged && !regionMoved && this.navMesh) {
          debug("[navmesh] Geometry and region unchanged, skipping rebuild");
          return true;
        }

        if (filteredPerMesh.length === 0) {
          console.warn("[navmesh] No meshes after filtering");
          return false;
        }

        const [positions, indices] = this.geometryCache.mergeGeometry(filteredPerMesh);

        const tMerge = Date.now();

        let finalPositions: Float32Array;
        let finalIndices: Uint32Array;

        if (regionBox) {
          const clippedPositions: number[] = [];
          const clippedIndices: number[] = [];
          const vertexMap = new Map<number, number>();
          const min = regionBox.min;
          const max = regionBox.max;

          for (let i = 0; i < indices.length; i += 3) {
            const i0 = indices[i];
            const i1 = indices[i + 1];
            const i2 = indices[i + 2];

            const v0In = isVertexInBox(positions, i0, min, max);
            const v1In = isVertexInBox(positions, i1, min, max);
            const v2In = isVertexInBox(positions, i2, min, max);

            if (!v0In && !v1In && !v2In) continue;

            for (const origIdx of [i0, i1, i2]) {
              if (!vertexMap.has(origIdx)) {
                const newIdx = clippedPositions.length / 3;
                vertexMap.set(origIdx, newIdx);
                clippedPositions.push(
                  positions[origIdx * 3],
                  positions[origIdx * 3 + 1],
                  positions[origIdx * 3 + 2],
                );
              }
              clippedIndices.push(vertexMap.get(origIdx)!);
            }
          }

          // Inject synthetic ground grid within the region
          if (filteredPerMesh.some((m) => m.mesh.name === "ground-plane")) {
            const groundY = 0;
            const step = JUMP_GRID_CELL;
            const x0 = min.x;
            const z0 = min.z;
            const x1 = max.x;
            const z1 = max.z;

            for (let x = x0; x < x1; x += step) {
              for (let z = z0; z < z1; z += step) {
                const xEnd = Math.min(x + step, x1);
                const zEnd = Math.min(z + step, z1);

                const baseIdx = clippedPositions.length / 3;
                clippedPositions.push(
                  x,
                  groundY,
                  z,
                  xEnd,
                  groundY,
                  z,
                  xEnd,
                  groundY,
                  zEnd,
                  x,
                  groundY,
                  zEnd,
                );
                clippedIndices.push(
                  baseIdx,
                  baseIdx + 2,
                  baseIdx + 1,
                  baseIdx,
                  baseIdx + 3,
                  baseIdx + 2,
                );
              }
            }
          }

          if (clippedIndices.length === 0) {
            console.warn("[navmesh] No triangles within region after clipping");
            return false;
          }

          finalPositions = new Float32Array(clippedPositions);
          finalIndices = new Uint32Array(clippedIndices);

          debug(
            `[navmesh] Clipped to ${finalIndices.length / 3} triangles from ${filteredPerMesh.length} meshes (${indices.length / 3} total triangles)`,
          );
        } else {
          finalPositions = positions;
          finalIndices = indices;
          debug(
            `[navmesh] Generating navmesh from ${filteredPerMesh.length} meshes (${indices.length / 3} triangles)...`,
          );
        }

        // Apply maxY filter — drop triangles with all vertices above the threshold
        if (this.options.maxY !== undefined) {
          const maxYThreshold = this.options.maxY;
          const filteredIdx: number[] = [];
          for (let i = 0; i < finalIndices.length; i += 3) {
            const y0 = finalPositions[finalIndices[i] * 3 + 1];
            const y1 = finalPositions[finalIndices[i + 1] * 3 + 1];
            const y2 = finalPositions[finalIndices[i + 2] * 3 + 1];
            if (y0 <= maxYThreshold || y1 <= maxYThreshold || y2 <= maxYThreshold) {
              filteredIdx.push(finalIndices[i], finalIndices[i + 1], finalIndices[i + 2]);
            }
          }
          finalIndices = new Uint32Array(filteredIdx);
          debug(
            `[navmesh] maxY filter (${maxYThreshold}): kept ${filteredIdx.length / 3} triangles`,
          );
        }

        const tClip = Date.now();

        const jumpLinks =
          this.options.jumpLinksEnabled === false
            ? []
            : this.detectJumpLinksWithCache(finalPositions, finalIndices);

        const tJump = Date.now();

        // Apply config overrides
        const effectiveConfig = this.options.config
          ? { ...NAVMESH_CONFIG, ...this.options.config }
          : NAVMESH_CONFIG;

        const result = await this.runNavMeshGeneration(
          finalPositions,
          finalIndices,
          jumpLinks,
          effectiveConfig,
        );

        if (!result.success || !result.navMesh) {
          console.error("[navmesh] Generation failed");
          return false;
        }

        const oldNavMesh = this.navMesh;
        const oldNavMeshQuery = this.navMeshQuery;
        const newNavMeshQuery = new NavMeshQuery(result.navMesh);
        this.navMesh = result.navMesh;
        this.navMeshQuery = newNavMeshQuery;

        if (oldNavMeshQuery) {
          try {
            oldNavMeshQuery.destroy();
          } catch {
            /* already destroyed */
          }
        }
        if (oldNavMesh) {
          try {
            oldNavMesh.destroy();
          } catch {
            /* already destroyed */
          }
        }

        this.jumpFilter = new QueryFilter();
        this.jumpFilter.includeFlags = 0xffff;
        this.jumpFilter.excludeFlags = 0;
        this.jumpFilter.setAreaCost(0, 1.0);
        this.jumpFilter.setAreaCost(JUMP_AREA_TYPE, JUMP_COST_MULTIPLIER);

        if (center) {
          this.regionCenter = { ...center };
        }

        this.generation++;

        const tDone = Date.now();
        debug(
          `[navmesh] NavMesh generated in ${tDone - t0}ms — init:${tInit - t0}ms traverse:${tTraverse - tInit}ms filter:${tFilter - tTraverse}ms merge:${tMerge - tFilter}ms clip:${tClip - tMerge}ms jump:${tJump - tClip}ms recast:${tDone - tJump}ms (${filteredPerMesh.length} meshes, ${finalIndices.length / 3} tris, geometry ${geometryChanged ? "changed" : "cached"}, generation=${this.generation})`,
        );
        this.emit("ready");
        return true;
      } finally {
        this.isGenerating = false;
        this.generationPromise = null;

        if (this.hasPendingGeneration) {
          const nextCenter = this.pendingCenter;
          const resolvers = this.pendingResolvers;
          this.pendingCenter = undefined;
          this.hasPendingGeneration = false;
          this.pendingResolvers = [];
          this.generateFromScene(scene, nextCenter).then(
            (result) => {
              for (const resolve of resolvers) resolve(result);
            },
            () => {
              for (const resolve of resolvers) resolve(false);
            },
          );
        }
      }
    };
    this.generationPromise = doGenerate();
    return this.generationPromise;
  }

  private detectJumpLinksWithCache(
    positions: Float32Array,
    indices: Uint32Array,
  ): OffMeshConnectionParams[] {
    const hash = this.computeGeometryHash(positions, indices);
    if (hash === this.lastJumpLinksHash) {
      debug("[navmesh] Jump links unchanged, using cache");
      return this.lastJumpLinks;
    }

    const links = this.detectJumpLinks(positions, indices);
    this.lastJumpLinksHash = hash;
    this.lastJumpLinks = links;
    return links;
  }

  private computeGeometryHash(positions: Float32Array, indices: Uint32Array): string {
    const h = createHash("md5");
    h.update(new Uint8Array(positions.buffer, positions.byteOffset, positions.byteLength));
    h.update(new Uint8Array(indices.buffer, indices.byteOffset, indices.byteLength));
    return h.digest("hex");
  }

  private detectJumpLinks(
    positions: Float32Array,
    indices: Uint32Array,
  ): OffMeshConnectionParams[] {
    const walkableSurfaces: Array<{ cx: number; cy: number; cz: number }> = [];

    const v0 = new THREE.Vector3();
    const v1 = new THREE.Vector3();
    const v2 = new THREE.Vector3();
    const edge1 = new THREE.Vector3();
    const edge2 = new THREE.Vector3();
    const normal = new THREE.Vector3();

    for (let i = 0; i < indices.length; i += 3) {
      const i0 = indices[i];
      const i1 = indices[i + 1];
      const i2 = indices[i + 2];

      v0.set(positions[i0 * 3], positions[i0 * 3 + 1], positions[i0 * 3 + 2]);
      v1.set(positions[i1 * 3], positions[i1 * 3 + 1], positions[i1 * 3 + 2]);
      v2.set(positions[i2 * 3], positions[i2 * 3 + 1], positions[i2 * 3 + 2]);

      edge1.subVectors(v1, v0);
      edge2.subVectors(v2, v0);
      normal.crossVectors(edge1, edge2).normalize();

      if (normal.y > 0.7) {
        const cy = (v0.y + v1.y + v2.y) / 3;
        if (cy < -0.5) continue;
        walkableSurfaces.push({
          cx: (v0.x + v1.x + v2.x) / 3,
          cy,
          cz: (v0.z + v1.z + v2.z) / 3,
        });
      }
    }

    if (walkableSurfaces.length === 0) return [];

    type CellData = Array<{ x: number; y: number; z: number }>;
    const grid = new Map<string, CellData>();

    for (const s of walkableSurfaces) {
      const gx = Math.floor(s.cx / JUMP_GRID_CELL);
      const gz = Math.floor(s.cz / JUMP_GRID_CELL);
      const key = `${gx},${gz}`;
      let cell = grid.get(key);
      if (!cell) {
        cell = [];
        grid.set(key, cell);
      }
      cell.push({ x: s.cx, y: s.cy, z: s.cz });
    }

    type HeightLayer = { x: number; y: number; z: number };
    const gridLayers = new Map<string, HeightLayer[]>();

    for (const [key, points] of grid) {
      points.sort((a, b) => a.y - b.y);

      const layers: HeightLayer[] = [];
      let currentLayer = { x: points[0].x, y: points[0].y, z: points[0].z, count: 1 };

      for (let i = 1; i < points.length; i++) {
        if (points[i].y - currentLayer.y < 0.5) {
          currentLayer.x =
            (currentLayer.x * currentLayer.count + points[i].x) / (currentLayer.count + 1);
          currentLayer.y =
            (currentLayer.y * currentLayer.count + points[i].y) / (currentLayer.count + 1);
          currentLayer.z =
            (currentLayer.z * currentLayer.count + points[i].z) / (currentLayer.count + 1);
          currentLayer.count++;
        } else {
          layers.push({ x: currentLayer.x, y: currentLayer.y, z: currentLayer.z });
          currentLayer = { x: points[i].x, y: points[i].y, z: points[i].z, count: 1 };
        }
      }
      layers.push({ x: currentLayer.x, y: currentLayer.y, z: currentLayer.z });

      gridLayers.set(key, layers);
    }

    const connections: Array<{
      start: Position;
      end: Position;
      xzDist: number;
      cellPairKey: string;
    }> = [];

    const searchRadius = Math.ceil(MAX_JUMP_XZ / JUMP_GRID_CELL);
    const offsets: Array<[number, number]> = [[0, 0]];
    for (let dx = -searchRadius; dx <= searchRadius; dx++) {
      for (let dz = -searchRadius; dz <= searchRadius; dz++) {
        if (dz > 0 || (dz === 0 && dx > 0)) {
          offsets.push([dx, dz]);
        }
      }
    }

    for (const [key, layers] of gridLayers) {
      const [gxStr, gzStr] = key.split(",");
      const gx = parseInt(gxStr);
      const gz = parseInt(gzStr);

      for (const [dx, dz] of offsets) {
        const neighborKey = `${gx + dx},${gz + dz}`;
        const neighborLayers = gridLayers.get(neighborKey);
        if (!neighborLayers) continue;

        const cellPairKey = key < neighborKey ? `${key}|${neighborKey}` : `${neighborKey}|${key}`;

        for (const layerA of layers) {
          for (const layerB of neighborLayers) {
            const yDiff = Math.abs(layerA.y - layerB.y);
            if (yDiff <= WALKABLE_CLIMB || yDiff > MAX_JUMP_HEIGHT) continue;

            let startPos = { x: layerA.x, y: layerA.y, z: layerA.z };
            let endPos = { x: layerB.x, y: layerB.y, z: layerB.z };

            const GROUND_OFFSET = 2.0;
            const GROUND_Y_THRESH = 0.5;
            if (startPos.y < GROUND_Y_THRESH && endPos.y > GROUND_Y_THRESH) {
              const ddx = startPos.x - endPos.x;
              const ddz = startPos.z - endPos.z;
              const dd = Math.sqrt(ddx * ddx + ddz * ddz);
              if (dd < 0.1) {
                const cellCenterX = (gx + 0.5) * JUMP_GRID_CELL;
                const cellCenterZ = (gz + 0.5) * JUMP_GRID_CELL;
                const toCenterX = cellCenterX - endPos.x;
                const toCenterZ = cellCenterZ - endPos.z;
                const tcLen = Math.sqrt(toCenterX * toCenterX + toCenterZ * toCenterZ);
                if (tcLen > 0.01) {
                  startPos = {
                    x: endPos.x - (toCenterX / tcLen) * GROUND_OFFSET,
                    y: startPos.y,
                    z: endPos.z - (toCenterZ / tcLen) * GROUND_OFFSET,
                  };
                } else {
                  startPos = {
                    x: startPos.x + GROUND_OFFSET,
                    y: startPos.y,
                    z: startPos.z,
                  };
                }
              } else {
                startPos = {
                  x: startPos.x + (ddx / dd) * GROUND_OFFSET,
                  y: startPos.y,
                  z: startPos.z + (ddz / dd) * GROUND_OFFSET,
                };
              }
            } else if (endPos.y < GROUND_Y_THRESH && startPos.y > GROUND_Y_THRESH) {
              const ddx = endPos.x - startPos.x;
              const ddz = endPos.z - startPos.z;
              const dd = Math.sqrt(ddx * ddx + ddz * ddz);
              if (dd < 0.1) {
                const cellCenterX = (gx + dx + 0.5) * JUMP_GRID_CELL;
                const cellCenterZ = (gz + dz + 0.5) * JUMP_GRID_CELL;
                const toCenterX = cellCenterX - startPos.x;
                const toCenterZ = cellCenterZ - startPos.z;
                const tcLen = Math.sqrt(toCenterX * toCenterX + toCenterZ * toCenterZ);
                if (tcLen > 0.01) {
                  endPos = {
                    x: startPos.x - (toCenterX / tcLen) * GROUND_OFFSET,
                    y: endPos.y,
                    z: startPos.z - (toCenterZ / tcLen) * GROUND_OFFSET,
                  };
                } else {
                  endPos = { x: endPos.x + GROUND_OFFSET, y: endPos.y, z: endPos.z };
                }
              } else {
                endPos = {
                  x: endPos.x + (ddx / dd) * GROUND_OFFSET,
                  y: endPos.y,
                  z: endPos.z + (ddz / dd) * GROUND_OFFSET,
                };
              }
            }

            const xzDist = Math.sqrt((startPos.x - endPos.x) ** 2 + (startPos.z - endPos.z) ** 2);
            if (xzDist > MAX_JUMP_XZ) continue;

            connections.push({ start: startPos, end: endPos, xzDist, cellPairKey });
          }
        }
      }
    }

    // Deduplicate
    const pairMap = new Map<string, typeof connections>();
    for (const conn of connections) {
      let arr = pairMap.get(conn.cellPairKey);
      if (!arr) {
        arr = [];
        pairMap.set(conn.cellPairKey, arr);
      }
      arr.push(conn);
    }

    const deduplicated: typeof connections = [];
    for (const [, arr] of pairMap) {
      arr.sort((a, b) => a.xzDist - b.xzDist);
      deduplicated.push(...arr.slice(0, MAX_LINKS_PER_CELL_PAIR));
    }

    // Priority categories — elevated-to-elevated links are most important for
    // multi-level navigation, ground-to-elevated (g2e) enable climbing, and
    // ground-to-ground links are lowest priority (usually redundant with the mesh).
    const ELEVATED_Y = 1.0;
    const elevated = deduplicated.filter((c) => Math.min(c.start.y, c.end.y) > ELEVATED_Y);
    const groundToElevated = deduplicated.filter(
      (c) =>
        Math.min(c.start.y, c.end.y) <= ELEVATED_Y && Math.max(c.start.y, c.end.y) > ELEVATED_Y,
    );
    const ground = deduplicated.filter((c) => Math.max(c.start.y, c.end.y) <= ELEVATED_Y);

    elevated.sort((a, b) => a.xzDist - b.xzDist);
    groundToElevated.sort((a, b) => a.xzDist - b.xzDist);
    ground.sort((a, b) => a.xzDist - b.xzDist);

    // Reserve at least this many slots for ground-to-elevated links (climbing).
    const MIN_G2E_BUDGET = 30;
    const elevatedCap = Math.min(
      elevated.length,
      groundToElevated.length > 0
        ? MAX_JUMP_LINKS - Math.min(groundToElevated.length, MIN_G2E_BUDGET)
        : MAX_JUMP_LINKS,
    );
    const g2eBudget = Math.max(0, MAX_JUMP_LINKS - elevatedCap);
    const groundBudget = Math.max(0, g2eBudget - Math.min(groundToElevated.length, g2eBudget));
    const cappedElevated = elevated.slice(0, elevatedCap);
    const cappedG2e = groundToElevated.slice(0, g2eBudget);
    const cappedGround = ground.slice(0, groundBudget);
    const capped = [...cappedElevated, ...cappedG2e, ...cappedGround];

    debug(
      `[navmesh] Jump links: ${cappedElevated.length} elevated + ${cappedG2e.length} g2e + ${cappedGround.length} ground = ${capped.length} (from ${deduplicated.length} deduped, ${connections.length} raw)`,
    );

    return capped.map((conn) => ({
      startPosition: conn.start,
      endPosition: conn.end,
      radius: 1.5,
      bidirectional: true,
      area: JUMP_AREA_TYPE,
      flags: 1,
    }));
  }

  computePath(from: Position, to: Position): Array<Position> | null {
    if (!this.navMeshQuery) return null;

    const result = this.navMeshQuery.computePath(from, to, {
      halfExtents: { x: 2, y: 4, z: 2 },
      filter: this.jumpFilter ?? undefined,
    });

    if (!result.success || !result.path || result.path.length === 0) {
      return null;
    }

    const path = result.path.map((p: { x: number; y: number; z: number }) => ({
      x: p.x,
      y: Math.max(p.y, 0),
      z: p.z,
    }));

    const last = path[path.length - 1];
    const dxEnd = last.x - to.x;
    const dzEnd = last.z - to.z;
    const xzDistToTarget = Math.sqrt(dxEnd * dxEnd + dzEnd * dzEnd);
    if (xzDistToTarget > 5.0) {
      return null;
    }

    return path;
  }

  computePathWithJumpInfo(from: Position, to: Position): PathWithJumpInfo | null {
    const path = this.computePath(from, to);
    if (path) {
      const last = path[path.length - 1];
      const dyEnd = Math.abs(last.y - to.y);

      if (dyEnd > WALKABLE_CLIMB) {
        path.push({ ...to });
        const jumpIndices = new Set<number>();
        for (let i = 1; i < path.length; i++) {
          const yDiff = Math.abs(path[i].y - path[i - 1].y);
          if (yDiff > WALKABLE_CLIMB) {
            jumpIndices.add(i);
          }
        }
        return { path, jumpIndices };
      }

      const jumpIndices = new Set<number>();
      for (let i = 1; i < path.length; i++) {
        const yDiff = Math.abs(path[i].y - path[i - 1].y);
        if (yDiff > WALKABLE_CLIMB) {
          jumpIndices.add(i);
        }
      }
      return { path, jumpIndices };
    }

    // Fallback: compose a walk-then-jump path
    const nearest = this.findNearestPoint(to);
    if (!nearest) return null;

    const yDiffToTarget = Math.abs(to.y - nearest.y);
    const xzDistToTarget = Math.sqrt((to.x - nearest.x) ** 2 + (to.z - nearest.z) ** 2);
    if (yDiffToTarget < WALKABLE_CLIMB && xzDistToTarget < 1.0) {
      return null;
    }

    let approachPoint = nearest;
    const dirX = from.x - nearest.x;
    const dirZ = from.z - nearest.z;
    const dirLen = Math.sqrt(dirX * dirX + dirZ * dirZ);

    if (dirLen > 0.5) {
      const offsetDist = Math.max(1.0, yDiffToTarget * 0.5);
      const candidate: Position = {
        x: nearest.x + (dirX / dirLen) * offsetDist,
        y: nearest.y,
        z: nearest.z + (dirZ / dirLen) * offsetDist,
      };
      const snapped = this.findNearestPoint(candidate);
      if (snapped) approachPoint = snapped;
    }

    const pathToApproach = this.computePath(from, approachPoint);
    if (!pathToApproach || pathToApproach.length === 0) return null;

    pathToApproach.push(to);
    const jumpIndices = new Set<number>();
    jumpIndices.add(pathToApproach.length - 1);

    return { path: pathToApproach, jumpIndices };
  }

  computeEdgePoint(from: Position, to: Position): Position | null {
    if (!this.navMeshQuery || !this.regionCenter) return null;

    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist < 0.01) return null;

    const scale = (REGION_HALF_SIZE * 0.8) / dist;
    const edgeTarget: Position = {
      x: from.x + dx * scale,
      y: from.y,
      z: from.z + dz * scale,
    };

    return this.findNearestPoint(edgeTarget);
  }

  findNearestPoint(position: Position): Position | null {
    if (!this.navMeshQuery) return null;

    const result = this.navMeshQuery.findClosestPoint(position, {
      halfExtents: { x: 2, y: 4, z: 2 },
    });

    if (!result.success) return null;
    return { x: result.point.x, y: result.point.y, z: result.point.z };
  }

  findRandomPoint(): Position | null {
    if (!this.navMeshQuery) return null;

    const result = this.navMeshQuery.findRandomPoint();
    if (!result.success) return null;
    return {
      x: result.randomPoint.x,
      y: result.randomPoint.y,
      z: result.randomPoint.z,
    };
  }

  shouldRegenerate(pos: Position): boolean {
    if (!this.regionCenter) return false;
    const dx = pos.x - this.regionCenter.x;
    const dz = pos.z - this.regionCenter.z;
    return Math.sqrt(dx * dx + dz * dz) > REGEN_DISTANCE_THRESHOLD;
  }

  isWithinRegion(point: Position): boolean {
    if (!this.regionCenter) return false;
    return (
      Math.abs(point.x - this.regionCenter.x) <= REGION_HALF_SIZE &&
      Math.abs(point.z - this.regionCenter.z) <= REGION_HALF_SIZE
    );
  }

  get currentRegionCenter(): Position | null {
    return this.regionCenter ? { ...this.regionCenter } : null;
  }

  /**
   * Return navmesh geometry, jump links, and region info for debug visualization.
   */
  getDebugData(): {
    positions: number[];
    indices: number[];
    jumpLinks: Array<{
      start: Position;
      end: Position;
      bidirectional: boolean;
    }>;
    placementSpots: PlacementSpot[];
    regionCenter: Position | null;
    regionHalfSize: number;
    generation: number;
  } | null {
    if (!this.navMesh) return null;

    return {
      positions: this.debugPositions,
      indices: this.debugIndices,
      jumpLinks: this.lastJumpLinks.map((link) => ({
        start: {
          x: link.startPosition.x,
          y: link.startPosition.y,
          z: link.startPosition.z,
        },
        end: {
          x: link.endPosition.x,
          y: link.endPosition.y,
          z: link.endPosition.z,
        },
        bidirectional: link.bidirectional,
      })),
      placementSpots: this.placementSpots,
      regionCenter: this.regionCenter ? { ...this.regionCenter } : null,
      regionHalfSize: REGION_HALF_SIZE,
      generation: this.generation,
    };
  }

  computePlacementSpots(
    agentPos: Position,
    options?: {
      minWidth?: number;
      minDepth?: number;
      maxResults?: number;
    },
  ): PlacementSpot[] {
    const minWidth = options?.minWidth ?? 2;
    const minDepth = options?.minDepth ?? 2;
    const maxResults = options?.maxResults ?? 8;

    if (!this.navMeshQuery || !this.regionCenter) {
      this.placementSpots = [];
      return [];
    }

    const center = this.regionCenter;
    const cellSize = PLACEMENT_GRID_CELL;

    // --- Step 1: Grid sampling ---
    type GridCell = {
      gx: number;
      gz: number;
      centerX: number;
      centerZ: number;
      surfaceY: number;
      walkable: boolean;
      yRange: number;
      avgNormalY: number;
    };

    const gridCells = new Map<string, GridCell>();
    const halfSize = REGION_HALF_SIZE;

    for (let x = center.x - halfSize; x < center.x + halfSize; x += cellSize) {
      for (let z = center.z - halfSize; z < center.z + halfSize; z += cellSize) {
        const cx = x + cellSize / 2;
        const cz = z + cellSize / 2;
        const nearest = this.findNearestPoint({ x: cx, y: agentPos.y, z: cz });

        if (nearest) {
          const dx = Math.abs(nearest.x - cx);
          const dz = Math.abs(nearest.z - cz);
          if (dx <= 1.0 && dz <= 1.0) {
            const gx = Math.floor(x / cellSize);
            const gz = Math.floor(z / cellSize);
            const key = `${gx},${gz}`;
            gridCells.set(key, {
              gx,
              gz,
              centerX: cx,
              centerZ: cz,
              surfaceY: nearest.y,
              walkable: true,
              yRange: 0,
              avgNormalY: 1.0,
            });
          }
        }
      }
    }

    debug(`[navmesh] Placement step 1: ${gridCells.size} walkable grid cells`);

    if (gridCells.size === 0) {
      this.placementSpots = [];
      return [];
    }

    // --- Step 2: Flatness per cell ---
    const dbgPositions = this.debugPositions;
    const dbgIndices = this.debugIndices;

    if (dbgPositions.length > 0 && dbgIndices.length > 0) {
      const cellNormals = new Map<
        string,
        { sumNy: number; count: number; minY: number; maxY: number }
      >();

      const v0 = new THREE.Vector3();
      const v1 = new THREE.Vector3();
      const v2 = new THREE.Vector3();
      const e1 = new THREE.Vector3();
      const e2 = new THREE.Vector3();
      const n = new THREE.Vector3();

      for (let i = 0; i < dbgIndices.length; i += 3) {
        const i0 = dbgIndices[i];
        const i1 = dbgIndices[i + 1];
        const i2 = dbgIndices[i + 2];

        v0.set(dbgPositions[i0 * 3], dbgPositions[i0 * 3 + 1], dbgPositions[i0 * 3 + 2]);
        v1.set(dbgPositions[i1 * 3], dbgPositions[i1 * 3 + 1], dbgPositions[i1 * 3 + 2]);
        v2.set(dbgPositions[i2 * 3], dbgPositions[i2 * 3 + 1], dbgPositions[i2 * 3 + 2]);

        e1.subVectors(v1, v0);
        e2.subVectors(v2, v0);
        n.crossVectors(e1, e2).normalize();

        const tcx = (v0.x + v1.x + v2.x) / 3;
        const tcz = (v0.z + v1.z + v2.z) / 3;
        const gx = Math.floor(tcx / cellSize);
        const gz = Math.floor(tcz / cellSize);
        const key = `${gx},${gz}`;

        const triMinY = Math.min(v0.y, v1.y, v2.y);
        const triMaxY = Math.max(v0.y, v1.y, v2.y);

        let acc = cellNormals.get(key);
        if (!acc) {
          acc = { sumNy: 0, count: 0, minY: triMinY, maxY: triMaxY };
          cellNormals.set(key, acc);
        }
        acc.sumNy += Math.abs(n.y);
        acc.count++;
        acc.minY = Math.min(acc.minY, triMinY);
        acc.maxY = Math.max(acc.maxY, triMaxY);
      }

      for (const [key, acc] of cellNormals) {
        const cell = gridCells.get(key);
        if (cell) {
          cell.avgNormalY = acc.sumNy / acc.count;
          cell.yRange = acc.maxY - acc.minY;
        }
      }
    }

    // --- Step 4: Rectangle growing ---
    const usedCells = new Set<string>();
    type Candidate = {
      centerX: number;
      centerZ: number;
      width: number;
      depth: number;
      surfaceY: number;
      yRange: number;
      avgNormalY: number;
      height?: number;
    };
    const candidates: Candidate[] = [];

    const sortedCells = Array.from(gridCells.values())
      .filter((c) => c.walkable && c.avgNormalY > 0.7 && c.yRange < PLACEMENT_SLOPE_THRESHOLD)
      .sort((a, b) => {
        const da = (a.centerX - agentPos.x) ** 2 + (a.centerZ - agentPos.z) ** 2;
        const db = (b.centerX - agentPos.x) ** 2 + (b.centerZ - agentPos.z) ** 2;
        return da - db;
      });

    for (const seed of sortedCells) {
      const seedKey = `${seed.gx},${seed.gz}`;
      if (usedCells.has(seedKey)) continue;

      let minGx = seed.gx;
      let maxGx = seed.gx;
      let minGz = seed.gz;
      let maxGz = seed.gz;

      const canExpand = (
        testMinGx: number,
        testMaxGx: number,
        testMinGz: number,
        testMaxGz: number,
      ): boolean => {
        for (let gx = testMinGx; gx <= testMaxGx; gx++) {
          for (let gz = testMinGz; gz <= testMaxGz; gz++) {
            const key = `${gx},${gz}`;
            const cell = gridCells.get(key);
            if (
              !cell ||
              !cell.walkable ||
              cell.avgNormalY <= 0.7 ||
              cell.yRange >= PLACEMENT_SLOPE_THRESHOLD
            ) {
              return false;
            }
          }
        }
        return true;
      };

      let expanded = true;
      while (expanded) {
        expanded = false;
        if (canExpand(maxGx + 1, maxGx + 1, minGz, maxGz)) {
          maxGx++;
          expanded = true;
        }
        if (canExpand(minGx - 1, minGx - 1, minGz, maxGz)) {
          minGx--;
          expanded = true;
        }
        if (canExpand(minGx, maxGx, maxGz + 1, maxGz + 1)) {
          maxGz++;
          expanded = true;
        }
        if (canExpand(minGx, maxGx, minGz - 1, minGz - 1)) {
          minGz--;
          expanded = true;
        }
      }

      const width = (maxGx - minGx + 1) * cellSize;
      const depth = (maxGz - minGz + 1) * cellSize;

      if (width < minWidth || depth < minDepth) continue;

      let sumY = 0;
      let totalYRange = 0;
      let sumNormalY = 0;
      let cellCount = 0;

      for (let gx = minGx; gx <= maxGx; gx++) {
        for (let gz = minGz; gz <= maxGz; gz++) {
          const key = `${gx},${gz}`;
          const cell = gridCells.get(key)!;
          sumY += cell.surfaceY;
          totalYRange = Math.max(totalYRange, cell.yRange);
          sumNormalY += cell.avgNormalY;
          cellCount++;
          usedCells.add(key);
        }
      }

      const cxCenter = ((minGx + maxGx + 1) * cellSize) / 2;
      const czCenter = ((minGz + maxGz + 1) * cellSize) / 2;

      candidates.push({
        centerX: cxCenter,
        centerZ: czCenter,
        width,
        depth,
        surfaceY: sumY / cellCount,
        yRange: totalYRange,
        avgNormalY: sumNormalY / cellCount,
        height: PLACEMENT_MAX_HEIGHT,
      });
    }

    // --- Step 5: Deduplication ---
    candidates.sort((a, b) => b.width * b.depth - a.width * a.depth);
    const deduplicated: typeof candidates = [];

    for (const cand of candidates) {
      const tooClose = deduplicated.some((existing) => {
        const dx = Math.abs(cand.centerX - existing.centerX);
        const dz = Math.abs(cand.centerZ - existing.centerZ);
        return dx < PLACEMENT_MIN_SEPARATION && dz < PLACEMENT_MIN_SEPARATION;
      });
      if (!tooClose) {
        deduplicated.push(cand);
      }
    }

    // --- Step 6: Scoring + ranking ---
    type ScoredCandidate = (typeof candidates)[0] & { score: number };
    const scored: ScoredCandidate[] = deduplicated.map((cand) => {
      const area = cand.width * cand.depth;
      let score = area;

      if (cand.yRange > PLACEMENT_GENTLE_SLOPE_THRESHOLD) {
        score *= 0.6;
      } else if (cand.yRange > PLACEMENT_FLATNESS_THRESHOLD) {
        score *= 0.8;
      }

      const agentDist = Math.sqrt(
        (cand.centerX - agentPos.x) ** 2 + (cand.centerZ - agentPos.z) ** 2,
      );
      score *= 1.0 / (1.0 + agentDist * 0.02);

      return { ...cand, score };
    });

    scored.sort((a, b) => b.score - a.score);
    const topCandidates = scored.slice(0, maxResults);

    // --- Step 7: Reachability ---
    const spots: PlacementSpot[] = topCandidates.map((cand) => {
      const spotPos: Position = { x: cand.centerX, y: cand.surfaceY, z: cand.centerZ };
      const path = this.computePath(agentPos, spotPos);
      const reachable = path !== null;

      const agentDist = Math.sqrt(
        (cand.centerX - agentPos.x) ** 2 + (cand.centerZ - agentPos.z) ** 2,
      );

      let quality: PlacementSpot["flatness"]["quality"];
      if (cand.yRange <= PLACEMENT_FLATNESS_THRESHOLD) {
        quality = "flat";
      } else if (cand.yRange <= PLACEMENT_GENTLE_SLOPE_THRESHOLD) {
        quality = "gentle_slope";
      } else if (cand.yRange <= PLACEMENT_SLOPE_THRESHOLD) {
        quality = "sloped";
      } else {
        quality = "irregular";
      }

      const avgSlopeAngle = Math.acos(Math.min(1, cand.avgNormalY)) * (180 / Math.PI);

      return {
        position: {
          x: Math.round(cand.centerX * 100) / 100,
          y: Math.round(cand.surfaceY * 100) / 100,
          z: Math.round(cand.centerZ * 100) / 100,
        },
        dimensions: {
          width: Math.round(cand.width * 100) / 100,
          depth: Math.round(cand.depth * 100) / 100,
          height: Math.round((cand.height ?? PLACEMENT_MAX_HEIGHT) * 100) / 100,
        },
        flatness: {
          yRange: Math.round(cand.yRange * 100) / 100,
          avgSlopeAngle: Math.round(avgSlopeAngle * 10) / 10,
          quality,
        },
        surfaceY: Math.round(cand.surfaceY * 100) / 100,
        reachable,
        distanceFromAgent: Math.round(agentDist * 100) / 100,
      };
    });

    this.placementSpots = spots;
    debug(
      `[navmesh] Computed ${spots.length} placement spots (${candidates.length} candidates, ${deduplicated.length} after dedup)`,
    );
    return spots;
  }

  dispose(): void {
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.resolve({ success: false, cancelled: true });
    }
    this.pendingRequests.clear();
    if (this.worker) {
      this.worker.removeAllListeners("message");
      this.worker.removeAllListeners("error");
      this.worker.terminate();
      this.worker = null;
      this.workerReady = false;
      debug("[navmesh] Worker terminated");
    }
    if (this.navMesh) {
      try {
        this.navMesh.destroy();
      } catch {
        /* already destroyed */
      }
      this.navMesh = null;
    }
    if (this.navMeshQuery) {
      try {
        this.navMeshQuery.destroy();
      } catch {
        /* already destroyed */
      }
      this.navMeshQuery = null;
    }
    this.jumpFilter = null;
    this.geometryCache.invalidateAll();
  }

  async regenerate(scene: THREE.Scene, center?: Position): Promise<boolean> {
    return this.generateFromScene(scene, center);
  }

  async waitForReady(timeoutMs: number = 30000): Promise<boolean> {
    if (this.isReady) return true;
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const onReady = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(true);
      };
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        this.removeListener("ready", onReady);
        resolve(false);
      }, timeoutMs);
      this.once("ready", onReady);
    });
  }

  get isReady(): boolean {
    return this.navMeshQuery !== null;
  }
}

function isVertexInBox(
  positions: Float32Array,
  index: number,
  min: THREE.Vector3,
  max: THREE.Vector3,
): boolean {
  const x = positions[index * 3];
  const y = positions[index * 3 + 1];
  const z = positions[index * 3 + 2];
  return x >= min.x && x <= max.x && y >= min.y && y <= max.y && z >= min.z && z <= max.z;
}
