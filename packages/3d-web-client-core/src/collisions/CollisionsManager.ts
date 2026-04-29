import { MElement, MMLCollisionTrigger } from "@mml-io/mml-web";
import type { Ray as ThreeRay, Vector3, Box3, Line3 } from "three";
import type { MeshBVH } from "three-mesh-bvh";

import { Box } from "../math/Box";
import { EulXYZ } from "../math/EulXYZ";
import { Line } from "../math/Line";
import { Matr4 } from "../math/Matr4";
import { Quat } from "../math/Quat";
import { Ray } from "../math/Ray";
import { IVect3, Vect3 } from "../math/Vect3";

import { getRelativePositionAndRotationRelativeToObject } from "./getRelativePositionAndRotationRelativeToObject";

type CollisionSourceRef = unknown;

export type CollisionMeshState = {
  matrix: Matr4;
  localScale: IVect3;
  source: CollisionSourceRef;
  meshBVH: MeshBVH;
  trackCollisions: boolean;
  boundingSphereRadius: number; // Cached bounding sphere radius for culling
  // Local-space (mesh-relative) AABB from the meshBVH's root bounds. Stored
  // so we can recompute the world-space AABB on a matrix change without
  // re-querying the BVH.
  localMinX: number;
  localMinY: number;
  localMinZ: number;
  localMaxX: number;
  localMaxY: number;
  localMaxZ: number;
  // World-space AABB, refreshed on every matrix change. Used as a tight
  // per-frame pre-cull in `applyColliders` (capsule-vs-AABB) and
  // `raycastFirst` (ray-vs-AABB) — strictly tighter than the legacy
  // character-radius sphere cull, and critical at high group counts where
  // the per-group setup before `meshBVH.shapecast` dominates main-thread
  // physics time.
  worldMinX: number;
  worldMinY: number;
  worldMinZ: number;
  worldMaxX: number;
  worldMaxY: number;
  worldMaxZ: number;
};

export type CollisionMesh = {
  meshBVH: MeshBVH;
  matrix: Matr4;
  localScale: IVect3;
};

export class CollisionsManager {
  private tempVector: Vect3 = new Vect3();
  private tempVector2: Vect3 = new Vect3();
  private tempVect3: Vect3 = new Vect3();
  private tempQuat: Quat = new Quat();
  private tempRay: Ray = new Ray();
  private tempMatrix = new Matr4();
  private tempBox = new Box();
  private tempEulXYZ = new EulXYZ();
  private tempSegment = new Line();
  private tempSegment2 = new Line();
  private tempCollisionPosition = new Vect3();
  private tempMinimalNormal = new Vect3();
  private tempMinimalPoint = new Vect3();
  private tempBoundsBox = new Box(); // Pre-allocated for getBoundingBox

  public collisionMeshState: Map<CollisionSourceRef, CollisionMeshState> = new Map();
  private collisionTrigger: MMLCollisionTrigger<CollisionSourceRef>;
  private previouslyCollidingElements: null | Map<
    CollisionSourceRef,
    { position: { x: number; y: number; z: number } }
  >;

  private debugEnabled: boolean = false;
  public onDebugChange?: (enabled: boolean) => void;

  private cullingEnabled: boolean = true;
  private cullingRadius: number = 50; // max distance from character to consider meshes
  private characterPosition: Vect3 = new Vect3();

  private exemptFromCulling: CollisionMeshState | null = null;

  constructor() {
    this.collisionTrigger = MMLCollisionTrigger.init();
    this.toggleDebug = this.toggleDebug.bind(this);
  }

  public isDebugEnabled(): boolean {
    return this.debugEnabled;
  }

  public toggleDebug(enabled: boolean) {
    this.debugEnabled = enabled;
    if (this.onDebugChange) {
      this.onDebugChange(enabled);
    }
  }

  public setCullingEnabled(enabled: boolean): void {
    this.cullingEnabled = enabled;
  }

  public setCharacterPosition(position: IVect3): void {
    this.characterPosition.set(position.x, position.y, position.z);
  }

  public setExemptFromCulling(meshState: CollisionMeshState | null): void {
    this.exemptFromCulling = meshState;
  }

