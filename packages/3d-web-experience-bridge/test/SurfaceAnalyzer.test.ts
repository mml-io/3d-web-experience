/**
 * Tests for SurfaceAnalyzer.ts — validates surface discovery, occupancy
 * detection, free-space computation, and scoring.
 */
import { describe, expect, test, beforeEach, afterEach, beforeAll, vi } from "vitest";

import { installNodePolyfills } from "../src/node-polyfills";
installNodePolyfills();

vi.mock("@mml-io/3d-web-client-core", () => ({
  CollisionsManager: vi.fn().mockImplementation(function () {
    return {
      addMeshesGroup: vi.fn(),
      setCharacterPosition: vi.fn(),
      updateMeshesGroup: vi.fn(),
      removeMeshesGroup: vi.fn(),
    };
  }),
  Matr4: vi.fn().mockImplementation(function () {
    return {
      fromArray: vi.fn().mockReturnThis(),
    };
  }),
}));

vi.mock("../src/ColliderUtils", () => ({
  createCollisionMesh: vi.fn().mockReturnValue({
    meshBVH: {},
    matrix: { fromArray: vi.fn() },
    localScale: { x: 1, y: 1, z: 1 },
  }),
}));

let HeadlessMMLScene: any;
let CollisionsManager: any;
let findSurfaceSpots: any;
let THREE: any;

beforeAll(async () => {
  THREE = await import("three");
  const sceneModule = await import("../src/HeadlessMMLScene");
  HeadlessMMLScene = sceneModule.HeadlessMMLScene;
  const coreModule = await import("@mml-io/3d-web-client-core");
  CollisionsManager = coreModule.CollisionsManager;
  const surfaceModule = await import("../src/SurfaceAnalyzer");
  findSurfaceSpots = surfaceModule.findSurfaceSpots;
});

