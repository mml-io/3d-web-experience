/**
 * Integration tests for collision detection with a GLB model at different scales.
 *
 * Tests that capsule collision detection works correctly when the model
 * is scaled by different factors (sx/sy/sz). Uses node:test because
 * Three.js ESM loaders require real module loading (not vitest transforms).
 *
 * Run: npx tsx --test test/museum-collision.test.ts
 */
import { readFileSync } from "fs";
import assert from "node:assert";
import { describe, it, before } from "node:test";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

import {
  CollisionsManager,
  Vect3,
  Line as CoreLine,
  Box as CoreBox,
  Matr4,
} from "@mml-io/3d-web-client-core";

import { installNodePolyfills } from "../src/node-polyfills";

installNodePolyfills();

const __dirname_test = dirname(fileURLToPath(import.meta.url));

function loadGlbBuffer(filePath: string): ArrayBuffer {
  const buf = readFileSync(filePath);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

// Capsule parameters matching LocalController defaults
const CAPSULE_RADIUS = 0.45;
const CAPSULE_SEGMENT_END_Y = 1.05;

// CollisionsManager default culling parameters
const CULLING_RADIUS = 50;

// Duck model-space surface positions (from BVH bounds inspection).
// The duck body spans roughly x: [-0.69, 0.96], y: [0.10, 1.64], z: [-0.61, 0.54].
// A path along the X axis at the duck's body center height crosses the +X surface.
const MODEL_SURFACE_X = 0.578; // +X body surface
const MODEL_PATH_Y = 0.5; // mid-body height in model-space
const MODEL_PATH_Z = -0.04; // roughly centered in Z

// Path endpoints in model-space: outside the body → inside, crossing the +X surface
const MODEL_FROM_X = 1.0;
const MODEL_TO_X = 0.2;

let THREE: typeof import("three");
let GLTFLoader: any;
let MeshBVH: any;
let BufferGeometryUtils: any;

type CollisionData = {
  meshBVH: any;
  worldMatrix: InstanceType<typeof THREE.Matrix4>;
  localScale: { x: number; y: number; z: number };
  boundingSphereRadius: number;
};

type CollisionResult = {
  collided: boolean;
  displacement: { x: number; y: number; z: number };
};

async function loadModel(): Promise<InstanceType<typeof THREE.Group>> {
  const modelPath = resolve(__dirname_test, "Duck.glb");
  const buffer = loadGlbBuffer(modelPath);
  const loader = new GLTFLoader();
  const gltf = await new Promise<any>((resolve, reject) => {
    loader.parse(buffer, "", resolve, reject);
  });
  return gltf.scene;
}

/**
 * Create a BVH collision mesh from the loaded scene at the specified uniform scale.
 * Replicates the logic from ColliderUtils.createCollisionMesh.
 */
function createCollisionData(
  scene: InstanceType<typeof THREE.Group>,
  scale: number,
): CollisionData {
  const group = scene.clone(true);
  group.scale.set(scale, scale, scale);
  group.updateWorldMatrix(true, true);

  const geometries: InstanceType<typeof THREE.BufferGeometry>[] = [];
  const tempMatrix = new THREE.Matrix4();

  group.traverse((child: any) => {
    if (!child.isMesh) return;

    const clonedGeom = child.geometry.clone();
    for (const key in clonedGeom.attributes) {
      if (key !== "position") clonedGeom.deleteAttribute(key);
    }

    // Accumulate transforms from mesh up to (but not including) the group root
    tempMatrix.identity();
    let current = child;
    while (current && current !== group) {
      current.updateMatrix();
      tempMatrix.premultiply(current.matrix);
      current = current.parent;
    }
    clonedGeom.applyMatrix4(tempMatrix);

    if (clonedGeom.index) {
      geometries.push(clonedGeom.toNonIndexed());
    } else {
      geometries.push(clonedGeom);
    }
  });

  let bufferGeometry: InstanceType<typeof THREE.BufferGeometry>;
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

  const meshBVH = new MeshBVH(bufferGeometry);

  // Compute bounding sphere radius (matching CollisionsManager.addMeshesGroup)
  const bbox = new THREE.Box3();
  meshBVH.getBoundingBox(bbox);
  const corners = [
    [bbox.min.x, bbox.min.y, bbox.min.z],
    [bbox.min.x, bbox.min.y, bbox.max.z],
    [bbox.min.x, bbox.max.y, bbox.min.z],
    [bbox.min.x, bbox.max.y, bbox.max.z],
    [bbox.max.x, bbox.min.y, bbox.min.z],
    [bbox.max.x, bbox.min.y, bbox.max.z],
    [bbox.max.x, bbox.max.y, bbox.min.z],
    [bbox.max.x, bbox.max.y, bbox.max.z],
  ];
  const maxRadiusSq = Math.max(...corners.map(([x, y, z]) => x * x + y * y + z * z));
  const boundingSphereRadius = Math.sqrt(maxRadiusSq);

  return {
    meshBVH,
    worldMatrix: group.matrixWorld.clone(),
    localScale: { x: scale, y: scale, z: scale },
    boundingSphereRadius,
  };
}

/**
 * Test if a capsule at the given position collides with the mesh.
 * Replicates the core logic from CollisionsManager.applyCollider.
 */
function testCapsuleCollision(
  collisionData: CollisionData,
  position: { x: number; y: number; z: number },
): CollisionResult {
  const { meshBVH, worldMatrix } = collisionData;

  // Build world-space capsule segment (matching LocalController.update)
  const capsuleStart = new THREE.Vector3(position.x, position.y + CAPSULE_RADIUS, position.z);
  const capsuleEnd = new THREE.Vector3(
    position.x,
    position.y + CAPSULE_SEGMENT_END_Y + CAPSULE_RADIUS,
    position.z,
  );

  const invertedMatrix = worldMatrix.clone().invert();

  // Build bounding box in world space, expand by capsule radius, transform to mesh-space
  const capsuleBBox = new THREE.Box3();
  capsuleBBox.expandByPoint(capsuleStart);
  capsuleBBox.expandByPoint(capsuleEnd);
  capsuleBBox.min.subScalar(CAPSULE_RADIUS);
  capsuleBBox.max.addScalar(CAPSULE_RADIUS);
  capsuleBBox.applyMatrix4(invertedMatrix);

  // Transform capsule segment to mesh-space
  const meshSegStart = capsuleStart.clone().applyMatrix4(invertedMatrix);
  const meshSegEnd = capsuleEnd.clone().applyMatrix4(invertedMatrix);
  const meshSeg = new THREE.Line3(meshSegStart, meshSegEnd);

  const initialMeshSegStart = meshSegStart.clone();

  let collisionDetected = false;

  meshBVH.shapecast({
    intersectsBounds: (meshBox: InstanceType<typeof THREE.Box3>) => {
      return meshBox.intersectsBox(capsuleBBox);
    },
    intersectsTriangle: (meshTriangle: any) => {
      const closestOnTri = new THREE.Vector3();
      const closestOnSeg = new THREE.Vector3();

      meshTriangle.closestPointToSegment(meshSeg, closestOnTri, closestOnSeg);

      // Measure distance in mesh-space
      const modelRefDist = closestOnTri.distanceTo(closestOnSeg);

      // Measure real (world-space) distance
      const worldClosestOnTri = closestOnTri.clone().applyMatrix4(worldMatrix);
      const worldClosestOnSeg = closestOnSeg.clone().applyMatrix4(worldMatrix);
      const realDist = worldClosestOnTri.distanceTo(worldClosestOnSeg);

      if (realDist < CAPSULE_RADIUS) {
        collisionDetected = true;

        const ratio = realDist / modelRefDist;
        const realDepth = CAPSULE_RADIUS - realDist;
        const modelDepth = realDepth / ratio;

        const direction = closestOnSeg.clone().sub(closestOnTri).normalize();
        meshSeg.start.addScaledVector(direction, modelDepth);
        meshSeg.end.addScaledVector(direction, modelDepth);
      }
    },
  });

  if (collisionDetected) {
    const delta = meshSeg.start.clone().sub(initialMeshSegStart);
    const matrixNoPos = worldMatrix.clone();
    matrixNoPos.setPosition(0, 0, 0);
    delta.applyMatrix4(matrixNoPos);

    if (!(isNaN(delta.x) && isNaN(delta.y) && isNaN(delta.z))) {
      return {
        collided: true,
        displacement: { x: delta.x, y: delta.y, z: delta.z },
      };
    }
  }

  return { collided: false, displacement: { x: 0, y: 0, z: 0 } };
}

/**
 * Raycast in the -X direction from a position to verify surface geometry exists.
 * Returns the world-space hit distance, or null if no hit.
 */
function raycastTowardSurface(
  collisionData: CollisionData,
  position: { x: number; y: number; z: number },
  maxDistance: number = 50,
): number | null {
  const { meshBVH, worldMatrix } = collisionData;
  const invertedMatrix = worldMatrix.clone().invert();

  const ray = new THREE.Ray(
    new THREE.Vector3(position.x, position.y + 0.5, position.z),
    new THREE.Vector3(-1, 0, 0), // toward the duck body from outside
  );
  ray.applyMatrix4(invertedMatrix);

  const hit = meshBVH.raycastFirst(ray, 2 /* DoubleSide */);
  if (!hit) return null;

  const segStart = ray.origin.clone();
  const segEnd = hit.point.clone();
  segStart.applyMatrix4(worldMatrix);
  segEnd.applyMatrix4(worldMatrix);
  const dist = segStart.distanceTo(segEnd);

  return dist <= maxDistance ? dist : null;
}

/**
 * Scan positions along a movement path to find where collisions occur.
 */
function scanPathCollisions(
  data: CollisionData,
  from: { x: number; y: number; z: number },
  to: { x: number; y: number; z: number },
  steps: number = 20,
) {
  const results: { t: number; x: number; z: number; collided: boolean }[] = [];
  let collisionCount = 0;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const pos = {
      x: from.x + (to.x - from.x) * t,
      y: from.y + (to.y - from.y) * t,
      z: from.z + (to.z - from.z) * t,
    };
    const result = testCapsuleCollision(data, pos);
    results.push({ t, x: pos.x, z: pos.z, collided: result.collided });
    if (result.collided) collisionCount++;
  }
  return { results, collisionCount, total: steps + 1 };
}