  public raycastFirst(
    ray: Ray,
    maximumDistance: number | null = null,
  ): [number, Vect3, CollisionMeshState, Vect3] | null {
    let minimumDistance: number | null = null;
    let minimumHit: CollisionMeshState | null = null;
    let minimumNormal: Vect3 = this.tempMinimalNormal;
    let minimumPoint: Vect3 = this.tempMinimalPoint;
    // Pre-compute inverse direction for the ray-AABB slab test below.
    // Division by zero yields ±Infinity, which still produces correct
    // min/max behavior in the slab test for axis-aligned rays.
    const ox = ray.origin.x;
    const oy = ray.origin.y;
    const oz = ray.origin.z;
    const invDx = 1 / ray.direction.x;
    const invDy = 1 / ray.direction.y;
    const invDz = 1 / ray.direction.z;
    const cullEnabled = this.cullingEnabled;
    for (const [, collisionMeshState] of this.collisionMeshState) {
      // Tight ray-vs-AABB cull (slab test). Replaces the legacy
      // character-radius sphere cull — at high group counts the per-group
      // matrix invert + BVH descent below dominates without it.
      if (cullEnabled && this.exemptFromCulling !== collisionMeshState) {
        const tx1 = (collisionMeshState.worldMinX - ox) * invDx;
        const tx2 = (collisionMeshState.worldMaxX - ox) * invDx;
        let tmin = tx1 < tx2 ? tx1 : tx2;
        let tmax = tx1 > tx2 ? tx1 : tx2;
        const ty1 = (collisionMeshState.worldMinY - oy) * invDy;
        const ty2 = (collisionMeshState.worldMaxY - oy) * invDy;
        const tyMin = ty1 < ty2 ? ty1 : ty2;
        const tyMax = ty1 > ty2 ? ty1 : ty2;
        if (tyMin > tmin) tmin = tyMin;
        if (tyMax < tmax) tmax = tyMax;
        const tz1 = (collisionMeshState.worldMinZ - oz) * invDz;
        const tz2 = (collisionMeshState.worldMaxZ - oz) * invDz;
        const tzMin = tz1 < tz2 ? tz1 : tz2;
        const tzMax = tz1 > tz2 ? tz1 : tz2;
        if (tzMin > tmin) tmin = tzMin;
        if (tzMax < tmax) tmax = tzMax;
        if (tmax < 0 || tmin > tmax) continue;
        if (maximumDistance !== null && tmin > maximumDistance) continue;
      }

      const invertedMatrix = this.tempMatrix.copy(collisionMeshState.matrix).invert();

      const originalRay = this.tempRay.copy(ray);
      originalRay.applyMatrix4(invertedMatrix);

      const hit = collisionMeshState.meshBVH.raycastFirst(
        originalRay as unknown as ThreeRay,
        2, // DoubleSide
      );
      if (hit) {
        this.tempSegment.start.copy(originalRay.origin);
        this.tempSegment.end.copy(hit.point);
        this.tempSegment.applyMatrix4(collisionMeshState.matrix);
        const dist = this.tempSegment.distance();
        if (
          (maximumDistance === null || dist < maximumDistance) &&
          (minimumDistance === null || dist < minimumDistance)
        ) {
          minimumDistance = dist;
          minimumHit = collisionMeshState;
          minimumNormal = (hit.normal ? minimumNormal.copy(hit.normal) : minimumNormal.set(0, 1, 0))
            // Apply the rotation of the mesh to the normal
            .applyQuat(this.tempQuat.setFromRotationMatrix(collisionMeshState.matrix))
            .normalize();
          minimumPoint = minimumPoint.copy(hit.point).applyMatrix4(collisionMeshState.matrix);
        }
      }
    }
    if (minimumDistance === null || minimumHit === null) {
      return null;
    }
    return [minimumDistance, minimumNormal, minimumHit, minimumPoint];
  }

