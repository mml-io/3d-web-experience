/**
 * Tests for NavMeshManager — comprehensive coverage of public and internal methods.
 *
 * NOTE: We mock @recast-navigation/core, @recast-navigation/generators and worker_threads
 * to avoid loading WASM / spawning real workers in Node.js tests.
 */
import { describe, expect, test, beforeEach, afterEach, vi, beforeAll, type Mock } from "vitest";

// ---------------------------------------------------------------------------
// Mock state
// ---------------------------------------------------------------------------
const mockNavMesh = {
  destroy: vi.fn(),
  getMaxTiles: vi.fn().mockReturnValue(1),
  getTile: vi.fn().mockReturnValue({ header: () => true }),
  getDebugNavMesh: vi.fn().mockReturnValue([[], []]),
};
const mockNavMeshQuery = {
  findClosestPoint: vi.fn().mockReturnValue({ success: true, point: { x: 1, y: 0, z: 1 } }),
  findRandomPoint: vi.fn().mockReturnValue({ success: true, randomPoint: { x: 5, y: 0, z: 3 } }),
  computePath: vi.fn().mockReturnValue({
    success: true,
    path: [
      { x: 0, y: 0, z: 0 },
      { x: 5, y: 0, z: 5 },
    ],
  }),
  destroy: vi.fn(),
};
const mockQueryFilter = { includeFlags: 0, excludeFlags: 0, setAreaCost: vi.fn() };
const mockImportNavMesh = vi.fn().mockReturnValue({ navMesh: mockNavMesh });
const mockGenerateSoloNavMesh = vi.fn().mockReturnValue({ success: true, navMesh: mockNavMesh });

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------
vi.mock("@recast-navigation/core", () => ({
  init: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  NavMeshQuery: vi.fn().mockImplementation(function () {
    return mockNavMeshQuery;
  }),
  QueryFilter: vi.fn().mockImplementation(function () {
    return mockQueryFilter;
  }),
  importNavMesh: mockImportNavMesh,
}));
const mockGenerateTiledNavMesh = vi.fn().mockReturnValue({ success: true, navMesh: mockNavMesh });
vi.mock("@recast-navigation/generators", () => ({
  generateSoloNavMesh: mockGenerateSoloNavMesh,
  generateTiledNavMesh: mockGenerateTiledNavMesh,
}));
const mockWorker = {
  on: vi.fn(),
  postMessage: vi.fn(),
  terminate: vi.fn(),
  removeAllListeners: vi.fn(),
};
vi.mock("worker_threads", () => ({
  Worker: vi.fn().mockImplementation(function () {
    return mockWorker;
  }),
}));

let NavMeshManager: any;
let NAVMESH_CONFIG: any;
let THREE: any;

beforeAll(async () => {
  THREE = await import("three");
  const mod = await import("../src/NavMeshManager");
  NavMeshManager = mod.NavMeshManager;
  NAVMESH_CONFIG = mod.NAVMESH_CONFIG;
});

/**
 * Returns 3 position floats for a horizontal CCW triangle at height `y`
 * with an optional XZ offset.  The normal points +Y.
 *   cross((0,y,2)-(0,y,0), (2,y,0)-(0,y,0)) = (0,+4,0)
 *   Centroid = (xOff+0.67, y, zOff+0.67) → grid cell (floor(cx/2), floor(cz/2))
 */
function upTri(y: number, xOff = 0, zOff = 0): number[] {
  return [xOff, y, zOff, xOff, y, zOff + 2, xOff + 2, y, zOff];
}