/**
 * Simulate CollisionsManager's culling check for a mesh at a given character position.
 * Derives world scale from the matrix (matching the production fix) rather than
 * relying on localScale, which may only reflect the group's own scale and miss
 * parent transforms.
 * Returns true if the mesh would be culled (skipped).
 */
function wouldBeCulled(
  data: CollisionData,
  characterPosition: { x: number; y: number; z: number },
): boolean {
  const matData = data.worldMatrix.elements;
  const dx = matData[12] - characterPosition.x;
  const dy = matData[13] - characterPosition.y;
  const dz = matData[14] - characterPosition.z;
  const distanceSquared = dx * dx + dy * dy + dz * dz;

  // Derive scale from the matrix (matches CollisionsManager.isMeshWithinCullingDistance)
  const sxSq = matData[0] * matData[0] + matData[1] * matData[1] + matData[2] * matData[2];
  const sySq = matData[4] * matData[4] + matData[5] * matData[5] + matData[6] * matData[6];
  const szSq = matData[8] * matData[8] + matData[9] * matData[9] + matData[10] * matData[10];
  const maxScaleSq = Math.max(sxSq, sySq, szSq);

  const R = CULLING_RADIUS;
  const bsr = data.boundingSphereRadius;
  const L = distanceSquared - R * R - bsr * bsr * maxScaleSq;
  return !(L <= 0 || L * L <= 4 * R * R * bsr * bsr * maxScaleSq);
}