  /**
   * Raycast against every registered group, returning all hits sorted by
   * distance (nearest first). One hit per group — `meshBVH.raycastFirst`
   * gives the closest triangle within each group's BVH.
   *
   * Uses the same per-group world-AABB cull as `raycastFirst`, so callers
   * can rely on this scaling with hit-eligible groups rather than total
   * group count. Allocates per call (one result object per hit) — meant
   * for input-rate paths like click resolution, not per-frame physics.
   */
  public raycastAll(
    ray: Ray,
    maximumDistance: number | null = null,
  ): Array<{ distance: number; point: Vect3; normal: Vect3; meshState: CollisionMeshState }> {
    const results: Array<{
      distance: number;
      point: Vect3;
      normal: Vect3;
      meshState: CollisionMeshState;
    }> = [];
    const ox = ray.origin.x;
    const oy = ray.origin.y;
    const oz = ray.origin.z;
    const invDx = 1 / ray.direction.x;
    const invDy = 1 / ray.direction.y;
    const invDz = 1 / ray.direction.z;
    const cullEnabled = this.cullingEnabled;
    for (const [, collisionMeshState] of this.collisionMeshState) {
      if (cullEnabled && this.exemptFromCulling !== collisionMeshState) {
        const tx1 = (collisionMeshState.worldMinX - ox) * invDx;
        const tx2 = (collisionMeshState.worldMaxX - ox) * invDx;
        let tmin = tx1 < tx2 ? tx1 : tx2;
        let tmax = tx1 > tx2 ? tx1 : tx2;
        const ty1 = (collisionMeshState.worldMinY - oy) * invDy;
        const ty2 = (collisionMeshState.worldMaxY - oy) * invDy;
        const tyMin = ty1 < ty2 ? ty1 : ty2;
        const tyMax = ty1 > ty2 ? ty1 : ty2;
        if (tyMin > tmin) tmin = tyMin;
        if (tyMax < tmax) tmax = tyMax;
        const tz1 = (collisionMeshState.worldMinZ - oz) * invDz;
        const tz2 = (collisionMeshState.worldMaxZ - oz) * invDz;
        const tzMin = tz1 < tz2 ? tz1 : tz2;
        const tzMax = tz1 > tz2 ? tz1 : tz2;
        if (tzMin > tmin) tmin = tzMin;
        if (tzMax < tmax) tmax = tzMax;
        if (tmax < 0 || tmin > tmax) continue;
        if (maximumDistance !== null && tmin > maximumDistance) continue;
      }
      const invertedMatrix = this.tempMatrix.copy(collisionMeshState.matrix).invert();
      const originalRay = this.tempRay.copy(ray);
      originalRay.applyMatrix4(invertedMatrix);
      const hit = collisionMeshState.meshBVH.raycastFirst(originalRay as unknown as ThreeRay, 2);
      if (!hit) continue;
      this.tempSegment.start.copy(originalRay.origin);
      this.tempSegment.end.copy(hit.point);
      this.tempSegment.applyMatrix4(collisionMeshState.matrix);
      const dist = this.tempSegment.distance();
      if (maximumDistance !== null && dist > maximumDistance) continue;
      const normal = new Vect3();
      if (hit.normal) {
        normal.copy(hit.normal);
      } else {
        normal.set(0, 1, 0);
      }
      normal.applyQuat(this.tempQuat.setFromRotationMatrix(collisionMeshState.matrix)).normalize();
      const point = new Vect3()
        .copy(hit.point as unknown as IVect3)
        .applyMatrix4(collisionMeshState.matrix);
      results.push({ distance: dist, point, normal, meshState: collisionMeshState });
    }
    results.sort((a, b) => a.distance - b.distance);
    return results;
  }

