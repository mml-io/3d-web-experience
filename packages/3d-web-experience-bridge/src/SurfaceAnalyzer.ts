import * as THREE from "three";

import type { HeadlessMMLScene } from "./HeadlessMMLScene";
import type { NavMeshManager, Position } from "./NavMeshManager";

export type SurfaceSpot = {
  surfaceNodeId: number;
  surfaceTag: string;
  surfaceClass?: string;
  surfaceId?: string;
  position: Position;
  surfaceDimensions: { width: number; depth: number };
  availableArea: { width: number; depth: number };
  surfaceY: number;
  occupancy: {
    count: number;
    items: Array<{
      nodeId: number;
      tag: string;
      pos: [number, number, number];
    }>;
  };
  distanceFromAgent: number;
  reachable: boolean;
  score: number;
};

export type SurfaceSpotOptions = {
  surfaceClass?: string;
  minWidth?: number;
  minDepth?: number;
  maxResults?: number;
  radius?: number;
  /** Minimum normal.y for upward-facing detection (default: 0.85) */
  minUpDot?: number;
};

// Minimum normal.y for a triangle to be considered upward-facing (~32 deg).
// Stricter than NavMeshManager's walkable surface threshold (0.7) because
// placement surfaces need to be more reliably flat than merely walkable surfaces.
const MIN_UP_DOT = 0.85;
// Grid cell size for free-space computation on surfaces
const SURFACE_GRID_CELL = 0.1;
// Merge triangles within this Y tolerance into the same surface layer
const LAYER_MERGE_Y = 0.3;
// Minimum number of upward-facing triangles to form a surface
const MIN_SURFACE_TRIS = 2;
// Maximum dimension for a single surface — anything larger is terrain, not furniture
const MAX_SURFACE_DIM = 10;
// XZ clustering radius: triangles further apart than this form separate surfaces
const XZ_CLUSTER_RADIUS = 2.0;
// Hard minimum surface dimensions — anything smaller is not useful for placement
const HARD_MIN_DIM = 0.2;
// Occupant must rest within this Y distance above the surface top to count
const OCCUPANT_REST_TOLERANCE = 0.3;

/**
 * Discover horizontal surfaces in the MML scene by analyzing actual geometry.
 * Primary focus: m-model elements (opaque GLB geometry where the agent can't
 * reason about surface positions without triangle-level analysis).
 * Also supports m-cube and m-plane primitives as a bonus.
 *
 * For each candidate element, traverses child meshes, finds upward-facing
 * triangles, clusters them by height into distinct surfaces, computes
 * occupancy and free space, and returns scored/ranked placement spots.
 */