function formatScanResults(
  results: { t: number; x: number; z: number; collided: boolean }[],
): string {
  return results
    .map((r) => `  t=${r.t.toFixed(2)} (${r.x.toFixed(3)},${r.z.toFixed(3)}) → ${r.collided}`)
    .join("\n");
}

/** Build world-space test path endpoints for a given scale */
function pathForScale(scale: number) {
  return {
    from: { x: MODEL_FROM_X * scale, y: MODEL_PATH_Y * scale, z: MODEL_PATH_Z * scale },
    to: { x: MODEL_TO_X * scale, y: MODEL_PATH_Y * scale, z: MODEL_PATH_Z * scale },
  };
}

/** Raycast start position: just outside the +X surface at the path height */
function raycastPosForScale(scale: number) {
  return { x: MODEL_FROM_X * scale, y: MODEL_PATH_Y * scale, z: MODEL_PATH_Z * scale };
}

async function initThreeModules() {
  THREE = await import("three");
  const gltfMod = await import("three/examples/jsm/loaders/GLTFLoader.js");
  GLTFLoader = gltfMod.GLTFLoader;
  const bvhMod = await import("three-mesh-bvh/src/index.js");
  MeshBVH = bvhMod.MeshBVH;
  BufferGeometryUtils = await import("three/examples/jsm/utils/BufferGeometryUtils.js");
}

