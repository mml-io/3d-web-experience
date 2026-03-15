/**
 * Utility for creating CollisionMesh objects from Three.js groups.
 *
 * This is the headless equivalent of ThreeJSCollisionManager.createCollisionMesh
 * from @mml-io/3d-web-threejs. It creates BVH structures from Three.js geometry
 * so that CollisionsManager can use them for capsule collision detection.
 */
import { type CollisionMesh, Matr4 } from "@mml-io/3d-web-client-core";
import * as THREE from "three";
import * as BufferGeometryUtils from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { MeshBVH } from "three-mesh-bvh/src/index.js";

export function createCollisionMesh(group: THREE.Object3D): CollisionMesh {
  const geometries: THREE.BufferGeometry[] = [];
  const tempMatrix = new THREE.Matrix4();

  group.updateWorldMatrix(true, true);

  group.traverse((child) => {
    const asMesh = child as THREE.Mesh;
    if (!asMesh.isMesh) return;

    const asInstanced = asMesh as THREE.InstancedMesh;
    if (asInstanced.isInstancedMesh) {
      const instanceMatrix = new THREE.Matrix4();
      const relativeMatrix = new THREE.Matrix4();
      relativeMatrix.identity();
      let current: THREE.Object3D | null = asInstanced;
      while (current && current !== group) {
        current.updateMatrix();
        relativeMatrix.premultiply(current.matrix);
        current = current.parent;
      }

      for (let i = 0; i < asInstanced.count; i++) {
        const clonedGeometry = asInstanced.geometry.clone();
        for (const key in clonedGeometry.attributes) {
          if (key !== "position") {
            clonedGeometry.deleteAttribute(key);
          }
        }
        instanceMatrix.fromArray(asInstanced.instanceMatrix.array, i * 16);
        clonedGeometry.applyMatrix4(instanceMatrix);
        clonedGeometry.applyMatrix4(relativeMatrix);
        geometries.push(clonedGeometry.index ? clonedGeometry.toNonIndexed() : clonedGeometry);
      }
      return;
    }

    const clonedGeometry = asMesh.geometry.clone();

    for (const key in clonedGeometry.attributes) {
      if (key !== "position") {
        clonedGeometry.deleteAttribute(key);
      }
    }

    tempMatrix.identity();
    let current: THREE.Object3D | null = asMesh;
    while (current && current !== group) {
      current.updateMatrix();
      tempMatrix.premultiply(current.matrix);
      current = current.parent;
    }
    clonedGeometry.applyMatrix4(tempMatrix);

    geometries.push(clonedGeometry.index ? clonedGeometry.toNonIndexed() : clonedGeometry);
  });

  let bufferGeometry: THREE.BufferGeometry;
  if (geometries.length === 0) {
    bufferGeometry = new THREE.BufferGeometry();
    bufferGeometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(new Float32Array(), 3),
    );
  } else {
    bufferGeometry = BufferGeometryUtils.mergeGeometries(geometries, false);
    for (const g of geometries) g.dispose();
    bufferGeometry.computeVertexNormals();
  }

  let meshBVH: MeshBVH;
  try {
    meshBVH = new MeshBVH(bufferGeometry);
  } catch (err) {
    console.warn("[collider-utils] BVH construction failed:", err);
    throw err;
  }
  return {
    meshBVH,
    matrix: new Matr4().fromArray(group.matrixWorld.elements as unknown as Float32Array),
    localScale: {
      x: group.scale.x,
      y: group.scale.y,
      z: group.scale.z,
    },
  };
}