export function findSurfaceSpots(
  headlessScene: HeadlessMMLScene,
  navMeshManager: NavMeshManager,
  agentPos: Position,
  options: SurfaceSpotOptions = {},
): SurfaceSpot[] {
  const {
    surfaceClass,
    minWidth = 0.2,
    minDepth = 0.2,
    maxResults = 10,
    radius = 20,
    minUpDot = MIN_UP_DOT,
  } = options;

  const round = (v: number) => Math.round(v * 100) / 100;
  const agentVec = new THREE.Vector3(agentPos.x, agentPos.y, agentPos.z);

  // --- Step 1: Enumerate candidate elements ---
  let selector: string;
  if (surfaceClass) {
    selector = [
      `m-model[class*="${surfaceClass}"]`,
      `m-cube[class*="${surfaceClass}"]`,
      `m-plane[class*="${surfaceClass}"]`,
    ].join(", ");
  } else {
    selector = "m-model, m-cube, m-plane";
  }

  const candidateEls = headlessScene.queryAll(selector);
  if (candidateEls.length === 0) return [];

  // --- Step 2: Collect all MML elements for occupancy detection ---
  const allOccupantEls = headlessScene.queryAll(
    "m-cube, m-sphere, m-cylinder, m-model, m-label, m-image",
  );

  type OccupantInfo = {
    nodeId: number;
    tag: string;
    worldPos: THREE.Vector3;
    bbox: THREE.Box3;
  };

  const occupants: OccupantInfo[] = [];
  for (let i = 0; i < allOccupantEls.length; i++) {
    try {
      const el = allOccupantEls[i] as any;
      if (!el.getContainer) continue;
      const container = el.getContainer();
      container.updateMatrixWorld(true);
      const wp = new THREE.Vector3();
      container.getWorldPosition(wp);
      const bbox = new THREE.Box3().setFromObject(container);
      const nodeId = getNodeId(headlessScene, el);
      occupants.push({ nodeId, tag: el.tagName?.toLowerCase() ?? "unknown", worldPos: wp, bbox });
    } catch {
      // Skip elements without containers
    }
  }

  // --- Step 3: Process each candidate ---
  const candidates: SurfaceSpot[] = [];

  for (let i = 0; i < candidateEls.length; i++) {
    try {
      const el = candidateEls[i] as any;
      if (!el.getContainer) continue;

      const container = el.getContainer();
      container.updateMatrixWorld(true);

      const tag = el.tagName?.toLowerCase() ?? "";
      const elNodeId = getNodeId(headlessScene, el);

      // Quick distance pre-filter using element center
      const elCenter = new THREE.Vector3();
      const elBbox = new THREE.Box3().setFromObject(container);
      elBbox.getCenter(elCenter);
      if (agentVec.distanceTo(elCenter) > radius + 10) continue;

      // --- Extract surfaces via triangle analysis ---
      let surfaces: DetectedSurface[];

      if (tag === "m-model") {
        surfaces = extractSurfacesFromMeshes(container, agentVec, radius, minUpDot);
      } else {
        const s = extractSurfaceFromPrimitive(container, minUpDot);
        surfaces = s ? [s] : [];
      }

      if (surfaces.length === 0) continue;

      // --- Process each detected surface ---
      for (const surface of surfaces) {
        if (surface.topY < 0.3 || surface.topY > 5.0) continue;

        const effectiveMinW = Math.max(minWidth, HARD_MIN_DIM);
        const effectiveMinD = Math.max(minDepth, HARD_MIN_DIM);
        if (surface.width < effectiveMinW || surface.depth < effectiveMinD) continue;

        const surfCenter = new THREE.Vector3(surface.centerX, surface.topY, surface.centerZ);
        const distFromAgent = agentVec.distanceTo(surfCenter);
        if (distFromAgent > radius) continue;

        // --- Occupancy detection ---
        const surfaceItems: SurfaceSpot["occupancy"]["items"] = [];
        const occupiedBboxes: THREE.Box3[] = [];

        const inset = 0.05;
        const surfXMin = surface.minX + inset;
        const surfXMax = surface.maxX - inset;
        const surfZMin = surface.minZ + inset;
        const surfZMax = surface.maxZ - inset;

        for (const occ of occupants) {
          if (occ.nodeId === elNodeId) continue;

          const op = occ.worldPos;
          if (op.x < surfXMin || op.x > surfXMax) continue;
          if (op.z < surfZMin || op.z > surfZMax) continue;

          const occBottom = occ.bbox.min.y;
          if (occBottom < surface.topY - 0.1) continue;
          if (occBottom > surface.topY + OCCUPANT_REST_TOLERANCE) continue;

          surfaceItems.push({
            nodeId: occ.nodeId,
            tag: occ.tag,
            pos: [round(op.x), round(op.y), round(op.z)],
          });
          occupiedBboxes.push(occ.bbox);
        }

        // --- Available area computation ---
        const { availWidth, availDepth, placementX, placementZ } = computeFreeSpace(
          surface,
          occupiedBboxes,
          minWidth,
          minDepth,
        );

        // --- Scoring ---
        const availableArea = availWidth * availDepth;
        let score = Math.max(availableArea, 0.01);

        const elClass = el.getAttribute("class");
        if (elClass) score *= 1.5;

        const totalArea = surface.width * surface.depth;
        const occupiedArea = totalArea - availableArea;
        if (totalArea > 0 && occupiedArea / totalArea > 0.5) score *= 0.7;

        score *= 1.0 / (1.0 + distFromAgent * 0.05);

        // --- Reachability check ---
        let reachable = false;
        if (navMeshManager.isReady) {
          const groundTarget: Position = { x: surface.centerX, y: 0, z: surface.centerZ };
          const path = navMeshManager.computePath(agentPos, groundTarget);
          if (path) {
            const lastPt = path[path.length - 1];
            const dxEdge = Math.max(0, Math.abs(lastPt.x - surface.centerX) - surface.width / 2);
            const dzEdge = Math.max(0, Math.abs(lastPt.z - surface.centerZ) - surface.depth / 2);
            reachable = Math.sqrt(dxEdge * dxEdge + dzEdge * dzEdge) < 2.0;
          }
        }

        candidates.push({
          surfaceNodeId: elNodeId,
          surfaceTag: tag,
          surfaceClass: elClass ?? undefined,
          surfaceId: el.getAttribute("id") ?? undefined,
          position: {
            x: round(placementX),
            y: round(surface.topY),
            z: round(placementZ),
          },
          surfaceDimensions: {
            width: round(surface.width),
            depth: round(surface.depth),
          },
          availableArea: {
            width: round(availWidth),
            depth: round(availDepth),
          },
          surfaceY: round(surface.topY),
          occupancy: {
            count: surfaceItems.length,
            items: surfaceItems,
          },
          distanceFromAgent: round(distFromAgent),
          reachable,
          score: round(score),
        });
      }
    } catch {
      // Skip elements that fail processing
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates.slice(0, maxResults);
}

// ---------------------------------------------------------------------------
// Internal types and helpers
// ---------------------------------------------------------------------------

type DetectedSurface = {
  topY: number;
  centerX: number;
  centerZ: number;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  width: number;
  depth: number;
  triCount: number;
};

function extractSurfacesFromMeshes(
  container: THREE.Object3D,
  agentPos: THREE.Vector3,
  searchRadius: number,
  minUpDot: number,
): DetectedSurface[] {
  const upTris: Array<{ cx: number; cy: number; cz: number }> = [];

  const v0 = new THREE.Vector3();
  const v1 = new THREE.Vector3();
  const v2 = new THREE.Vector3();
  const edge1 = new THREE.Vector3();
  const edge2 = new THREE.Vector3();
  const normal = new THREE.Vector3();

  container.traverse((obj) => {
    if (!(obj as THREE.Mesh).isMesh) return;
    const mesh = obj as THREE.Mesh;
    const geo = mesh.geometry;
    if (!geo) return;

    const posAttr = geo.getAttribute("position");
    if (!posAttr) return;

    mesh.updateMatrixWorld(true);
    const matrixWorld = mesh.matrixWorld;

    const indices = geo.index;
    const triCount = indices ? indices.count / 3 : posAttr.count / 3;

    for (let t = 0; t < triCount; t++) {
      let i0: number, i1: number, i2: number;
      if (indices) {
        i0 = indices.getX(t * 3);
        i1 = indices.getX(t * 3 + 1);
        i2 = indices.getX(t * 3 + 2);
      } else {
        i0 = t * 3;
        i1 = t * 3 + 1;
        i2 = t * 3 + 2;
      }

      v0.fromBufferAttribute(posAttr, i0).applyMatrix4(matrixWorld);
      v1.fromBufferAttribute(posAttr, i1).applyMatrix4(matrixWorld);
      v2.fromBufferAttribute(posAttr, i2).applyMatrix4(matrixWorld);

      edge1.subVectors(v1, v0);
      edge2.subVectors(v2, v0);
      normal.crossVectors(edge1, edge2).normalize();

      if (normal.y > minUpDot) {
        const cx = (v0.x + v1.x + v2.x) / 3;
        const cy = (v0.y + v1.y + v2.y) / 3;
        const cz = (v0.z + v1.z + v2.z) / 3;

        if (cy < 0.3 || cy > 5.0) continue;

        const dx = cx - agentPos.x;
        const dz = cz - agentPos.z;
        if (dx * dx + dz * dz > searchRadius * searchRadius) continue;

        upTris.push({ cx, cy, cz });
      }
    }
  });

  if (upTris.length < MIN_SURFACE_TRIS) return [];

  upTris.sort((a, b) => a.cy - b.cy);

  type Layer = { tris: typeof upTris; avgY: number };
  const layers: Layer[] = [];
  let currentLayer: Layer = { tris: [upTris[0]], avgY: upTris[0].cy };

  for (let i = 1; i < upTris.length; i++) {
    if (upTris[i].cy - currentLayer.avgY < LAYER_MERGE_Y) {
      currentLayer.tris.push(upTris[i]);
      currentLayer.avgY =
        currentLayer.tris.reduce((s, t) => s + t.cy, 0) / currentLayer.tris.length;
    } else {
      layers.push(currentLayer);
      currentLayer = { tris: [upTris[i]], avgY: upTris[i].cy };
    }
  }
  layers.push(currentLayer);

  const surfaces: DetectedSurface[] = [];

  for (const layer of layers) {
    if (layer.tris.length < MIN_SURFACE_TRIS) continue;

    const clusters = clusterByXZ(layer.tris, XZ_CLUSTER_RADIUS);

    for (const cluster of clusters) {
      if (cluster.length < MIN_SURFACE_TRIS) continue;

      let minX = Infinity,
        maxX = -Infinity;
      let minZ = Infinity,
        maxZ = -Infinity;

      for (const tri of cluster) {
        if (tri.cx < minX) minX = tri.cx;
        if (tri.cx > maxX) maxX = tri.cx;
        if (tri.cz < minZ) minZ = tri.cz;
        if (tri.cz > maxZ) maxZ = tri.cz;
      }

      const width = maxX - minX;
      const depth = maxZ - minZ;

      if (width < 0.1 || depth < 0.1) continue;
      if (width > MAX_SURFACE_DIM || depth > MAX_SURFACE_DIM) continue;

      surfaces.push({
        topY: layer.avgY,
        centerX: (minX + maxX) / 2,
        centerZ: (minZ + maxZ) / 2,
        minX,
        maxX,
        minZ,
        maxZ,
        width,
        depth,
        triCount: cluster.length,
      });
    }
  }

  return surfaces;
}

/**
 * Cluster triangles by XZ proximity using a spatial grid and Union-Find.
 * Triangles are bucketed into grid cells of size `radius`, then only pairs
 * within the same or adjacent cells are compared — O(n) expected time
 * instead of O(n^2) pairwise checks.
 */
function clusterByXZ(
  tris: Array<{ cx: number; cy: number; cz: number }>,
  radius: number,
): Array<Array<{ cx: number; cy: number; cz: number }>> {
  const n = tris.length;
  if (n === 0) return [];

  const cellSize = radius;
  const cellMap = new Map<string, number[]>();

  for (let i = 0; i < n; i++) {
    const gx = Math.floor(tris[i].cx / cellSize);
    const gz = Math.floor(tris[i].cz / cellSize);
    const key = `${gx},${gz}`;
    let arr = cellMap.get(key);
    if (!arr) {
      arr = [];
      cellMap.set(key, arr);
    }
    arr.push(i);
  }

  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;

  const find = (a: number): number => {
    while (parent[a] !== a) {
      parent[a] = parent[parent[a]];
      a = parent[a];
    }
    return a;
  };
  const union = (a: number, b: number) => {
    const ra = find(a),
      rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };

  for (const [key, indices] of cellMap) {
    // Union all triangles within the same cell
    for (let i = 1; i < indices.length; i++) {
      union(indices[0], indices[i]);
    }

    // Union with triangles in adjacent cells
    const [gxStr, gzStr] = key.split(",");
    const gx = parseInt(gxStr);
    const gz = parseInt(gzStr);

    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        if (dx === 0 && dz === 0) continue;
        const neighborKey = `${gx + dx},${gz + dz}`;
        const neighborIndices = cellMap.get(neighborKey);
        if (neighborIndices) {
          union(indices[0], neighborIndices[0]);
        }
      }
    }
  }

  const groups = new Map<number, Array<{ cx: number; cy: number; cz: number }>>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    let arr = groups.get(root);
    if (!arr) {
      arr = [];
      groups.set(root, arr);
    }
    arr.push(tris[i]);
  }
  return [...groups.values()];
}