describe("model collision detection at different scales", { timeout: 60000 }, async () => {
  let gltfScene: InstanceType<typeof THREE.Group>;

  before(async () => {
    await initThreeModules();
    gltfScene = await loadModel();
    assert.ok(gltfScene instanceof THREE.Group, "loaded scene should be a THREE.Group");
  });

  it("model loads with mesh geometry suitable for collision", () => {
    const data = createCollisionData(gltfScene, 1);
    const bbox = new THREE.Box3();
    data.meshBVH.getBoundingBox(bbox);
    const size = new THREE.Vector3();
    bbox.getSize(size);

    assert.ok(size.x > 0, `BVH should have nonzero width, got ${size.x}`);
    assert.ok(size.y > 0, `BVH should have nonzero height, got ${size.y}`);
    assert.ok(size.z > 0, `BVH should have nonzero depth, got ${size.z}`);
  });

  it("surface geometry exists near the test positions at scale 15", () => {
    const data = createCollisionData(gltfScene, 15);
    const dist = raycastTowardSurface(data, raycastPosForScale(15));
    assert.ok(dist !== null, "should find surface geometry via raycast at scale 15");
    assert.ok(dist! < 10, `surface should be within 10 units at scale 15, got ${dist}`);
  });

  it("surface geometry exists near the test positions at scale 19", () => {
    const data = createCollisionData(gltfScene, 19);
    const dist = raycastTowardSurface(data, raycastPosForScale(19));
    assert.ok(dist !== null, "should find surface geometry via raycast at scale 19");
    assert.ok(dist! < 10, `surface should be within 10 units at scale 19, got ${dist}`);
  });

  it("capsule at scale 15 collides along path crossing the model surface", () => {
    const data = createCollisionData(gltfScene, 15);
    const { from, to } = pathForScale(15);
    const { results, collisionCount, total } = scanPathCollisions(data, from, to);
    assert.ok(
      collisionCount > 0,
      `no collision at any of ${total} positions along scale-15 path.\n${formatScanResults(results)}`,
    );
  });

  it("capsule at scale 19 collides along path crossing the model surface", () => {
    const data = createCollisionData(gltfScene, 19);
    const { from, to } = pathForScale(19);
    const { results, collisionCount, total } = scanPathCollisions(data, from, to);
    assert.ok(
      collisionCount > 0,
      `no collision at any of ${total} positions along scale-19 path.\n${formatScanResults(results)}`,
    );
  });

  it("collision coverage is comparable between scale 15 and scale 19 for proportional paths", () => {
    const data15 = createCollisionData(gltfScene, 15);
    const path15 = pathForScale(15);
    const scan15 = scanPathCollisions(data15, path15.from, path15.to, 40);

    const data19 = createCollisionData(gltfScene, 19);
    const path19 = pathForScale(19);
    const scan19 = scanPathCollisions(data19, path19.from, path19.to, 40);

    const ratio15 = scan15.collisionCount / scan15.total;
    const ratio19 = scan19.collisionCount / scan19.total;

    const detail =
      `Scale 15: ${scan15.collisionCount}/${scan15.total} (${(ratio15 * 100).toFixed(1)}%)\n` +
      `Scale 19: ${scan19.collisionCount}/${scan19.total} (${(ratio19 * 100).toFixed(1)}%)\n\n` +
      `Scale 15:\n${formatScanResults(scan15.results)}\n\n` +
      `Scale 19:\n${formatScanResults(scan19.results)}`;

    assert.ok(scan15.collisionCount > 0, `scale 15 should have collisions.\n${detail}`);
    assert.ok(scan19.collisionCount > 0, `scale 19 should have collisions.\n${detail}`);

    if (ratio15 > 0 && ratio19 > 0) {
      const coverageDiff = Math.abs(ratio15 - ratio19);
      assert.ok(
        coverageDiff < 0.5,
        `collision coverage differs drastically: ${(ratio15 * 100).toFixed(1)}% vs ${(ratio19 * 100).toFixed(1)}%.\n${detail}`,
      );
    }
  });
});