describe("NavMeshManager", () => {
  let mgr: any;

  beforeEach(() => {
    mgr = new NavMeshManager();
    vi.clearAllMocks();
    mockGenerateSoloNavMesh.mockReturnValue({ success: true, navMesh: mockNavMesh });
    mockImportNavMesh.mockReturnValue({ navMesh: mockNavMesh });
  });

  afterEach(() => {
    mgr.dispose();
  });

  // ---- construction ----
  test("starts not ready", () => {
    expect(mgr.isReady).toBe(false);
    expect(mgr.currentRegionCenter).toBeNull();
  });

  // ---- NAVMESH_CONFIG ----
  test("config values", () => {
    expect(NAVMESH_CONFIG.cs).toBe(0.5);
    expect(NAVMESH_CONFIG.ch).toBe(0.25);
    expect(NAVMESH_CONFIG.walkableHeight).toBe(8);
    expect(NAVMESH_CONFIG.walkableRadius).toBe(3);
    expect(NAVMESH_CONFIG.walkableClimb).toBe(2);
  });

  // ---- init ----
  describe("init", () => {
    test("initializes WASM and is idempotent", async () => {
      await mgr.init();
      await mgr.init();
      const { init } = await import("@recast-navigation/core");
      expect(init).toHaveBeenCalledTimes(1);
    });

    test("handles worker creation failure", async () => {
      const { Worker } = await import("worker_threads");
      (Worker as unknown as Mock).mockImplementationOnce(() => {
        throw new Error("Cannot create worker");
      });
      const m = new NavMeshManager();
      await m.init();
      expect((m as any).initialized).toBe(true);
      expect((m as any).workerReady).toBe(false);
      m.dispose();
    });
  });

  // ---- shouldRegenerate ----
  describe("shouldRegenerate", () => {
    test("false when no region center", () => {
      expect(mgr.shouldRegenerate({ x: 100, y: 0, z: 100 })).toBe(false);
    });
    test("false when close", () => {
      (mgr as any).regionCenter = { x: 0, y: 0, z: 0 };
      expect(mgr.shouldRegenerate({ x: 5, y: 0, z: 5 })).toBe(false);
    });
    test("true when far", () => {
      (mgr as any).regionCenter = { x: 0, y: 0, z: 0 };
      expect(mgr.shouldRegenerate({ x: 15, y: 0, z: 0 })).toBe(true);
    });
  });

  // ---- isWithinRegion ----
  describe("isWithinRegion", () => {
    test("false when no region center", () => {
      expect(mgr.isWithinRegion({ x: 0, y: 0, z: 0 })).toBe(false);
    });
    test("true inside", () => {
      (mgr as any).regionCenter = { x: 0, y: 0, z: 0 };
      expect(mgr.isWithinRegion({ x: 10, y: 0, z: 10 })).toBe(true);
    });
    test("false outside x", () => {
      (mgr as any).regionCenter = { x: 0, y: 0, z: 0 };
      expect(mgr.isWithinRegion({ x: 30, y: 0, z: 0 })).toBe(false);
    });
    test("false outside z", () => {
      (mgr as any).regionCenter = { x: 0, y: 0, z: 0 };
      expect(mgr.isWithinRegion({ x: 0, y: 0, z: 30 })).toBe(false);
    });
  });

  // ---- currentRegionCenter ----
  describe("currentRegionCenter", () => {
    test("null initially", () => {
      expect(mgr.currentRegionCenter).toBeNull();
    });
    test("returns copy", () => {
      (mgr as any).regionCenter = { x: 10, y: 0, z: 20 };
      const c = mgr.currentRegionCenter;
      c.x = 999;
      expect(mgr.currentRegionCenter.x).toBe(10);
    });
  });

  // ---- computePath ----
  describe("computePath", () => {
    test("null when no query", () => {
      expect(mgr.computePath({ x: 0, y: 0, z: 0 }, { x: 5, y: 0, z: 5 })).toBeNull();
    });
    test("returns path", () => {
      (mgr as any).navMeshQuery = mockNavMeshQuery;
      mockNavMeshQuery.computePath.mockReturnValue({
        success: true,
        path: [
          { x: 0, y: 0, z: 0 },
          { x: 5, y: 0, z: 5 },
        ],
      });
      expect(mgr.computePath({ x: 0, y: 0, z: 0 }, { x: 5, y: 0, z: 5 })).toHaveLength(2);
    });
    test("null on failure", () => {
      (mgr as any).navMeshQuery = mockNavMeshQuery;
      mockNavMeshQuery.computePath.mockReturnValue({ success: false, path: [] });
      expect(mgr.computePath({ x: 0, y: 0, z: 0 }, { x: 5, y: 0, z: 5 })).toBeNull();
    });
    test("null on empty path", () => {
      (mgr as any).navMeshQuery = mockNavMeshQuery;
      mockNavMeshQuery.computePath.mockReturnValue({ success: true, path: [] });
      expect(mgr.computePath({ x: 0, y: 0, z: 0 }, { x: 5, y: 0, z: 5 })).toBeNull();
    });
    test("null on null path", () => {
      (mgr as any).navMeshQuery = mockNavMeshQuery;
      mockNavMeshQuery.computePath.mockReturnValue({ success: true, path: null });
      expect(mgr.computePath({ x: 0, y: 0, z: 0 }, { x: 5, y: 0, z: 5 })).toBeNull();
    });
    test("clamps negative y to 0", () => {
      (mgr as any).navMeshQuery = mockNavMeshQuery;
      mockNavMeshQuery.computePath.mockReturnValue({
        success: true,
        path: [
          { x: 0, y: -1, z: 0 },
          { x: 5, y: -0.5, z: 5 },
        ],
      });
      const r = mgr.computePath({ x: 0, y: 0, z: 0 }, { x: 5, y: 0, z: 5 });
      expect(r![0].y).toBe(0);
      expect(r![1].y).toBe(0);
    });
    test("null when last point too far", () => {
      (mgr as any).navMeshQuery = mockNavMeshQuery;
      mockNavMeshQuery.computePath.mockReturnValue({
        success: true,
        path: [
          { x: 0, y: 0, z: 0 },
          { x: 2, y: 0, z: 2 },
        ],
      });
      expect(mgr.computePath({ x: 0, y: 0, z: 0 }, { x: 100, y: 0, z: 100 })).toBeNull();
    });
    test("passes jump filter", () => {
      (mgr as any).navMeshQuery = mockNavMeshQuery;
      (mgr as any).jumpFilter = mockQueryFilter;
      mockNavMeshQuery.computePath.mockReturnValue({
        success: true,
        path: [
          { x: 0, y: 0, z: 0 },
          { x: 5, y: 0, z: 5 },
        ],
      });
      mgr.computePath({ x: 0, y: 0, z: 0 }, { x: 5, y: 0, z: 5 });
      expect(mockNavMeshQuery.computePath).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ filter: mockQueryFilter }),
      );
    });
  });

  // ---- computePathWithJumpInfo ----
  describe("computePathWithJumpInfo", () => {
    test("null when no query", () => {
      expect(mgr.computePathWithJumpInfo({ x: 0, y: 0, z: 0 }, { x: 5, y: 0, z: 5 })).toBeNull();
    });
    test("flat path has no jump indices", () => {
      (mgr as any).navMeshQuery = mockNavMeshQuery;
      mockNavMeshQuery.computePath.mockReturnValue({
        success: true,
        path: [
          { x: 0, y: 0, z: 0 },
          { x: 5, y: 0, z: 5 },
        ],
      });
      const r = mgr.computePathWithJumpInfo({ x: 0, y: 0, z: 0 }, { x: 5, y: 0, z: 5 });
      expect(r!.jumpIndices.size).toBe(0);
    });
    test("detects jump indices", () => {
      (mgr as any).navMeshQuery = mockNavMeshQuery;
      mockNavMeshQuery.computePath.mockReturnValue({
        success: true,
        path: [
          { x: 0, y: 0, z: 0 },
          { x: 5, y: 3, z: 0 },
          { x: 10, y: 3, z: 0 },
        ],
      });
      const r = mgr.computePathWithJumpInfo({ x: 0, y: 0, z: 0 }, { x: 10, y: 3, z: 0 });
      expect(r!.jumpIndices.has(1)).toBe(true);
    });
    test("appends destination when last Y differs", () => {
      (mgr as any).navMeshQuery = mockNavMeshQuery;
      mockNavMeshQuery.computePath.mockReturnValue({
        success: true,
        path: [
          { x: 0, y: 0, z: 0 },
          { x: 5, y: 0, z: 5 },
        ],
      });
      const r = mgr.computePathWithJumpInfo({ x: 0, y: 0, z: 0 }, { x: 5, y: 3, z: 5 });
      expect(r!.path[r!.path.length - 1].y).toBe(3);
    });
    test("fallback walk-then-jump", () => {
      (mgr as any).navMeshQuery = mockNavMeshQuery;
      mockNavMeshQuery.computePath
        .mockReturnValueOnce({ success: false, path: [] })
        .mockReturnValueOnce({
          success: true,
          path: [
            { x: 0, y: 0, z: 0 },
            { x: 4, y: 0, z: 4 },
          ],
        });
      mockNavMeshQuery.findClosestPoint.mockReturnValue({
        success: true,
        point: { x: 5, y: 2, z: 5 },
      });
      const r = mgr.computePathWithJumpInfo({ x: 0, y: 0, z: 0 }, { x: 5, y: 3, z: 5 });
      expect(r!.path[r!.path.length - 1]).toEqual({ x: 5, y: 3, z: 5 });
      expect(r!.jumpIndices.has(r!.path.length - 1)).toBe(true);
    });
    test("null when fallback nearest = target", () => {
      (mgr as any).navMeshQuery = mockNavMeshQuery;
      mockNavMeshQuery.computePath.mockReturnValue({ success: false, path: [] });
      mockNavMeshQuery.findClosestPoint.mockReturnValue({
        success: true,
        point: { x: 5, y: 0, z: 5 },
      });
      expect(mgr.computePathWithJumpInfo({ x: 0, y: 0, z: 0 }, { x: 5, y: 0, z: 5 })).toBeNull();
    });
    test("null when findNearestPoint fails", () => {
      (mgr as any).navMeshQuery = mockNavMeshQuery;
      mockNavMeshQuery.computePath.mockReturnValue({ success: false, path: [] });
      mockNavMeshQuery.findClosestPoint.mockReturnValue({ success: false });
      expect(mgr.computePathWithJumpInfo({ x: 0, y: 0, z: 0 }, { x: 50, y: 0, z: 50 })).toBeNull();
    });
    test("null when approach path fails", () => {
      (mgr as any).navMeshQuery = mockNavMeshQuery;
      mockNavMeshQuery.computePath
        .mockReturnValueOnce({ success: false, path: [] })
        .mockReturnValueOnce({ success: false, path: [] });
      mockNavMeshQuery.findClosestPoint.mockReturnValue({
        success: true,
        point: { x: 5, y: 2, z: 5 },
      });
      expect(mgr.computePathWithJumpInfo({ x: 0, y: 0, z: 0 }, { x: 5, y: 3, z: 5 })).toBeNull();
    });
    test("null when approach path empty", () => {
      (mgr as any).navMeshQuery = mockNavMeshQuery;
      mockNavMeshQuery.computePath
        .mockReturnValueOnce({ success: false, path: [] })
        .mockReturnValueOnce({ success: true, path: [] });
      mockNavMeshQuery.findClosestPoint.mockReturnValue({
        success: true,
        point: { x: 5, y: 2, z: 5 },
      });
      expect(mgr.computePathWithJumpInfo({ x: 0, y: 0, z: 0 }, { x: 5, y: 3, z: 5 })).toBeNull();
    });
  });

  // ---- computeEdgePoint ----
  describe("computeEdgePoint", () => {
    test("null when no query", () => {
      expect(mgr.computeEdgePoint({ x: 0, y: 0, z: 0 }, { x: 5, y: 0, z: 5 })).toBeNull();
    });
    test("null when no region center", () => {
      (mgr as any).navMeshQuery = mockNavMeshQuery;
      expect(mgr.computeEdgePoint({ x: 0, y: 0, z: 0 }, { x: 5, y: 0, z: 5 })).toBeNull();
    });
    test("null when from == to", () => {
      (mgr as any).navMeshQuery = mockNavMeshQuery;
      (mgr as any).regionCenter = { x: 0, y: 0, z: 0 };
      expect(mgr.computeEdgePoint({ x: 5, y: 0, z: 5 }, { x: 5, y: 0, z: 5 })).toBeNull();
    });
    test("returns projected edge point", () => {
      (mgr as any).navMeshQuery = mockNavMeshQuery;
      (mgr as any).regionCenter = { x: 0, y: 0, z: 0 };
      mockNavMeshQuery.findClosestPoint.mockReturnValue({
        success: true,
        point: { x: 18, y: 0, z: 0 },
      });
      expect(mgr.computeEdgePoint({ x: 0, y: 0, z: 0 }, { x: 100, y: 0, z: 0 })).not.toBeNull();
    });
  });

  // ---- findNearestPoint ----
  describe("findNearestPoint", () => {
    test("null when no query", () => {
      expect(mgr.findNearestPoint({ x: 0, y: 0, z: 0 })).toBeNull();
    });
    test("returns point", () => {
      (mgr as any).navMeshQuery = mockNavMeshQuery;
      mockNavMeshQuery.findClosestPoint.mockReturnValue({
        success: true,
        point: { x: 1, y: 0, z: 1 },
      });
      expect(mgr.findNearestPoint({ x: 0, y: 0, z: 0 })).toEqual({ x: 1, y: 0, z: 1 });
    });
    test("null on failure", () => {
      (mgr as any).navMeshQuery = mockNavMeshQuery;
      mockNavMeshQuery.findClosestPoint.mockReturnValue({ success: false });
      expect(mgr.findNearestPoint({ x: 0, y: 0, z: 0 })).toBeNull();
    });
  });

  // ---- findRandomPoint ----
  describe("findRandomPoint", () => {
    test("null when no query", () => {
      expect(mgr.findRandomPoint()).toBeNull();
    });
    test("returns point", () => {
      (mgr as any).navMeshQuery = mockNavMeshQuery;
      mockNavMeshQuery.findRandomPoint.mockReturnValue({
        success: true,
        randomPoint: { x: 5, y: 0, z: 3 },
      });
      expect(mgr.findRandomPoint()).toEqual({ x: 5, y: 0, z: 3 });
    });
    test("null on failure", () => {
      (mgr as any).navMeshQuery = mockNavMeshQuery;
      mockNavMeshQuery.findRandomPoint.mockReturnValue({ success: false });
      expect(mgr.findRandomPoint()).toBeNull();
    });
  });

  // ---- waitForReady ----
  describe("waitForReady", () => {
    test("immediate when ready", async () => {
      (mgr as any).navMeshQuery = mockNavMeshQuery;
      expect(await mgr.waitForReady(1000)).toBe(true);
    });
    test("resolves on event", async () => {
      const p = mgr.waitForReady(5000);
      mgr.emit("ready");
      expect(await p).toBe(true);
    });
    test("timeout", async () => {
      vi.useFakeTimers();
      const p = mgr.waitForReady(100);
      vi.advanceTimersByTime(200);
      expect(await p).toBe(false);
      vi.useRealTimers();
    });
  });

  // ---- dispose ----
  describe("dispose", () => {
    test("cleans up worker/navmesh", () => {
      (mgr as any).worker = mockWorker;
      (mgr as any).workerReady = true;
      (mgr as any).navMesh = mockNavMesh;
      (mgr as any).navMeshQuery = mockNavMeshQuery;
      (mgr as any).jumpFilter = mockQueryFilter;
      mgr.dispose();
      expect(mockWorker.terminate).toHaveBeenCalled();
      expect((mgr as any).worker).toBeNull();
      expect((mgr as any).navMesh).toBeNull();
      expect((mgr as any).navMeshQuery).toBeNull();
      expect((mgr as any).jumpFilter).toBeNull();
    });
    test("clears pending requests", () => {
      const r = vi.fn();
      (mgr as any).pendingRequests.set(1, { resolve: r, timer: setTimeout(() => {}, 10000) });
      mgr.dispose();
      expect(r).toHaveBeenCalledWith({ success: false, cancelled: true });
    });
    test("handles navMesh.destroy throwing", () => {
      (mgr as any).navMesh = {
        destroy: vi.fn(() => {
          throw new Error("x");
        }),
      };
      expect(() => mgr.dispose()).not.toThrow();
    });
    test("handles navMeshQuery.destroy throwing", () => {
      (mgr as any).navMeshQuery = {
        destroy: vi.fn(() => {
          throw new Error("x");
        }),
      };
      expect(() => mgr.dispose()).not.toThrow();
    });
    test("safe to call twice", () => {
      expect(() => {
        mgr.dispose();
        mgr.dispose();
      }).not.toThrow();
    });
  });

  // ---- regenerate ----
  test("regenerate delegates", async () => {
    const s = new THREE.Scene();
    const spy = vi.spyOn(mgr, "generateFromScene").mockResolvedValue(true);
    expect(await mgr.regenerate(s, { x: 0, y: 0, z: 0 })).toBe(true);
    spy.mockRestore();
  });

  // ---- generateFromScene ----
  describe("generateFromScene", () => {
    function makeScene(name = "box") {
      const s = new THREE.Scene();
      const m = new THREE.Mesh(new THREE.BoxGeometry(10, 0.1, 10), new THREE.MeshBasicMaterial());
      m.name = name;
      s.add(m);
      s.updateMatrixWorld(true);
      return s;
    }
    function setupMainThread() {
      (mgr as any).worker = null;
      (mgr as any).workerReady = false;
      (mgr as any).initialized = true;
    }

    test("queues re-generation when already generating", async () => {
      setupMainThread();
      const scene = makeScene("ground-plane");
      const center = { x: 0, y: 0, z: 0 };

      const first = mgr.generateFromScene(scene, center);
      const second = mgr.generateFromScene(scene, { x: 100, y: 0, z: 100 });

      expect(first).not.toBe(second);
      const [r1, r2] = await Promise.all([first, second]);
      expect(typeof r1).toBe("boolean");
      expect(typeof r2).toBe("boolean");
    }, 15000);

    test("false on empty scene", async () => {
      expect(await mgr.generateFromScene(new THREE.Scene())).toBe(false);
    });

    test("succeeds with main thread", async () => {
      setupMainThread();
      expect(await mgr.generateFromScene(makeScene("ground-plane"), { x: 0, y: 0, z: 0 })).toBe(
        true,
      );
      expect(mgr.isReady).toBe(true);
    }, 15000);

    test("skips rebuild when unchanged", async () => {
      setupMainThread();
      const s = makeScene();
      const c = { x: 0, y: 0, z: 0 };
      await mgr.generateFromScene(s, c);
      expect(await mgr.generateFromScene(s, c)).toBe(true);
    }, 15000);

    test("region clipping", async () => {
      setupMainThread();
      const s = new THREE.Scene();
      const m = new THREE.Mesh(new THREE.BoxGeometry(100, 0.1, 100), new THREE.MeshBasicMaterial());
      m.name = "ground-plane";
      s.add(m);
      s.updateMatrixWorld(true);
      expect(await mgr.generateFromScene(s, { x: 0, y: 0, z: 0 })).toBe(true);
    }, 15000);

    test("replaces old navmesh", async () => {
      setupMainThread();
      const s = makeScene();
      await mgr.generateFromScene(s, { x: 0, y: 0, z: 0 });
      s.add(new THREE.Mesh(new THREE.BoxGeometry(5, 2, 5), new THREE.MeshBasicMaterial()));
      s.updateMatrixWorld(true);
      expect(await mgr.generateFromScene(s, { x: 5, y: 0, z: 5 })).toBe(true);
    }, 15000);

    test("false when gen fails", async () => {
      setupMainThread();
      mockGenerateTiledNavMesh.mockReturnValueOnce({ success: false, navMesh: null });
      expect(await mgr.generateFromScene(makeScene())).toBe(false);
    }, 15000);

    test("false when navMesh null despite success", async () => {
      setupMainThread();
      mockGenerateTiledNavMesh.mockReturnValueOnce({ success: true, navMesh: null });
      expect(await mgr.generateFromScene(makeScene())).toBe(false);
    }, 15000);

    test("no center means no region box", async () => {
      setupMainThread();
      expect(await mgr.generateFromScene(makeScene())).toBe(true);
      expect(mgr.currentRegionCenter).toBeNull();
    }, 15000);

    test("false when tiny meshes filtered", async () => {
      setupMainThread();
      const s = new THREE.Scene();
      s.add(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), new THREE.MeshBasicMaterial()));
      s.updateMatrixWorld(true);
      expect(await mgr.generateFromScene(s)).toBe(false);
    }, 15000);

    test("false when all triangles clipped", async () => {
      setupMainThread();
      const s = new THREE.Scene();
      const m = new THREE.Mesh(new THREE.BoxGeometry(2, 0.1, 2), new THREE.MeshBasicMaterial());
      m.position.set(200, 0, 200);
      s.add(m);
      s.updateMatrixWorld(true);
      expect(await mgr.generateFromScene(s, { x: 0, y: 0, z: 0 })).toBe(false);
    }, 15000);

    test("emits ready", async () => {
      setupMainThread();
      let ready = false;
      mgr.once("ready", () => {
        ready = true;
      });
      await mgr.generateFromScene(makeScene());
      expect(ready).toBe(true);
    }, 15000);

    test("resets isGenerating after error", async () => {
      setupMainThread();
      mockGenerateTiledNavMesh.mockImplementationOnce(() => {
        throw new Error("boom");
      });
      try {
        await mgr.generateFromScene(makeScene());
      } catch {
        /* expected */
      }
      expect((mgr as any).isGenerating).toBe(false);
    }, 15000);

    test("synthetic ground grid with center", async () => {
      setupMainThread();
      const s = new THREE.Scene();
      const g = new THREE.PlaneGeometry(100, 100);
      g.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial());
      m.name = "ground-plane";
      s.add(m);
      s.updateMatrixWorld(true);
      await mgr.generateFromScene(s, { x: 0, y: 0, z: 0 });
      const idx = (mockGenerateTiledNavMesh.mock.calls[0] as any[])[1] as Uint32Array;
      expect(idx.length / 3).toBeGreaterThan(2);
    }, 15000);

    test("sets QueryFilter", async () => {
      setupMainThread();
      await mgr.generateFromScene(makeScene());
      expect(mockQueryFilter.includeFlags).toBe(0xffff);
      expect(mockQueryFilter.setAreaCost).toHaveBeenCalledWith(1, 2.0);
    }, 15000);

    test("non-indexed geometry", async () => {
      setupMainThread();
      const s = new THREE.Scene();
      const g = new THREE.BufferGeometry();
      g.setAttribute(
        "position",
        new THREE.BufferAttribute(
          new Float32Array([-5, 0, -5, 5, 0, -5, 5, 0, 5, -5, 0, -5, 5, 0, 5, -5, 0, 5]),
          3,
        ),
      );
      s.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial()));
      s.updateMatrixWorld(true);
      expect(await mgr.generateFromScene(s)).toBe(true);
    }, 15000);
  });

  // ---- handleWorkerMessage ----
  describe("handleWorkerMessage", () => {
    test("resolves pending", () => {
      const r = vi.fn();
      (mgr as any).pendingRequests.set(42, { resolve: r, timer: setTimeout(() => {}, 10000) });
      (mgr as any).handleWorkerMessage({ type: "result", requestId: 42, success: true });
      expect(r).toHaveBeenCalled();
      expect((mgr as any).pendingRequests.has(42)).toBe(false);
    });
    test("ignores unknown id", () => {
      expect(() =>
        (mgr as any).handleWorkerMessage({ type: "result", requestId: 999 }),
      ).not.toThrow();
    });
    test("ignores non-result", () => {
      expect(() => (mgr as any).handleWorkerMessage({ type: "status" })).not.toThrow();
    });
  });

  // ---- computeGeometryHash ----
  describe("computeGeometryHash", () => {
    test("cache works", () => {
      const p = new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]);
      const i = new Uint32Array([0, 1, 2]);
      const l1 = (mgr as any).detectJumpLinksWithCache(p, i);
      const l2 = (mgr as any).detectJumpLinksWithCache(p, i);
      expect(l1).toEqual(l2);
    });
    test("invalidates on change", () => {
      (mgr as any).detectJumpLinksWithCache(
        new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]),
        new Uint32Array([0, 1, 2]),
      );
      const h1 = (mgr as any).lastJumpLinksHash;
      (mgr as any).detectJumpLinksWithCache(
        new Float32Array([0, 0, 0, 2, 0, 0, 0, 0, 2]),
        new Uint32Array([0, 1, 2]),
      );
      expect((mgr as any).lastJumpLinksHash).not.toBe(h1);
    });
    test("deterministic MD5 hash for geometry", () => {
      const p: number[] = [];
      const i: number[] = [];
      for (let t = 0; t < 100; t++) {
        p.push(t, 0, 0, t + 1, 0, 0, t, 0, 1);
        i.push(t * 3, t * 3 + 1, t * 3 + 2);
      }
      const positions = new Float32Array(p);
      const indices = new Uint32Array(i);
      const h1 = (mgr as any).computeGeometryHash(positions, indices);
      const h2 = (mgr as any).computeGeometryHash(positions, indices);
      expect(typeof h1).toBe("string");
      expect(h1.length).toBe(32);
      expect(h1).toBe(h2);
    });
  });

  // ---- detectJumpLinks ----
  describe("detectJumpLinks", () => {
    test("empty for vertical wall", () => {
      expect(
        (mgr as any).detectJumpLinks(
          new Float32Array([0, 0, 0, 0, 1, 0, 0, 0, 1]),
          new Uint32Array([0, 1, 2]),
        ),
      ).toEqual([]);
    });

    test("detects links y=0 → y=2", () => {
      const p = new Float32Array([...upTri(0), ...upTri(2)]);
      const links = (mgr as any).detectJumpLinks(p, new Uint32Array([0, 1, 2, 3, 4, 5]));
      expect(links.length).toBeGreaterThan(0);
    });

    test("filters cy < -0.5", () => {
      expect(
        (mgr as any).detectJumpLinks(new Float32Array(upTri(-1)), new Uint32Array([0, 1, 2])),
      ).toEqual([]);
    });

    test("link structure", () => {
      const links = (mgr as any).detectJumpLinks(
        new Float32Array([...upTri(0), ...upTri(2)]),
        new Uint32Array([0, 1, 2, 3, 4, 5]),
      );
      for (const l of links) {
        expect(l.radius).toBe(1.5);
        expect(l.bidirectional).toBe(true);
        expect(l.area).toBe(1);
        expect(l.flags).toBe(1);
      }
    });

    test("ignores diff <= WALKABLE_CLIMB", () => {
      expect(
        (mgr as any).detectJumpLinks(
          new Float32Array([...upTri(0), ...upTri(0.3)]),
          new Uint32Array([0, 1, 2, 3, 4, 5]),
        ),
      ).toEqual([]);
    });

    test("ignores diff > MAX_JUMP_HEIGHT", () => {
      expect(
        (mgr as any).detectJumpLinks(
          new Float32Array([...upTri(0), ...upTri(10)]),
          new Uint32Array([0, 1, 2, 3, 4, 5]),
        ),
      ).toEqual([]);
    });

    test("bidirectional traversal", () => {
      const links = (mgr as any).detectJumpLinks(
        new Float32Array([...upTri(0), ...upTri(2)]),
        new Uint32Array([0, 1, 2, 3, 4, 5]),
      );
      for (const l of links) expect(l.bidirectional).toBe(true);
    });

    test("layer separation (merge + split)", () => {
      const p = new Float32Array([...upTri(0), ...upTri(0.3), ...upTri(2)]);
      expect(
        (mgr as any).detectJumpLinks(p, new Uint32Array([0, 1, 2, 3, 4, 5, 6, 7, 8])).length,
      ).toBeGreaterThan(0);
    });

    test("deduplication with many layers", () => {
      const p: number[] = [];
      const idx: number[] = [];
      let vi = 0;
      for (let i = 0; i < 10; i++) {
        const y = 0.6 + i * 0.6;
        p.push(...upTri(y, 0, 0));
        idx.push(vi, vi + 1, vi + 2);
        vi += 3;
        p.push(...upTri(y, 2, 0));
        idx.push(vi, vi + 1, vi + 2);
        vi += 3;
      }
      expect(
        (mgr as any).detectJumpLinks(new Float32Array(p), new Uint32Array(idx)).length,
      ).toBeGreaterThan(0);
    });

    test("prioritization with mixed elevation", () => {
      const p = new Float32Array([
        ...upTri(0, 0, 0),
        ...upTri(0, 4, 0),
        ...upTri(2, 0, 0),
        ...upTri(2, 4, 0),
      ]);
      expect(
        (mgr as any).detectJumpLinks(p, new Uint32Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]))
          .length,
      ).toBeGreaterThan(0);
    });
  });

  // ---- ground offset logic ----
  describe("ground offset in detectJumpLinks", () => {
    test("ground→elevated colocated, tcLen > 0.01", () => {
      // centroid (0.67,y,0.67), cell center (1,1), tcLen > 0.01
      const links = (mgr as any).detectJumpLinks(
        new Float32Array([...upTri(0), ...upTri(2)]),
        new Uint32Array([0, 1, 2, 3, 4, 5]),
      );
      expect(links.length).toBeGreaterThan(0);
    });

    test("ground→elevated colocated, tcLen ~ 0 (at cell center)", () => {
      // centroid (1,y,1) = cell center (1,1) → tcLen ≈ 0
      // (0,y,0),(0,y,3),(3,y,0) → centroid (1,y,1)
      const p = new Float32Array([0, 0, 0, 0, 0, 3, 3, 0, 0, 0, 2, 0, 0, 2, 3, 3, 2, 0]);
      expect(
        (mgr as any).detectJumpLinks(p, new Uint32Array([0, 1, 2, 3, 4, 5])).length,
      ).toBeGreaterThan(0);
    });

    test("ground→elevated non-colocated (dd >= 0.1)", () => {
      // ground centroid (0.33,0,0.33), elevated centroid (1.33,2,1.33), dd~1.41
      const p = new Float32Array([0, 0, 0, 0, 0, 1, 1, 0, 0, 1, 2, 1, 1, 2, 2, 2, 2, 1]);
      expect(
        (mgr as any).detectJumpLinks(p, new Uint32Array([0, 1, 2, 3, 4, 5])).length,
      ).toBeGreaterThan(0);
    });

    test("elevated→ground colocated, tcLen > 0.01", () => {
      // same geometry, just A=elevated B=ground in iteration
      const links = (mgr as any).detectJumpLinks(
        new Float32Array([...upTri(0), ...upTri(2)]),
        new Uint32Array([0, 1, 2, 3, 4, 5]),
      );
      expect(links.length).toBeGreaterThan(0);
    });

    test("elevated→ground colocated, tcLen ~ 0", () => {
      const p = new Float32Array([0, 0, 0, 0, 0, 3, 3, 0, 0, 0, 2, 0, 0, 2, 3, 3, 2, 0]);
      expect(
        (mgr as any).detectJumpLinks(p, new Uint32Array([0, 1, 2, 3, 4, 5])).length,
      ).toBeGreaterThan(0);
    });

    test("elevated→ground non-colocated (dd >= 0.1)", () => {
      const p = new Float32Array([0, 0, 0, 0, 0, 1, 1, 0, 0, 1, 2, 1, 1, 2, 2, 2, 2, 1]);
      expect(
        (mgr as any).detectJumpLinks(p, new Uint32Array([0, 1, 2, 3, 4, 5])).length,
      ).toBeGreaterThan(0);
    });

    test("xz dist > MAX_JUMP_XZ after offset", () => {
      const p = new Float32Array([...upTri(0, 0, 0), ...upTri(1, 10, 0)]);
      expect((mgr as any).detectJumpLinks(p, new Uint32Array([0, 1, 2, 3, 4, 5]))).toEqual([]);
    });
  });

  // ---- runNavMeshGeneration ----
  describe("runNavMeshGeneration", () => {
    const pos = () => new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]);
    const idx = () => new Uint32Array([0, 1, 2]);

    test("worker path", async () => {
      const w = {
        on: vi.fn(),
        postMessage: vi.fn(),
        terminate: vi.fn(),
        removeAllListeners: vi.fn(),
      };
      (mgr as any).worker = w;
      (mgr as any).workerReady = true;
      const p = (mgr as any).runNavMeshGeneration(pos(), idx(), []);
      const id = (mgr as any).requestCounter;
      (mgr as any).pendingRequests.get(id).resolve({
        success: true,
        navMeshData: new Uint8Array([1]).buffer,
        debugPositions: [],
        debugIndices: [],
      });
      expect((await p).success).toBe(true);
    });

    test("cancels old requests", async () => {
      const w = {
        on: vi.fn(),
        postMessage: vi.fn(),
        terminate: vi.fn(),
        removeAllListeners: vi.fn(),
      };
      (mgr as any).worker = w;
      (mgr as any).workerReady = true;
      const old = vi.fn();
      (mgr as any).pendingRequests.set(99, { resolve: old, timer: setTimeout(() => {}, 60000) });
      const p = (mgr as any).runNavMeshGeneration(pos(), idx(), []);
      expect(old).toHaveBeenCalledWith({ success: false, cancelled: true });
      const id = (mgr as any).requestCounter;
      (mgr as any).pendingRequests.get(id).resolve({
        success: true,
        navMeshData: new Uint8Array([1]).buffer,
        debugPositions: [],
        debugIndices: [],
      });
      await p;
    });

    test("worker failure", async () => {
      const w = {
        on: vi.fn(),
        postMessage: vi.fn(),
        terminate: vi.fn(),
        removeAllListeners: vi.fn(),
      };
      (mgr as any).worker = w;
      (mgr as any).workerReady = true;
      const p = (mgr as any).runNavMeshGeneration(pos(), idx(), []);
      (mgr as any).pendingRequests.get((mgr as any).requestCounter).resolve({
        success: false,
        error: "bad",
      });
      expect((await p).success).toBe(false);
    });

    test("worker cancelled", async () => {
      const w = {
        on: vi.fn(),
        postMessage: vi.fn(),
        terminate: vi.fn(),
        removeAllListeners: vi.fn(),
      };
      (mgr as any).worker = w;
      (mgr as any).workerReady = true;
      const p = (mgr as any).runNavMeshGeneration(pos(), idx(), []);
      (mgr as any).pendingRequests.get((mgr as any).requestCounter).resolve({
        success: false,
        cancelled: true,
      });
      expect((await p).success).toBe(false);
    });

    test("import returns null", async () => {
      const w = {
        on: vi.fn(),
        postMessage: vi.fn(),
        terminate: vi.fn(),
        removeAllListeners: vi.fn(),
      };
      (mgr as any).worker = w;
      (mgr as any).workerReady = true;
      mockImportNavMesh.mockReturnValueOnce({ navMesh: null });
      const p = (mgr as any).runNavMeshGeneration(pos(), idx(), []);
      (mgr as any).pendingRequests.get((mgr as any).requestCounter).resolve({
        success: true,
        navMeshData: new Uint8Array([1]).buffer,
        debugPositions: [],
        debugIndices: [],
      });
      expect((await p).success).toBe(false);
    });

    test("main thread fallback", async () => {
      (mgr as any).worker = null;
      (mgr as any).workerReady = false;
      expect((await (mgr as any).runNavMeshGeneration(pos(), idx(), [])).success).toBe(true);
    });

    test("main thread failure", async () => {
      (mgr as any).worker = null;
      (mgr as any).workerReady = false;
      mockGenerateTiledNavMesh.mockReturnValueOnce({ success: false, navMesh: null });
      expect((await (mgr as any).runNavMeshGeneration(pos(), idx(), [])).success).toBe(false);
    });
  });

  // ---- worker error ----
  describe("worker error", () => {
    test("resolves pending and terminates", async () => {
      const handlers: Record<string, (...args: Array<unknown>) => void> = {};
      const w = {
        on: vi.fn((e: string, h: (...args: Array<unknown>) => void) => {
          handlers[e] = h;
        }),
        postMessage: vi.fn(),
        terminate: vi.fn(),
      };
      const { Worker } = await import("worker_threads");
      (Worker as unknown as Mock).mockImplementationOnce(function () {
        return w;
      });
      const m = new NavMeshManager();
      (m as any).initialized = false;
      await m.init();
      const r = vi.fn();
      (m as any).pendingRequests.set(1, { resolve: r, timer: setTimeout(() => {}, 60000) });
      handlers["error"](new Error("crash"));
      expect(r).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
      expect((m as any).worker).toBeNull();
      m.dispose();
    });
  });

  // ---- worker timeout ----
  describe("worker timeout", () => {
    test("resolves with failure after 60s", async () => {
      vi.useFakeTimers();
      const w = {
        on: vi.fn(),
        postMessage: vi.fn(),
        terminate: vi.fn(),
        removeAllListeners: vi.fn(),
      };
      (mgr as any).worker = w;
      (mgr as any).workerReady = true;
      const p = (mgr as any).runNavMeshGeneration(
        new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]),
        new Uint32Array([0, 1, 2]),
        [],
      );
      vi.advanceTimersByTime(61_000);
      expect((await p).success).toBe(false);
      vi.useRealTimers();
    });
  });
});