  public addMeshesGroup(
    group: CollisionSourceRef,
    creationResult: CollisionMesh,
    mElement?: MElement,
  ): void {
    if (mElement) {
      this.collisionTrigger.addCollider(group, mElement);
    }
    const { meshBVH, matrix, localScale } = creationResult;

    // bounding sphere radius as max distance from local origin to any corner of bounds.
    meshBVH.getBoundingBox(this.tempBoundsBox as unknown as Box3);
    const minX = this.tempBoundsBox.min.x;
    const minY = this.tempBoundsBox.min.y;
    const minZ = this.tempBoundsBox.min.z;
    const maxX = this.tempBoundsBox.max.x;
    const maxY = this.tempBoundsBox.max.y;
    const maxZ = this.tempBoundsBox.max.z;
    // Compare squared distances, then sqrt once at the end
    const boundingSphereRadiusSq = Math.max(
      minX * minX + minY * minY + minZ * minZ,
      minX * minX + minY * minY + maxZ * maxZ,
      minX * minX + maxY * maxY + minZ * minZ,
      minX * minX + maxY * maxY + maxZ * maxZ,
      maxX * maxX + minY * minY + minZ * minZ,
      maxX * maxX + minY * minY + maxZ * maxZ,
      maxX * maxX + maxY * maxY + minZ * minZ,
      maxX * maxX + maxY * maxY + maxZ * maxZ,
    );
    const boundingSphereRadius = Math.sqrt(boundingSphereRadiusSq);

    const meshState: CollisionMeshState = {
      source: group,
      meshBVH,
      matrix,
      localScale,
      trackCollisions: mElement !== undefined,
      boundingSphereRadius,
      localMinX: minX,
      localMinY: minY,
      localMinZ: minZ,
      localMaxX: maxX,
      localMaxY: maxY,
      localMaxZ: maxZ,
      // Filled in by recomputeWorldAABB just below.
      worldMinX: 0,
      worldMinY: 0,
      worldMinZ: 0,
      worldMaxX: 0,
      worldMaxY: 0,
      worldMaxZ: 0,
    };
    this.recomputeWorldAABB(meshState);
    this.collisionMeshState.set(group, meshState);
  }

  public updateMeshesGroup(group: CollisionSourceRef, matrix: Matr4, localScale: IVect3): void {
    const meshState = this.collisionMeshState.get(group);
    if (meshState) {
      meshState.matrix.copy(matrix);
      meshState.localScale.x = localScale.x;
      meshState.localScale.y = localScale.y;
      meshState.localScale.z = localScale.z;
      this.recomputeWorldAABB(meshState);
    }
  }

  /**
   * Refresh `meshState.world{Min,Max}{X,Y,Z}` from the cached local AABB and
   * the current `matrix`. Transforms the 8 corners of the local box and
   * takes the axis-aligned bound — the tightest correct world-AABB for an
   * arbitrarily-rotated mesh. Called on add and on every matrix change;
   * never per-frame.
   */
  private recomputeWorldAABB(s: CollisionMeshState): void {
    const m = s.matrix.data;
    const lminX = s.localMinX,
      lminY = s.localMinY,
      lminZ = s.localMinZ;
    const lmaxX = s.localMaxX,
      lmaxY = s.localMaxY,
      lmaxZ = s.localMaxZ;
    let minX = Infinity,
      minY = Infinity,
      minZ = Infinity;
    let maxX = -Infinity,
      maxY = -Infinity,
      maxZ = -Infinity;
    for (let i = 0; i < 8; i++) {
      const x = i & 1 ? lmaxX : lminX;
      const y = i & 2 ? lmaxY : lminY;
      const z = i & 4 ? lmaxZ : lminZ;
      const wx = m[0] * x + m[4] * y + m[8] * z + m[12];
      const wy = m[1] * x + m[5] * y + m[9] * z + m[13];
      const wz = m[2] * x + m[6] * y + m[10] * z + m[14];
      if (wx < minX) minX = wx;
      if (wx > maxX) maxX = wx;
      if (wy < minY) minY = wy;
      if (wy > maxY) maxY = wy;
      if (wz < minZ) minZ = wz;
      if (wz > maxZ) maxZ = wz;
    }
    s.worldMinX = minX;
    s.worldMinY = minY;
    s.worldMinZ = minZ;
    s.worldMaxX = maxX;
    s.worldMaxY = maxY;
    s.worldMaxZ = maxZ;
  }

  public removeMeshesGroup(group: CollisionSourceRef): void {
    this.collisionTrigger.removeCollider(group);
    const meshState = this.collisionMeshState.get(group);
    if (meshState) {
      this.collisionMeshState.delete(group);
    }
  }