describe("collision culling behavior", { timeout: 60000 }, async () => {
  let gltfScene: InstanceType<typeof THREE.Group>;

  before(async () => {
    await initThreeModules();
    gltfScene = await loadModel();
  });

  it("mesh is not culled at scale 15 test positions", () => {
    const data = createCollisionData(gltfScene, 15);
    const { from } = pathForScale(15);
    const culled = wouldBeCulled(data, from);
    assert.strictEqual(
      culled,
      false,
      `mesh at scale 15 should NOT be culled at (${from.x},${from.y},${from.z}). ` +
        `boundingSphereRadius=${data.boundingSphereRadius.toFixed(2)}`,
    );
  });

  it("mesh is not culled at scale 19 test positions", () => {
    const data = createCollisionData(gltfScene, 19);
    const { from } = pathForScale(19);
    const culled = wouldBeCulled(data, from);
    assert.strictEqual(
      culled,
      false,
      `mesh at scale 19 should NOT be culled at (${from.x},${from.y},${from.z}). ` +
        `boundingSphereRadius=${data.boundingSphereRadius.toFixed(2)}`,
    );
  });

  it("culling does not cause scale-dependent collision loss at edge positions", () => {
    const scales = [10, 15, 19, 25, 30];
    const failures: string[] = [];

    for (const scale of scales) {
      const data = createCollisionData(gltfScene, scale);
      const { from } = pathForScale(scale);

      const culled = wouldBeCulled(data, from);
      if (culled) {
        const dist = Math.sqrt(from.x * from.x + from.y * from.y + from.z * from.z);
        const worldBSR = data.boundingSphereRadius * scale;
        const effectiveRadius = CULLING_RADIUS + worldBSR;
        failures.push(
          `  scale=${scale}: CULLED at (${from.x.toFixed(1)},${from.z.toFixed(1)}) ` +
            `dist=${dist.toFixed(1)} > effective=${effectiveRadius.toFixed(1)}`,
        );
      }
    }

    assert.strictEqual(
      failures.length,
      0,
      `Some scales are incorrectly culled:\n${failures.join("\n")}`,
    );
  });

  it("regression: localScale=(1,1,1) with scaled matrix is not culled (MML child group scenario)", () => {
    // In production, MML <m-model sx="19"> creates a parent group with scale 19.
    // The collision mesh group is a CHILD with localScale=(1,1,1), but its worldMatrix
    // includes the parent's scale. The old code used localScale for culling radius,
    // treating the bounding sphere as unscaled (radius * 1) instead of (radius * 19).
    const data = createCollisionData(gltfScene, 19);

    // Simulate the production hierarchy: localScale is (1,1,1) but worldMatrix has scale 19
    const mmlChildData: CollisionData = {
      meshBVH: data.meshBVH,
      worldMatrix: data.worldMatrix, // contains scale 19
      localScale: { x: 1, y: 1, z: 1 }, // child group's own scale
      boundingSphereRadius: data.boundingSphereRadius,
    };

    const { from } = pathForScale(19);
    const culled = wouldBeCulled(mmlChildData, from);
    assert.strictEqual(
      culled,
      false,
      `mesh with localScale=(1,1,1) but matrix scale=19 should NOT be culled. ` +
        `boundingSphereRadius=${mmlChildData.boundingSphereRadius.toFixed(2)}`,
    );
  });
});

describe("collision across scale range", { timeout: 60000 }, async () => {
  let gltfScene: InstanceType<typeof THREE.Group>;

  before(async () => {
    await initThreeModules();
    gltfScene = await loadModel();
  });

  it("collisions are detected at the same model-space surface for scales 10 through 30", () => {
    const scales = [10, 12, 15, 17, 19, 22, 25, 30];
    const scaleResults: { scale: number; collisionCount: number; total: number }[] = [];
    const failures: string[] = [];

    for (const scale of scales) {
      const data = createCollisionData(gltfScene, scale);
      const { from, to } = pathForScale(scale);

      const { collisionCount, total, results } = scanPathCollisions(data, from, to, 20);
      scaleResults.push({ scale, collisionCount, total });

      if (collisionCount === 0) {
        failures.push(
          `  scale=${scale}: 0 collisions along (${from.x.toFixed(1)},${from.z.toFixed(1)}) → ` +
            `(${to.x.toFixed(1)},${to.z.toFixed(1)})\n${formatScanResults(results)}`,
        );
      }
    }

    const summary = scaleResults
      .map((r) => `  scale=${r.scale}: ${r.collisionCount}/${r.total}`)
      .join("\n");

    assert.strictEqual(
      failures.length,
      0,
      `Collisions missing at some scales:\n${summary}\n\nFailed:\n${failures.join("\n")}`,
    );
  });
});