describe("SurfaceAnalyzer", () => {
  let scene: any;
  let mockNavMeshManager: any;
  const agentPos = { x: 0, y: 0, z: 0 };

  function createSceneElement(tagName: string): any {
    return (scene as any).virtualDoc.createElement(tagName);
  }

  function appendToRoot(el: any): void {
    (scene as any).root.appendChild(el);
  }

  beforeEach(() => {
    const collisionsManager = new CollisionsManager();
    const getPos = () => ({
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
    });
    scene = new HeadlessMMLScene(getPos, collisionsManager);

    mockNavMeshManager = {
      isReady: false,
      computePath: vi.fn().mockReturnValue(null),
    };
  });

  afterEach(() => {
    scene.dispose();
  });

  describe("findSurfaceSpots", () => {
    test("does not throw on an empty scene", () => {
      // This is the core regression test for issue #3: findSurfaceSpots used
      // document.querySelectorAll on the global stub document which doesn't
      // implement querySelectorAll. It must query the virtual DOM instead.
      expect(() => {
        findSurfaceSpots(scene, mockNavMeshManager, agentPos);
      }).not.toThrow();
    });

    test("returns empty array when no candidate elements exist", () => {
      const results = findSurfaceSpots(scene, mockNavMeshManager, agentPos);
      expect(results).toEqual([]);
    });

    test("returns empty array when elements have no geometry containers", () => {
      const cube = createSceneElement("m-cube");
      appendToRoot(cube);

      // Element exists in virtual DOM but has no getContainer method,
      // so it should be skipped gracefully
      const results = findSurfaceSpots(scene, mockNavMeshManager, agentPos);
      expect(results).toEqual([]);
    });

    test("detects a flat m-cube as a surface", () => {
      const cube = createSceneElement("m-cube");
      appendToRoot(cube);

      // Give it a container with a flat box geometry (table-like: wide, shallow)
      const group = new THREE.Group();
      const geometry = new THREE.BoxGeometry(2, 0.1, 2);
      const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
      group.add(mesh);
      group.position.set(0, 1, 0); // At height 1m — within the 0.3–5.0 range
      group.updateMatrixWorld(true);

      cube.getContainer = () => group;

      const results = findSurfaceSpots(scene, mockNavMeshManager, agentPos);
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].surfaceTag).toBe("m-cube");
      expect(results[0].surfaceY).toBeGreaterThan(0);
    });

    test("filters by surfaceClass option", () => {
      const cube = createSceneElement("m-cube");
      cube.setAttribute("class", "table");
      appendToRoot(cube);

      const group = new THREE.Group();
      const geometry = new THREE.BoxGeometry(2, 0.1, 2);
      const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
      group.add(mesh);
      group.position.set(0, 1, 0);
      group.updateMatrixWorld(true);
      cube.getContainer = () => group;

      // Should find the cube when filtering by its class
      const withClass = findSurfaceSpots(scene, mockNavMeshManager, agentPos, {
        surfaceClass: "table",
      });

      // Should NOT find it when filtering by a different class
      const withOtherClass = findSurfaceSpots(scene, mockNavMeshManager, agentPos, {
        surfaceClass: "shelf",
      });

      expect(withClass.length).toBeGreaterThanOrEqual(1);
      expect(withOtherClass).toEqual([]);
    });

    test("excludes surfaces below minimum height", () => {
      const cube = createSceneElement("m-cube");
      appendToRoot(cube);

      const group = new THREE.Group();
      const geometry = new THREE.BoxGeometry(2, 0.1, 2);
      const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
      group.add(mesh);
      group.position.set(0, 0.1, 0); // Top at ~0.15m — below the 0.3 threshold
      group.updateMatrixWorld(true);
      cube.getContainer = () => group;

      const results = findSurfaceSpots(scene, mockNavMeshManager, agentPos);
      expect(results).toEqual([]);
    });

    test("excludes surfaces above maximum height", () => {
      const cube = createSceneElement("m-cube");
      appendToRoot(cube);

      const group = new THREE.Group();
      const geometry = new THREE.BoxGeometry(2, 0.1, 2);
      const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
      group.add(mesh);
      group.position.set(0, 6, 0); // Top at ~6.05m — above the 5.0 threshold
      group.updateMatrixWorld(true);
      cube.getContainer = () => group;

      const results = findSurfaceSpots(scene, mockNavMeshManager, agentPos);
      expect(results).toEqual([]);
    });

    test("excludes surfaces outside search radius", () => {
      const cube = createSceneElement("m-cube");
      appendToRoot(cube);

      const group = new THREE.Group();
      const geometry = new THREE.BoxGeometry(2, 0.1, 2);
      const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
      group.add(mesh);
      group.position.set(50, 1, 50); // Far from agent
      group.updateMatrixWorld(true);
      cube.getContainer = () => group;

      const results = findSurfaceSpots(scene, mockNavMeshManager, agentPos, { radius: 5 });
      expect(results).toEqual([]);
    });

    test("excludes tall cubes that are not flat surfaces", () => {
      const cube = createSceneElement("m-cube");
      appendToRoot(cube);

      // A tall, narrow cube (pillar) — height >= 0.6 * max(width, depth)
      const group = new THREE.Group();
      const geometry = new THREE.BoxGeometry(1, 3, 1);
      const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
      group.add(mesh);
      group.position.set(0, 1.5, 0);
      group.updateMatrixWorld(true);
      cube.getContainer = () => group;

      const results = findSurfaceSpots(scene, mockNavMeshManager, agentPos);
      expect(results).toEqual([]);
    });

    test("respects maxResults option", () => {
      // Create 3 flat cubes at different positions
      for (let i = 0; i < 3; i++) {
        const cube = createSceneElement("m-cube");
        appendToRoot(cube);

        const group = new THREE.Group();
        const geometry = new THREE.BoxGeometry(2, 0.1, 2);
        const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
        group.add(mesh);
        group.position.set(i * 4, 1, 0);
        group.updateMatrixWorld(true);
        cube.getContainer = () => group;
      }

      const results = findSurfaceSpots(scene, mockNavMeshManager, agentPos, { maxResults: 2 });
      expect(results.length).toBeLessThanOrEqual(2);
    });

    test("results are sorted by score descending", () => {
      // Create two surfaces — one close, one farther away
      for (const x of [1, 8]) {
        const cube = createSceneElement("m-cube");
        appendToRoot(cube);

        const group = new THREE.Group();
        const geometry = new THREE.BoxGeometry(2, 0.1, 2);
        const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
        group.add(mesh);
        group.position.set(x, 1, 0);
        group.updateMatrixWorld(true);
        cube.getContainer = () => group;
      }

      const results = findSurfaceSpots(scene, mockNavMeshManager, agentPos, { maxResults: 10 });
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
      }
    });

    test("detects m-model surfaces via triangle analysis", () => {
      const model = createSceneElement("m-model");
      appendToRoot(model);

      // Create a flat mesh with upward-facing triangles (table top)
      const group = new THREE.Group();
      const geometry = new THREE.PlaneGeometry(3, 3);
      geometry.rotateX(-Math.PI / 2); // Make it horizontal (facing up)
      const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
      group.add(mesh);
      group.position.set(0, 1, 0);
      group.updateMatrixWorld(true);
      model.getContainer = () => group;

      const results = findSurfaceSpots(scene, mockNavMeshManager, agentPos);
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].surfaceTag).toBe("m-model");
    });

    test("checks reachability when navmesh is ready", () => {
      const cube = createSceneElement("m-cube");
      appendToRoot(cube);

      const group = new THREE.Group();
      const geometry = new THREE.BoxGeometry(2, 0.1, 2);
      const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
      group.add(mesh);
      group.position.set(0, 1, 0);
      group.updateMatrixWorld(true);
      cube.getContainer = () => group;

      mockNavMeshManager.isReady = true;
      mockNavMeshManager.computePath.mockReturnValue([
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 0 },
      ]);

      const results = findSurfaceSpots(scene, mockNavMeshManager, agentPos);
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].reachable).toBe(true);
      expect(mockNavMeshManager.computePath).toHaveBeenCalled();
    });

    test("marks surface as not reachable when navmesh has no path", () => {
      const cube = createSceneElement("m-cube");
      appendToRoot(cube);

      const group = new THREE.Group();
      const geometry = new THREE.BoxGeometry(2, 0.1, 2);
      const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
      group.add(mesh);
      group.position.set(0, 1, 0);
      group.updateMatrixWorld(true);
      cube.getContainer = () => group;

      mockNavMeshManager.isReady = true;
      mockNavMeshManager.computePath.mockReturnValue(null);

      const results = findSurfaceSpots(scene, mockNavMeshManager, agentPos);
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].reachable).toBe(false);
    });
  });
});
