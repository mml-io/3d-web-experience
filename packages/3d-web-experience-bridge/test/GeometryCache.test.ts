import * as THREE from "three";
import { describe, expect, test, beforeEach } from "vitest";

import { GeometryCache } from "../src/GeometryCache";

function createBoxMesh(
  name: string,
  position: { x: number; y: number; z: number },
  size: number = 1,
): THREE.Mesh {
  const geometry = new THREE.BoxGeometry(size, size, size);
  const material = new THREE.MeshBasicMaterial();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.position.set(position.x, position.y, position.z);
  mesh.updateMatrixWorld(true);
  return mesh;
}

function createGroundMesh(): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(100, 100);
  geometry.rotateX(-Math.PI / 2);
  const material = new THREE.MeshBasicMaterial();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "ground-plane";
  mesh.updateMatrixWorld(true);
  return mesh;
}

describe("GeometryCache", () => {
  let cache: GeometryCache;

  beforeEach(() => {
    cache = new GeometryCache();
  });

  describe("getFilteredGeometry", () => {
    test("returns meshes within region box", () => {
      const mesh = createBoxMesh("box1", { x: 0, y: 0, z: 0 });
      const regionBox = new THREE.Box3(
        new THREE.Vector3(-10, -10, -10),
        new THREE.Vector3(10, 10, 10),
      );

      const result = cache.getFilteredGeometry([mesh], regionBox, 0.1);
      expect(result.perMesh).toHaveLength(1);
      expect(result.changed).toBe(true);
    });

    test("filters out meshes outside region box", () => {
      const mesh = createBoxMesh("farBox", { x: 1000, y: 0, z: 1000 });
      const regionBox = new THREE.Box3(
        new THREE.Vector3(-10, -10, -10),
        new THREE.Vector3(10, 10, 10),
      );

      const result = cache.getFilteredGeometry([mesh], regionBox, 0.1);
      expect(result.perMesh).toHaveLength(0);
    });

    test("filters out meshes smaller than minMeshXZ", () => {
      // Create a very small mesh
      const mesh = createBoxMesh("tinyBox", { x: 0, y: 0, z: 0 }, 0.01);
      const regionBox = new THREE.Box3(
        new THREE.Vector3(-10, -10, -10),
        new THREE.Vector3(10, 10, 10),
      );

      const result = cache.getFilteredGeometry([mesh], regionBox, 1.0);
      expect(result.perMesh).toHaveLength(0);
    });

    test("always includes ground-plane mesh regardless of size", () => {
      const ground = createGroundMesh();
      const regionBox = new THREE.Box3(
        new THREE.Vector3(-10, -10, -10),
        new THREE.Vector3(10, 10, 10),
      );

      // Even though ground mesh might be huge, the name check should include it
      const result = cache.getFilteredGeometry([ground], regionBox, 9999);
      expect(result.perMesh).toHaveLength(1);
      expect(result.perMesh[0].mesh.name).toBe("ground-plane");
    });

    test("caches geometry and reuses on same matrix hash", () => {
      const mesh = createBoxMesh("box1", { x: 5, y: 0, z: 5 });
      const regionBox = new THREE.Box3(
        new THREE.Vector3(-20, -20, -20),
        new THREE.Vector3(20, 20, 20),
      );

      // First call — changed should be true
      const result1 = cache.getFilteredGeometry([mesh], regionBox, 0.1);
      expect(result1.changed).toBe(true);

      // Second call with same mesh/matrix — changed should be false (cached)
      const result2 = cache.getFilteredGeometry([mesh], regionBox, 0.1);
      expect(result2.changed).toBe(false);
      expect(result2.perMesh).toHaveLength(1);
    });

    test("invalidates cache when matrix changes", () => {
      const mesh = createBoxMesh("box1", { x: 5, y: 0, z: 5 });
      const regionBox = new THREE.Box3(
        new THREE.Vector3(-20, -20, -20),
        new THREE.Vector3(20, 20, 20),
      );

      // First call
      cache.getFilteredGeometry([mesh], regionBox, 0.1);

      // Move the mesh
      mesh.position.set(8, 0, 8);
      mesh.updateMatrixWorld(true);

      // Second call — changed should be true because matrix changed
      const result2 = cache.getFilteredGeometry([mesh], regionBox, 0.1);
      expect(result2.changed).toBe(true);
    });

    test("removed meshes are cleaned from cache", () => {
      const mesh1 = createBoxMesh("box1", { x: 0, y: 0, z: 0 });
      const mesh2 = createBoxMesh("box2", { x: 5, y: 0, z: 5 });
      const regionBox = new THREE.Box3(
        new THREE.Vector3(-20, -20, -20),
        new THREE.Vector3(20, 20, 20),
      );

      // Cache both meshes
      cache.getFilteredGeometry([mesh1, mesh2], regionBox, 0.1);

      // Now only pass mesh1 — mesh2 is "removed"
      const result = cache.getFilteredGeometry([mesh1], regionBox, 0.1);
      expect(result.changed).toBe(true); // mesh2 was removed
      expect(result.perMesh).toHaveLength(1);
    });

    test("null regionBox includes all meshes", () => {
      const mesh = createBoxMesh("box1", { x: 1000, y: 0, z: 1000 });

      const result = cache.getFilteredGeometry([mesh], null, 0.1);
      expect(result.perMesh).toHaveLength(1);
    });

    test("handles non-indexed geometry", () => {
      // Create a non-indexed geometry
      const geometry = new THREE.BufferGeometry();
      const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
      geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      const material = new THREE.MeshBasicMaterial();
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = "nonIndexed";
      mesh.updateMatrixWorld(true);

      const result = cache.getFilteredGeometry([mesh], null, 0.0);
      expect(result.perMesh).toHaveLength(1);
      // Non-indexed generates sequential indices
      expect(result.perMesh[0].indices.length).toBe(3);
    });
  });

  describe("mergeGeometry", () => {
    test("merges multiple mesh geometries with correct offset", () => {
      const mesh1 = createBoxMesh("box1", { x: 0, y: 0, z: 0 });
      const mesh2 = createBoxMesh("box2", { x: 5, y: 0, z: 5 });

      const result = cache.getFilteredGeometry([mesh1, mesh2], null, 0.1);
      const [mergedPositions, mergedIndices] = cache.mergeGeometry(result.perMesh);

      // Should have combined positions from both meshes
      const mesh1PosCount = mesh1.geometry.attributes.position.count;
      const mesh2PosCount = mesh2.geometry.attributes.position.count;
      expect(mergedPositions.length).toBe((mesh1PosCount + mesh2PosCount) * 3);
      expect(mergedIndices.length).toBeGreaterThan(0);

      // Verify the second mesh's indices are offset correctly
      // The first index of the second mesh should be >= mesh1PosCount
      const indexAttr1 = mesh1.geometry.getIndex();
      if (indexAttr1) {
        const firstMeshIndexCount = indexAttr1.count;
        const secondMeshFirstIndex = mergedIndices[firstMeshIndexCount];
        expect(secondMeshFirstIndex).toBeGreaterThanOrEqual(mesh1PosCount);
      }
    });

    test("handles empty input", () => {
      const [mergedPositions, mergedIndices] = cache.mergeGeometry([]);
      expect(mergedPositions.length).toBe(0);
      expect(mergedIndices.length).toBe(0);
    });

    test("handles single mesh", () => {
      const mesh = createBoxMesh("box1", { x: 0, y: 0, z: 0 });
      const result = cache.getFilteredGeometry([mesh], null, 0.1);
      const [mergedPositions, mergedIndices] = cache.mergeGeometry(result.perMesh);

      const posCount = mesh.geometry.attributes.position.count;
      expect(mergedPositions.length).toBe(posCount * 3);
    });
  });

  describe("invalidateAll", () => {
    test("clears both caches", () => {
      const mesh = createBoxMesh("box1", { x: 0, y: 0, z: 0 });
      const regionBox = new THREE.Box3(
        new THREE.Vector3(-10, -10, -10),
        new THREE.Vector3(10, 10, 10),
      );

      // Populate cache
      cache.getFilteredGeometry([mesh], regionBox, 0.1);

      // Invalidate
      cache.invalidateAll();

      // Next call should report changed
      const result = cache.getFilteredGeometry([mesh], regionBox, 0.1);
      expect(result.changed).toBe(true);
    });
  });
});