  private applyCollider(
    worldBasedCapsuleSegment: Line,
    capsuleRadius: number,
    meshState: CollisionMeshState,
  ): Vect3 | null {
    // Create a matrix to convert from world-space to mesh-space
    const meshMatrix = this.tempMatrix.copy(meshState.matrix).invert();

    // Create the bounding box for the capsule if it were in mesh-space
    const meshRelativeCapsuleBoundingBox = this.tempBox;
    meshRelativeCapsuleBoundingBox.makeEmpty();
    meshRelativeCapsuleBoundingBox.expandByPoint(worldBasedCapsuleSegment.start);
    meshRelativeCapsuleBoundingBox.expandByPoint(worldBasedCapsuleSegment.end);
    meshRelativeCapsuleBoundingBox.min.subScalar(capsuleRadius);
    meshRelativeCapsuleBoundingBox.max.addScalar(capsuleRadius);
    meshRelativeCapsuleBoundingBox.applyMatrix4(meshMatrix);
    // Create a segment/line for the capsule in mesh-space
    const meshRelativeCapsuleSegment = this.tempSegment;
    meshRelativeCapsuleSegment.start.copy(worldBasedCapsuleSegment.start);
    meshRelativeCapsuleSegment.end.copy(worldBasedCapsuleSegment.end);
    meshRelativeCapsuleSegment.applyMatrix4(meshMatrix);

    // Keep track of where the segment started in mesh-space so that we can calculate the delta later
    const initialMeshRelativeCapsuleSegmentStart = this.tempVect3.copy(
      meshRelativeCapsuleSegment.start,
    );

    let collisionPosition: Vect3 | null = null;
    let currentCollisionDistance: number = -1;
    meshState.meshBVH.shapecast({
      intersectsBounds: (meshBox) => {
        // Determine if this portion of the mesh overlaps with the capsule bounding box and is therefore worth checking
        // all of the triangles within
        return meshBox.intersectsBox(meshRelativeCapsuleBoundingBox as unknown as Box3);
      },
      intersectsTriangle: (meshTriangle) => {
        const closestPointOnTriangle = this.tempVector;
        const closestPointOnSegment = this.tempVector2;
        // Find the closest point between this triangle and the capsule segment in mesh-space
        meshTriangle.closestPointToSegment(
          meshRelativeCapsuleSegment as unknown as Line3,
          closestPointOnTriangle as unknown as Vector3,
          closestPointOnSegment as unknown as Vector3,
        );
        // Create a line segment between the closest points
        const intersectionSegment = this.tempSegment2;
        intersectionSegment.start.copy(closestPointOnTriangle);
        intersectionSegment.end.copy(closestPointOnSegment);
        // Calculate the distance between the closest points in mesh-space
        const modelReferenceDistance = intersectionSegment.distance();

        // Calculate the distance between the points in world-space
        intersectionSegment.applyMatrix4(meshState.matrix);
        const realDistance = intersectionSegment.distance();

        // If the real distance is less than the capsule radius then there is actually a collision between the capsule
        // and the triangle
        if (realDistance < capsuleRadius) {
          if (!collisionPosition) {
            collisionPosition = this.tempCollisionPosition
              .copy(closestPointOnTriangle)
              .applyMatrix4(meshState.matrix);
            currentCollisionDistance = realDistance;
          } else if (realDistance < currentCollisionDistance) {
            collisionPosition.copy(closestPointOnTriangle).applyMatrix4(meshState.matrix);
            currentCollisionDistance = realDistance;
          }
          // Calculate the ratio between the real distance and the mesh-space distance
          const ratio = realDistance / modelReferenceDistance;
          // Calculate the depth of the collision in world-space
          const realDepth = capsuleRadius - realDistance;
          // Convert that depth back into mesh-space as all calculations during collision are to a mesh-space segment
          const modelDepth = realDepth / ratio;

          // Apply a corrective movement to the segment in mesh-space
          const direction = closestPointOnSegment.sub(closestPointOnTriangle).normalize();
          meshRelativeCapsuleSegment.start.addScaledVector(direction, modelDepth);
          meshRelativeCapsuleSegment.end.addScaledVector(direction, modelDepth);
        }
      },
    });

    if (collisionPosition) {
      // If there was a collision, calculate the delta between the original mesh-space segment and the now-moved one
      const delta = this.tempVector
        .copy(meshRelativeCapsuleSegment.start)
        .sub(initialMeshRelativeCapsuleSegmentStart);

      // Use the matrix for the mesh to convert the delta vector back to world-space (remove the position component of the matrix first to avoid translation)
      this.tempMatrix.copy(meshState.matrix).setPosition(0, 0, 0);
      delta.applyMatrix4(this.tempMatrix);

      // There's a possibility that the matrix is invalid (or scale zero) and the delta is NaN - if so, don't apply the delta
      if (!(isNaN(delta.x) && isNaN(delta.y) && isNaN(delta.z))) {
        // Convert the potentially-modified mesh-space segment back to world-space
        worldBasedCapsuleSegment.start.add(delta);
        worldBasedCapsuleSegment.end.add(delta);
      }
    }

    return collisionPosition;
  }