function extractSurfaceFromPrimitive(
  container: THREE.Object3D,
  minUpDot: number,
): DetectedSurface | null {
  const up = new THREE.Vector3(0, 1, 0);
  up.transformDirection(container.matrixWorld);
  if (up.dot(new THREE.Vector3(0, 1, 0)) < minUpDot) return null;

  const bbox = new THREE.Box3().setFromObject(container);
  const size = new THREE.Vector3();
  bbox.getSize(size);

  if (size.y >= Math.max(size.x, size.z) * 0.6) return null;

  return {
    topY: bbox.max.y,
    centerX: (bbox.min.x + bbox.max.x) / 2,
    centerZ: (bbox.min.z + bbox.max.z) / 2,
    minX: bbox.min.x,
    maxX: bbox.max.x,
    minZ: bbox.min.z,
    maxZ: bbox.max.z,
    width: size.x,
    depth: size.z,
    triCount: 0,
  };
}

function computeFreeSpace(
  surface: DetectedSurface,
  occupiedBboxes: THREE.Box3[],
  minWidth: number,
  minDepth: number,
): {
  availWidth: number;
  availDepth: number;
  placementX: number;
  placementZ: number;
} {
  if (occupiedBboxes.length === 0) {
    return {
      availWidth: surface.width,
      availDepth: surface.depth,
      placementX: surface.centerX,
      placementZ: surface.centerZ,
    };
  }

  const gridW = Math.max(1, Math.floor(surface.width / SURFACE_GRID_CELL));
  const gridD = Math.max(1, Math.floor(surface.depth / SURFACE_GRID_CELL));

  if (gridW * gridD > 100000) {
    let occupiedArea = 0;
    for (const ob of occupiedBboxes) {
      const ow = Math.min(ob.max.x, surface.maxX) - Math.max(ob.min.x, surface.minX);
      const od = Math.min(ob.max.z, surface.maxZ) - Math.max(ob.min.z, surface.minZ);
      if (ow > 0 && od > 0) occupiedArea += ow * od;
    }
    const freeArea = Math.max(0, surface.width * surface.depth - occupiedArea);
    const side = Math.sqrt(freeArea);
    return {
      availWidth: side,
      availDepth: side,
      placementX: surface.centerX,
      placementZ: surface.centerZ,
    };
  }

  const grid = new Uint8Array(gridW * gridD);

  for (const ob of occupiedBboxes) {
    const oMinX = Math.max(0, Math.floor((ob.min.x - surface.minX) / SURFACE_GRID_CELL));
    const oMaxX = Math.min(gridW - 1, Math.floor((ob.max.x - surface.minX) / SURFACE_GRID_CELL));
    const oMinZ = Math.max(0, Math.floor((ob.min.z - surface.minZ) / SURFACE_GRID_CELL));
    const oMaxZ = Math.min(gridD - 1, Math.floor((ob.max.z - surface.minZ) / SURFACE_GRID_CELL));

    for (let gx = oMinX; gx <= oMaxX; gx++) {
      for (let gz = oMinZ; gz <= oMaxZ; gz++) {
        grid[gz * gridW + gx] = 1;
      }
    }
  }

  const rect = findLargestFreeRect(grid, gridW, gridD);
  const availWidth = rect.width * SURFACE_GRID_CELL;
  const availDepth = rect.depth * SURFACE_GRID_CELL;

  return {
    availWidth,
    availDepth,
    placementX: surface.minX + rect.centerX * SURFACE_GRID_CELL,
    placementZ: surface.minZ + rect.centerZ * SURFACE_GRID_CELL,
  };
}

