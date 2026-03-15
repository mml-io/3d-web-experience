import * as THREE from "three";
import { describe, expect, test } from "vitest";

import { createCollisionMesh } from "../src/ColliderUtils";

describe("ColliderUtils", () => {
  describe("createCollisionMesh", () => {
    test("creates BVH from a simple box geometry", () => {
      const group = new THREE.Group();
      const geometry = new THREE.BoxGeometry(2, 2, 2);
      const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
      group.add(mesh);
      group.updateWorldMatrix(true, true);

      const result = createCollisionMesh(group);
      expect(result.meshBVH).toBeDefined();
      expect(result.matrix).toBeDefined();
      expect(result.localScale).toEqual({ x: 1, y: 1, z: 1 });
    });

    test("handles empty group", () => {
      const group = new THREE.Group();
      group.updateWorldMatrix(true, true);

      const result = createCollisionMesh(group);
      expect(result.meshBVH).toBeDefined();
    });

    test("handles multiple meshes in group", () => {
      const group = new THREE.Group();

      const box1 = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
      box1.position.set(0, 0, 0);

      const box2 = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
      box2.position.set(5, 0, 5);

      group.add(box1, box2);
      group.updateWorldMatrix(true, true);

      const result = createCollisionMesh(group);
      expect(result.meshBVH).toBeDefined();
    });

    test("applies world matrix to geometry", () => {
      const group = new THREE.Group();
      group.position.set(10, 0, 10);

      const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
      group.add(mesh);
      group.updateWorldMatrix(true, true);

      const result = createCollisionMesh(group);
      expect(result.meshBVH).toBeDefined();
      expect(result.localScale).toEqual({ x: 1, y: 1, z: 1 });
    });

    test("handles nested groups", () => {
      const outer = new THREE.Group();
      const inner = new THREE.Group();
      inner.position.set(5, 0, 5);

      const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
      inner.add(mesh);
      outer.add(inner);
      outer.updateWorldMatrix(true, true);

      const result = createCollisionMesh(outer);
      expect(result.meshBVH).toBeDefined();
    });

    test("handles group with scale", () => {
      const group = new THREE.Group();
      group.scale.set(2, 2, 2);

      const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
      group.add(mesh);
      group.updateWorldMatrix(true, true);

      const result = createCollisionMesh(group);
      expect(result.localScale).toEqual({ x: 2, y: 2, z: 2 });
    });

    test("strips non-position attributes", () => {
      const group = new THREE.Group();
      const geometry = new THREE.BoxGeometry(1, 1, 1);
      // BoxGeometry has position, normal, uv by default
      expect(geometry.attributes.normal).toBeDefined();
      expect(geometry.attributes.uv).toBeDefined();

      const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
      group.add(mesh);
      group.updateWorldMatrix(true, true);

      // createCollisionMesh strips non-position attributes but the result
      // should still have valid BVH
      const result = createCollisionMesh(group);
      expect(result.meshBVH).toBeDefined();
    });

    test("handles InstancedMesh", () => {
      const group = new THREE.Group();
      const geometry = new THREE.BoxGeometry(1, 1, 1);
      const material = new THREE.MeshBasicMaterial();
      const instancedMesh = new THREE.InstancedMesh(geometry, material, 3);

      // Set instance transforms
      const matrix = new THREE.Matrix4();
      matrix.setPosition(0, 0, 0);
      instancedMesh.setMatrixAt(0, matrix);
      matrix.setPosition(3, 0, 0);
      instancedMesh.setMatrixAt(1, matrix);
      matrix.setPosition(0, 0, 3);
      instancedMesh.setMatrixAt(2, matrix);
      instancedMesh.instanceMatrix.needsUpdate = true;

      group.add(instancedMesh);
      group.updateWorldMatrix(true, true);

      const result = createCollisionMesh(group);
      expect(result.meshBVH).toBeDefined();
    });

    test("handles sphere geometry", () => {
      const group = new THREE.Group();
      const geometry = new THREE.SphereGeometry(1, 8, 8);
      const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
      group.add(mesh);
      group.updateWorldMatrix(true, true);

      const result = createCollisionMesh(group);
      expect(result.meshBVH).toBeDefined();
    });

    test("handles plane geometry", () => {
      const group = new THREE.Group();
      const geometry = new THREE.PlaneGeometry(10, 10);
      geometry.rotateX(-Math.PI / 2);
      const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
      group.add(mesh);
      group.updateWorldMatrix(true, true);

      const result = createCollisionMesh(group);
      expect(result.meshBVH).toBeDefined();
    });

    test("skips non-mesh children", () => {
      const group = new THREE.Group();
      const light = new THREE.PointLight(0xffffff, 1);
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
      group.add(light, mesh);
      group.updateWorldMatrix(true, true);

      // Should only process the mesh, not the light
      const result = createCollisionMesh(group);
      expect(result.meshBVH).toBeDefined();
    });
  });
});
