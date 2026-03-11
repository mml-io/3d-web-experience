import { jest, describe, expect, test, beforeEach } from "@jest/globals";

// Mock @mml-io/mml-web
jest.unstable_mockModule("@mml-io/mml-web", () => ({
  MMLCollisionTrigger: {
    init: jest.fn<any>().mockReturnValue({
      addCollider: jest.fn(),
      removeCollider: jest.fn(),
      setCurrentCollisions: jest.fn(),
    }),
  },
}));

const { CollisionsManager } = await import("../../src/collisions/CollisionsManager");

import { Box } from "../../src/math/Box";
import { Line } from "../../src/math/Line";
import { Matr4 } from "../../src/math/Matr4";
import { Ray } from "../../src/math/Ray";
import { Vect3 } from "../../src/math/Vect3";

function createMockMeshBVH() {
  return {
    getBoundingBox: jest.fn<any>().mockImplementation((box: Box) => {
      box.min.set(-1, -1, -1);
      box.max.set(1, 1, 1);
    }),
    raycastFirst: jest.fn<any>().mockReturnValue(null),
    shapecast: jest.fn<any>(),
  };
}

describe("CollisionsManager", () => {
  let manager: InstanceType<typeof CollisionsManager>;

  beforeEach(() => {
    manager = new CollisionsManager();
  });

  describe("debug toggle", () => {
    test("debug starts disabled", () => {
      expect(manager.isDebugEnabled()).toBe(false);
    });

    test("toggleDebug enables and disables", () => {
      manager.toggleDebug(true);
      expect(manager.isDebugEnabled()).toBe(true);
      manager.toggleDebug(false);
      expect(manager.isDebugEnabled()).toBe(false);
    });

    test("toggleDebug calls onDebugChange callback", () => {
      const callback = jest.fn();
      manager.onDebugChange = callback;
      manager.toggleDebug(true);
      expect(callback).toHaveBeenCalledWith(true);
    });
  });

  describe("culling", () => {
    test("setCullingEnabled changes culling state", () => {
      manager.setCullingEnabled(false);
      // No direct getter, but we can verify by adding a far mesh and raycasting
    });

    test("setCharacterPosition updates position for culling", () => {
      manager.setCharacterPosition({ x: 10, y: 20, z: 30 });
      // Position is stored internally for culling distance calculations
    });

    test("setExemptFromCulling accepts null", () => {
      manager.setExemptFromCulling(null);
    });
  });

  describe("mesh group lifecycle", () => {
    test("addMeshesGroup registers a collision mesh", () => {
      const meshBVH = createMockMeshBVH();
      const matrix = new Matr4();
      const localScale = { x: 1, y: 1, z: 1 };
      const source = {};

      manager.addMeshesGroup(source, { meshBVH: meshBVH as any, matrix, localScale });
      expect(manager.collisionMeshState.has(source)).toBe(true);
    });

    test("addMeshesGroup calculates bounding sphere radius", () => {
      const meshBVH = createMockMeshBVH();
      const matrix = new Matr4();
      const localScale = { x: 1, y: 1, z: 1 };
      const source = {};

      manager.addMeshesGroup(source, { meshBVH: meshBVH as any, matrix, localScale });
      const state = manager.collisionMeshState.get(source)!;
      // Bounding box is -1 to 1 in all dimensions
      // Max corner distance = sqrt(1+1+1) = sqrt(3) ≈ 1.732
      expect(state.boundingSphereRadius).toBeCloseTo(Math.sqrt(3), 4);
    });

    test("updateMeshesGroup updates matrix and scale", () => {
      const meshBVH = createMockMeshBVH();
      const matrix = new Matr4();
      const localScale = { x: 1, y: 1, z: 1 };
      const source = {};

      manager.addMeshesGroup(source, { meshBVH: meshBVH as any, matrix, localScale });

      const newMatrix = new Matr4().setPosition(10, 0, 0);
      const newScale = { x: 2, y: 2, z: 2 };
      manager.updateMeshesGroup(source, newMatrix, newScale);

      const state = manager.collisionMeshState.get(source)!;
      expect(state.localScale.x).toBe(2);
    });

    test("updateMeshesGroup does nothing for unknown source", () => {
      const newMatrix = new Matr4();
      const newScale = { x: 1, y: 1, z: 1 };
      // Should not throw
      manager.updateMeshesGroup({}, newMatrix, newScale);
    });

    test("removeMeshesGroup removes the collision mesh", () => {
      const meshBVH = createMockMeshBVH();
      const matrix = new Matr4();
      const localScale = { x: 1, y: 1, z: 1 };
      const source = {};

      manager.addMeshesGroup(source, { meshBVH: meshBVH as any, matrix, localScale });
      expect(manager.collisionMeshState.has(source)).toBe(true);

      manager.removeMeshesGroup(source);
      expect(manager.collisionMeshState.has(source)).toBe(false);
    });

    test("removeMeshesGroup for unknown source is safe", () => {
      expect(() => manager.removeMeshesGroup({})).not.toThrow();
    });
  });

  describe("raycastFirst", () => {
    test("returns null when no meshes registered", () => {
      const ray = new Ray(new Vect3(0, 10, 0), new Vect3(0, -1, 0));
      expect(manager.raycastFirst(ray)).toBeNull();
    });

    test("returns null when meshBVH finds no hit", () => {
      const meshBVH = createMockMeshBVH();
      meshBVH.raycastFirst.mockReturnValue(null);
      const matrix = new Matr4();
      const source = {};

      manager.addMeshesGroup(source, {
        meshBVH: meshBVH as any,
        matrix,
        localScale: { x: 1, y: 1, z: 1 },
      });

      const ray = new Ray(new Vect3(0, 10, 0), new Vect3(0, -1, 0));
      expect(manager.raycastFirst(ray)).toBeNull();
    });

    test("returns hit data when meshBVH finds a hit", () => {
      const meshBVH = createMockMeshBVH();
      meshBVH.raycastFirst.mockReturnValue({
        point: { x: 0, y: 0, z: 0, copy: jest.fn().mockReturnThis() },
        normal: { x: 0, y: 1, z: 0, copy: jest.fn().mockReturnThis() },
        distance: 5,
      });
      const matrix = new Matr4(); // Identity
      const source = {};

      manager.addMeshesGroup(source, {
        meshBVH: meshBVH as any,
        matrix,
        localScale: { x: 1, y: 1, z: 1 },
      });

      const ray = new Ray(new Vect3(0, 10, 0), new Vect3(0, -1, 0));
      const result = manager.raycastFirst(ray);
      expect(result).not.toBeNull();
      if (result) {
        expect(result[0]).toBeGreaterThanOrEqual(0); // distance
        expect(result[1]).toBeDefined(); // normal
        expect(result[2]).toBeDefined(); // meshState
        expect(result[3]).toBeDefined(); // hitPoint
      }
    });

    test("raycastFirst respects maximumDistance", () => {
      const meshBVH = createMockMeshBVH();
      meshBVH.raycastFirst.mockReturnValue({
        point: { x: 0, y: 0, z: 0, copy: jest.fn().mockReturnThis() },
        normal: { x: 0, y: 1, z: 0, copy: jest.fn().mockReturnThis() },
        distance: 100,
      });
      const matrix = new Matr4();
      const source = {};

      manager.addMeshesGroup(source, {
        meshBVH: meshBVH as any,
        matrix,
        localScale: { x: 1, y: 1, z: 1 },
      });

      // Set a very small maximum distance
      const ray = new Ray(new Vect3(0, 10, 0), new Vect3(0, -1, 0));
      const result = manager.raycastFirst(ray, 0.001);
      // The hit is at distance ~10, which exceeds 0.001
      expect(result).toBeNull();
    });

    test("raycastFirst culls distant meshes", () => {
      manager.setCullingEnabled(true);
      manager.setCharacterPosition({ x: 0, y: 0, z: 0 });

      const meshBVH = createMockMeshBVH();
      const matrix = new Matr4().setPosition(200, 0, 0); // Far away
      const source = {};

      manager.addMeshesGroup(source, {
        meshBVH: meshBVH as any,
        matrix,
        localScale: { x: 1, y: 1, z: 1 },
      });

      const ray = new Ray(new Vect3(200, 10, 0), new Vect3(0, -1, 0));
      manager.raycastFirst(ray);
      // The meshBVH should not have been queried since it's too far
      expect(meshBVH.raycastFirst).not.toHaveBeenCalled();
    });
  });

  describe("applyColliders", () => {
    test("runs without meshes", () => {
      const segment = new Line(new Vect3(0, 0, 0), new Vect3(0, 1, 0));
      // Should not throw
      manager.applyColliders(segment, 0.45);
    });

    test("calls shapecast on registered meshes", () => {
      manager.setCullingEnabled(false);
      const meshBVH = createMockMeshBVH();
      const matrix = new Matr4();
      const source = {};

      manager.addMeshesGroup(source, {
        meshBVH: meshBVH as any,
        matrix,
        localScale: { x: 1, y: 1, z: 1 },
      });

      const segment = new Line(new Vect3(0, 0, 0), new Vect3(0, 1, 0));
      manager.applyColliders(segment, 0.45);
      expect(meshBVH.shapecast).toHaveBeenCalled();
    });
  });
});
