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

  public collisionMeshState: Map<CollisionSourceRef, CollisionMeshState> = new Map();
  private collisionTrigger: MMLCollisionTrigger<CollisionSourceRef>;
  private previouslyCollidingElements: null | Map<
    CollisionSourceRef,
    { position: { x: number; y: number; z: number } }
  >;

  private debugEnabled: boolean = false;
  public onDebugChange?: (enabled: boolean) => void;

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

  public raycastFirst(
    ray: Ray,
    maximumDistance: number | null = null,
  ): [number, Vect3, CollisionMeshState, Vect3] | null {
    let minimumDistance: number | null = null;
    let minimumHit: CollisionMeshState | null = null;
    let minimumNormal: Vect3 = this.tempMinimalNormal;
    let minimumPoint: Vect3 = this.tempMinimalPoint;
    for (const [, collisionMeshState] of this.collisionMeshState) {
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

  public addMeshesGroup(
    group: CollisionSourceRef,
    creationResult: CollisionMesh,
    mElement?: MElement,
  ): void {
    if (mElement) {
      this.collisionTrigger.addCollider(group, mElement);
    }
    const { meshBVH, matrix, localScale } = creationResult;

    const meshState: CollisionMeshState = {
      source: group,
      meshBVH,
      matrix,
      localScale,
      trackCollisions: mElement !== undefined,
    };
    this.collisionMeshState.set(group, meshState);
  }

  public updateMeshesGroup(group: CollisionSourceRef, matrix: Matr4, localScale: IVect3): void {
    const meshState = this.collisionMeshState.get(group);
    if (meshState) {
      meshState.matrix.copy(matrix);
      meshState.localScale.x = localScale.x;
      meshState.localScale.y = localScale.y;
      meshState.localScale.z = localScale.z;
    }
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
    for (const meshState of this.collisionMeshState.values()) {
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