  public applyColliders(tempSegment: Line, radius: number) {
    const collidedElements = new Map<
      CollisionSourceRef,
      {
        position: { x: number; y: number; z: number };
      }
    >();
    // Capsule's world-space AABB. Computed once and re-used as a tight
    // per-group cull below — the per-group setup inside `applyCollider`
    // (matrix invert + box transform) is expensive enough that scanning
    // all groups linearly costs ~30 ms per 1000 groups before any actual
    // collision work. A cheap AABB-vs-AABB rejection skips the setup for
    // groups that can't possibly intersect the capsule.
    const sx = tempSegment.start.x;
    const sy = tempSegment.start.y;
    const sz = tempSegment.start.z;
    const ex = tempSegment.end.x;
    const ey = tempSegment.end.y;
    const ez = tempSegment.end.z;
    const capMinX = (sx < ex ? sx : ex) - radius;
    const capMinY = (sy < ey ? sy : ey) - radius;
    const capMinZ = (sz < ez ? sz : ez) - radius;
    const capMaxX = (sx > ex ? sx : ex) + radius;
    const capMaxY = (sy > ey ? sy : ey) + radius;
    const capMaxZ = (sz > ez ? sz : ez) + radius;
    for (const meshState of this.collisionMeshState.values()) {
      // Tight world-AABB cull. Strictly tighter than the legacy
      // character-radius sphere cull, and the only thing that makes
      // physics scale to thousands of groups.
      if (this.cullingEnabled && this.exemptFromCulling !== meshState) {
        if (capMaxX < meshState.worldMinX || capMinX > meshState.worldMaxX) continue;
        if (capMaxY < meshState.worldMinY || capMinY > meshState.worldMaxY) continue;
        if (capMaxZ < meshState.worldMinZ || capMinZ > meshState.worldMaxZ) continue;
      }

      const collisionPosition = this.applyCollider(tempSegment, radius, meshState);
      if (collisionPosition && meshState.trackCollisions) {
        const relativePosition = getRelativePositionAndRotationRelativeToObject(
          {
            position: collisionPosition,
            rotation: this.tempEulXYZ.set(0, 0, 0),
          },
          meshState.matrix,
          meshState.localScale,
        );
        collidedElements.set(meshState.source, {
          position: relativePosition.position,
        });
      }
    }

    /*
     The reported collisions include elements that were reported in the previous tick to ensure that the case of an
     avatar rising to a negligible distance above the surface and immediately back down onto it does not result in a
     discontinuity in the collision lifecycle. If the element is not colliding in the next frame then it will be
     dropped.

     This results in a single tick delay of reporting leave events, but this is a reasonable trade-off to avoid
     flickering collisions.
    */
    const reportedCollidingElements = new Map(collidedElements);
    if (this.previouslyCollidingElements) {
      for (const [element, position] of this.previouslyCollidingElements) {
        if (!reportedCollidingElements.has(element)) {
          reportedCollidingElements.set(element, position);
        }
      }
    }

    // Store the elements that were genuinely collided with this tick for the next tick to preserve if they are missed
    this.previouslyCollidingElements = collidedElements;
    this.collisionTrigger.setCurrentCollisions(reportedCollidingElements);
  }
}