/**
 * Compare collision results between Three.js native types (used in tests above)
 * and the actual custom types (Vect3/Line/Box/Matr4) used in production CollisionsManager.
 *
 * If the custom types produce different results from Three.js types, that's the bug.
 */
describe("custom types vs Three.js types collision comparison", { timeout: 60000 }, async () => {
  let gltfScene: InstanceType<typeof THREE.Group>;

  before(async () => {
    await initThreeModules();
    gltfScene = await loadModel();
  });

  /**
   * Run collision using the REAL CollisionsManager with custom types (Vect3/Line/Matr4).
   * Returns whether a collision was detected and the displacement applied.
   */
  function testCollisionWithCollisionsManager(
    meshBVH: any,
    worldMatrixElements: Float32Array | number[],
    scale: number,
    position: { x: number; y: number; z: number },
  ): CollisionResult {
    const cm = new CollisionsManager();

    // Build the collision mesh using custom Matr4
    const matrix = new Matr4().fromArray(worldMatrixElements as any);
    const localScale = { x: scale, y: scale, z: scale };

    // Register the collision mesh via addMeshesGroup (it computes bounding sphere internally)
    const sourceRef = {};
    cm.addMeshesGroup(sourceRef, { meshBVH, matrix, localScale });

    // Build the capsule segment using custom Line (matching LocalController)
    const capsuleSegment = new CoreLine(
      new Vect3(position.x, position.y + CAPSULE_RADIUS, position.z),
      new Vect3(position.x, position.y + CAPSULE_SEGMENT_END_Y + CAPSULE_RADIUS, position.z),
    );

    const startX = capsuleSegment.start.x;
    const startY = capsuleSegment.start.y;
    const startZ = capsuleSegment.start.z;

    // Run the actual production collision code
    cm.applyColliders(capsuleSegment, CAPSULE_RADIUS);

    const dx = capsuleSegment.start.x - startX;
    const dy = capsuleSegment.start.y - startY;
    const dz = capsuleSegment.start.z - startZ;

    const collided = Math.abs(dx) > 1e-10 || Math.abs(dy) > 1e-10 || Math.abs(dz) > 1e-10;
    return { collided, displacement: { x: dx, y: dy, z: dz } };
  }

  it("custom types match Three.js types for collision at scale 15", () => {
    const data = createCollisionData(gltfScene, 15);
    const { from, to } = pathForScale(15);
    const steps = 20;

    let mismatchCount = 0;
    const details: string[] = [];

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const pos = {
        x: from.x + (to.x - from.x) * t,
        y: from.y + (to.y - from.y) * t,
        z: from.z + (to.z - from.z) * t,
      };

      const threeResult = testCapsuleCollision(data, pos);
      const customResult = testCollisionWithCollisionsManager(
        data.meshBVH,
        data.worldMatrix.elements,
        15,
        pos,
      );

      if (threeResult.collided !== customResult.collided) {
        mismatchCount++;
        details.push(
          `  t=${t.toFixed(2)} (${pos.x.toFixed(3)},${pos.z.toFixed(3)}): ` +
            `THREE=${threeResult.collided} custom=${customResult.collided} ` +
            `THREE disp=(${threeResult.displacement.x.toFixed(4)},${threeResult.displacement.y.toFixed(4)},${threeResult.displacement.z.toFixed(4)}) ` +
            `custom disp=(${customResult.displacement.x.toFixed(4)},${customResult.displacement.y.toFixed(4)},${customResult.displacement.z.toFixed(4)})`,
        );
      }
    }

    assert.strictEqual(
      mismatchCount,
      0,
      `${mismatchCount} mismatches between Three.js and custom types at scale 15:\n${details.join("\n")}`,
    );
  });

  it("custom types match Three.js types for collision at scale 19", () => {
    const data = createCollisionData(gltfScene, 19);
    const { from, to } = pathForScale(19);
    const steps = 20;

    let mismatchCount = 0;
    const details: string[] = [];

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const pos = {
        x: from.x + (to.x - from.x) * t,
        y: from.y + (to.y - from.y) * t,
        z: from.z + (to.z - from.z) * t,
      };

      const threeResult = testCapsuleCollision(data, pos);
      const customResult = testCollisionWithCollisionsManager(
        data.meshBVH,
        data.worldMatrix.elements,
        19,
        pos,
      );

      if (threeResult.collided !== customResult.collided) {
        mismatchCount++;
        details.push(
          `  t=${t.toFixed(2)} (${pos.x.toFixed(3)},${pos.z.toFixed(3)}): ` +
            `THREE=${threeResult.collided} custom=${customResult.collided} ` +
            `THREE disp=(${threeResult.displacement.x.toFixed(4)},${threeResult.displacement.y.toFixed(4)},${threeResult.displacement.z.toFixed(4)}) ` +
            `custom disp=(${customResult.displacement.x.toFixed(4)},${customResult.displacement.y.toFixed(4)},${customResult.displacement.z.toFixed(4)})`,
        );
      }
    }

    assert.strictEqual(
      mismatchCount,
      0,
      `${mismatchCount} mismatches between Three.js and custom types at scale 19:\n${details.join("\n")}`,
    );
  });

  it("custom types detect collisions across all scales (10-30)", () => {
    const scales = [10, 12, 15, 17, 19, 22, 25, 30];
    const failures: string[] = [];

    for (const scale of scales) {
      const data = createCollisionData(gltfScene, scale);
      const { from, to } = pathForScale(scale);

      let customCollisionCount = 0;
      let threeCollisionCount = 0;
      const mismatches: string[] = [];

      for (let i = 0; i <= 20; i++) {
        const t = i / 20;
        const pos = {
          x: from.x + (to.x - from.x) * t,
          y: from.y + (to.y - from.y) * t,
          z: from.z + (to.z - from.z) * t,
        };

        const threeResult = testCapsuleCollision(data, pos);
        const customResult = testCollisionWithCollisionsManager(
          data.meshBVH,
          data.worldMatrix.elements,
          scale,
          pos,
        );

        if (threeResult.collided) threeCollisionCount++;
        if (customResult.collided) customCollisionCount++;
        if (threeResult.collided !== customResult.collided) {
          mismatches.push(
            `    t=${t.toFixed(2)}: THREE=${threeResult.collided} custom=${customResult.collided}`,
          );
        }
      }

      if (customCollisionCount === 0) {
        failures.push(
          `  scale=${scale}: custom types found 0 collisions (THREE found ${threeCollisionCount})` +
            (mismatches.length > 0 ? `\n${mismatches.join("\n")}` : ""),
        );
      }
    }

    assert.strictEqual(
      failures.length,
      0,
      `Custom types failed to detect collisions at some scales:\n${failures.join("\n")}`,
    );
  });

  it("regression: CollisionsManager detects collisions with localScale=(1,1,1) and scaled matrix", () => {
    // Reproduce the production MML hierarchy where the collision group has localScale=(1,1,1)
    // but the worldMatrix includes the parent's scale (19). The old culling bug caused the mesh
    // to be culled at distant positions, preventing collision detection.
    const data = createCollisionData(gltfScene, 19);
    const { from, to } = pathForScale(19);
    const steps = 20;

    let collisionCount = 0;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const pos = {
        x: from.x + (to.x - from.x) * t,
        y: from.y + (to.y - from.y) * t,
        z: from.z + (to.z - from.z) * t,
      };

      // Use localScale=(1,1,1) to match production MML child group behavior
      const cm = new CollisionsManager();
      const matrix = new Matr4().fromArray(data.worldMatrix.elements as any);
      const localScale = { x: 1, y: 1, z: 1 };

      const sourceRef = {};
      cm.addMeshesGroup(sourceRef, { meshBVH: data.meshBVH, matrix, localScale });
      const capsuleSegment = new CoreLine(
        new Vect3(pos.x, pos.y + CAPSULE_RADIUS, pos.z),
        new Vect3(pos.x, pos.y + CAPSULE_SEGMENT_END_Y + CAPSULE_RADIUS, pos.z),
      );

      const startX = capsuleSegment.start.x;
      const startZ = capsuleSegment.start.z;

      cm.applyColliders(capsuleSegment, CAPSULE_RADIUS);

      const dx = capsuleSegment.start.x - startX;
      const dz = capsuleSegment.start.z - startZ;
      if (Math.abs(dx) > 1e-6 || Math.abs(dz) > 1e-6) {
        collisionCount++;
      }
    }

    assert.ok(
      collisionCount > 0,
      `Expected collisions at scale=19 with localScale=(1,1,1), but found 0 out of ${steps + 1} positions`,
    );
  });
});