function findLargestFreeRect(
  grid: Uint8Array,
  gridW: number,
  gridD: number,
): { width: number; depth: number; centerX: number; centerZ: number } {
  const heights = new Uint16Array(gridW);
  let bestArea = 0;
  let bestW = 0;
  let bestD = 0;
  let bestX = 0;
  let bestZ = 0;

  for (let z = 0; z < gridD; z++) {
    for (let x = 0; x < gridW; x++) {
      heights[x] = grid[z * gridW + x] === 0 ? heights[x] + 1 : 0;
    }

    const stack: Array<{ x: number; h: number }> = [];
    for (let x = 0; x <= gridW; x++) {
      const h = x < gridW ? heights[x] : 0;
      while (stack.length > 0 && stack[stack.length - 1].h > h) {
        const top = stack.pop()!;
        const w = stack.length > 0 ? x - stack[stack.length - 1].x - 1 : x;
        const area = top.h * w;
        if (area > bestArea) {
          bestArea = area;
          bestW = w;
          bestD = top.h;
          const startX = stack.length > 0 ? stack[stack.length - 1].x + 1 : 0;
          bestX = startX + w / 2;
          bestZ = z - top.h / 2 + 0.5;
        }
      }
      stack.push({ x, h });
    }
  }

  if (bestArea === 0) {
    return { width: 0, depth: 0, centerX: gridW / 2, centerZ: gridD / 2 };
  }

  return { width: bestW, depth: bestD, centerX: bestX, centerZ: bestZ };
}

function getNodeId(headlessScene: HeadlessMMLScene, el: any): number {
  try {
    const container = el.getContainer();
    const wp = new THREE.Vector3();
    container.getWorldPosition(wp);

    const allEls = headlessScene.getAllElements(
      { x: wp.x, y: wp.y, z: wp.z },
      { radius: 0.5, maxResults: 10 },
    );

    const tag = el.tagName?.toLowerCase();
    for (const found of allEls) {
      if (
        Math.abs(found.position.x - wp.x) < 0.01 &&
        Math.abs(found.position.y - wp.y) < 0.01 &&
        Math.abs(found.position.z - wp.z) < 0.01 &&
        found.tag === tag
      ) {
        return found.nodeId;
      }
    }
  } catch {
    // Fall through
  }

  if ((el as any).__surfaceNodeId === undefined) {
    (el as any).__surfaceNodeId = Math.floor(Math.random() * 100000);
  }
  return (el as any).__surfaceNodeId;
}
