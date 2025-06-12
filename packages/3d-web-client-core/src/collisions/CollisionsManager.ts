import { MElement, MMLCollisionTrigger } from "@mml-io/mml-web";
import {
  BufferGeometry,
  InstancedMesh,
  DoubleSide,
  Matrix4,
  Group,
  Scene,
  Ray as ThreeRay,
  Vector3,
  Mesh,
  MeshBasicMaterial,
  LineBasicMaterial,
  Color,
  Object3D,
  Box3,
  Line3,
} from "three";
import { VertexNormalsHelper } from "three/examples/jsm/helpers/VertexNormalsHelper.js";
import * as BufferGeometryUtils from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { MeshBVH, MeshBVHHelper } from "three-mesh-bvh";

import { Box } from "../math/Box";
import { EulXYZ } from "../math/EulXYZ";
import { Line } from "../math/Line";
import { Matr4 } from "../math/Matr4";
import { Quat } from "../math/Quat";
import { Ray } from "../math/Ray";
import { Vect3 } from "../math/Vect3";

import { getRelativePositionAndRotationRelativeToObject } from "./getRelativePositionAndRotationRelativeToObject";

export type CollisionMeshState = {
  matrix: Matr4;
  source: Group;
  meshBVH: MeshBVH;
  debugGroup?: Group;
  trackCollisions: boolean;
};

export class CollisionsManager {
  private debug: boolean = false;
  private scene: Scene;
  private tempVector: Vect3 = new Vect3();
  private tempVector2: Vect3 = new Vect3();
  private tempVect3: Vect3 = new Vect3();
  private tempQuat: Quat = new Quat();
  private tempRay: Ray = new Ray();
  private tempMatrix = new Matr4();
  private tempMatrix2 = new Matr4();
  private tempBox = new Box();
  private tempEulXYZ = new EulXYZ();
  private tempSegment = new Line();
  private tempSegment2 = new Line();

  public collisionMeshState: Map<Group, CollisionMeshState> = new Map();
  private collisionTrigger: MMLCollisionTrigger<Group>;
  private previouslyCollidingElements: null | Map<
    Group,
    { position: { x: number; y: number; z: number } }
  >;

  constructor(scene: Scene) {
    this.scene = scene;
    this.collisionTrigger = MMLCollisionTrigger.init();
  }

  public raycastFirst(
    ray: Ray,
    maximumDistance: number | null = null,
  ): [number, Vect3, CollisionMeshState, Vect3] | null {
    let minimumDistance: number | null = null;
    let minimumHit: CollisionMeshState | null = null;
    let minimumNormal: Vect3 | null = null;
    let minimumPoint: Vect3 | null = null;
    for (const [, collisionMeshState] of this.collisionMeshState) {
      const invertedMatrix = this.tempMatrix.copy(collisionMeshState.matrix).invert();

      const originalRay = this.tempRay.copy(ray);
      originalRay.applyMatrix4(invertedMatrix);

      const originalRayAsThreeRay = new ThreeRay(
        new Vector3(...originalRay.origin.toArray()),
        new Vector3(...originalRay.direction.toArray()),
      );
      const hit = collisionMeshState.meshBVH.raycastFirst(originalRayAsThreeRay, DoubleSide);
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
          if (minimumNormal === null) {
            minimumNormal = new Vect3();
          }
          if (minimumPoint === null) {
            minimumPoint = new Vect3();
          }
          minimumNormal = (hit.normal ? minimumNormal.copy(hit.normal) : minimumNormal)
            // Apply the rotation of the mesh to the normal
            .applyQuat(this.tempQuat.setFromRotationMatrix(collisionMeshState.matrix))
            .normalize();
          minimumPoint = minimumPoint.copy(hit.point).applyMatrix4(collisionMeshState.matrix);
        }
      }
    }
    if (
      minimumDistance === null ||
      minimumNormal === null ||
      minimumHit === null ||
      minimumPoint === null
    ) {
      return null;
    }
    return [minimumDistance, minimumNormal, minimumHit, minimumPoint];
  }

  private createCollisionMeshState(group: Group, trackCollisions: boolean): CollisionMeshState {
    const geometries: Array<BufferGeometry> = [];
    group.updateWorldMatrix(true, false);
    const invertedRootMatrix = this.tempMatrix
      .copy(new Matr4(new Float32Array(group.matrixWorld.elements)))
      .invert();
    group.traverse((child: Object3D) => {
      const asMesh = child as Mesh;
      if (asMesh.isMesh) {
        const asInstancedMesh = asMesh as InstancedMesh;
        if (asInstancedMesh.isInstancedMesh) {
          for (let i = 0; i < asInstancedMesh.count; i++) {
            const clonedGeometry = asInstancedMesh.geometry.clone();
            for (const key in clonedGeometry.attributes) {
              if (key !== "position") {
                clonedGeometry.deleteAttribute(key);
              }
            }
            const clonedMat4 = new Matrix4().fromArray(
              asInstancedMesh.instanceMatrix.array,
              i * 16,
            );
            clonedGeometry.applyMatrix4(clonedMat4);
            if (clonedGeometry.index) {
              geometries.push(clonedGeometry.toNonIndexed());
            } else {
              geometries.push(clonedGeometry);
            }
          }
        } else {
          const clonedGeometry = asMesh.geometry.clone();
          asMesh.updateWorldMatrix(true, false);
          for (const key in clonedGeometry.attributes) {
            if (key !== "position") {
              clonedGeometry.deleteAttribute(key);
            }
          }
          clonedGeometry.applyMatrix4(
            new Matrix4().fromArray(
              this.tempMatrix2.multiplyMatrices(
                invertedRootMatrix,
                new Matr4(new Float32Array(asMesh.matrixWorld.elements)),
              ).data,
            ),
          );
          if (clonedGeometry.index) {
            geometries.push(clonedGeometry.toNonIndexed());
          } else {
            geometries.push(clonedGeometry);
          }
        }
      }
    });

    const newBufferGeometry = BufferGeometryUtils.mergeGeometries(geometries, false);
    newBufferGeometry.computeVertexNormals();
    const meshBVH = new MeshBVH(newBufferGeometry);

    const meshState: CollisionMeshState = {
      source: group,
      meshBVH,
      matrix: new Matr4(new Float32Array(group.matrixWorld.elements)),
      trackCollisions,
    };
    if (this.debug) {
      // Have to cast to add the boundsTree property to the geometry so that the MeshBVHHelper can find it
      (newBufferGeometry as any).boundsTree = meshBVH;

      const wireframeMesh = new Mesh(newBufferGeometry, new MeshBasicMaterial({ wireframe: true }));

      const normalsHelper = new VertexNormalsHelper(wireframeMesh, 0.25, 0x00ff00);

      const visualizer = new MeshBVHHelper(wireframeMesh, 4);
      (visualizer.edgeMaterial as LineBasicMaterial).color = new Color("blue");

      const debugGroup = new Group();
      debugGroup.add(wireframeMesh, normalsHelper, visualizer as unknown as Object3D);

      group.matrixWorld.decompose(debugGroup.position, debugGroup.quaternion, debugGroup.scale);
      visualizer.update();

      meshState.debugGroup = debugGroup;
    }
    return meshState;
  }

  public addMeshesGroup(group: Group, mElement?: MElement): void {
    if (mElement) {
      this.collisionTrigger.addCollider(group, mElement);
    }
    const meshState = this.createCollisionMeshState(group, mElement !== undefined);
    if (meshState.debugGroup) {
      this.scene.add(meshState.debugGroup);
    }
    this.collisionMeshState.set(group, meshState);
  }

  public updateMeshesGroup(group: Group): void {
    const meshState = this.collisionMeshState.get(group);
    if (meshState) {
      group.updateWorldMatrix(true, false);
      meshState.matrix.set(new Float32Array(group.matrixWorld.elements));
      if (meshState.debugGroup) {
        group.matrixWorld.decompose(
          meshState.debugGroup.position,
          meshState.debugGroup.quaternion,
          meshState.debugGroup.scale,
        );
      }
    }
  }

  public removeMeshesGroup(group: Group): void {
    this.collisionTrigger.removeCollider(group);
    const meshState = this.collisionMeshState.get(group);
    if (meshState) {
      if (meshState.debugGroup) {
        this.scene.remove(meshState.debugGroup);
      }
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
        return meshBox.intersectsBox(
          new Box3(
            new Vector3(
              meshRelativeCapsuleBoundingBox.min.x,
              meshRelativeCapsuleBoundingBox.min.y,
              meshRelativeCapsuleBoundingBox.min.z,
            ),
            new Vector3(
              meshRelativeCapsuleBoundingBox.max.x,
              meshRelativeCapsuleBoundingBox.max.y,
              meshRelativeCapsuleBoundingBox.max.z,
            ),
          ),
        );
      },
      intersectsTriangle: (meshTriangle) => {
        const closestPointOnTriangle = this.tempVector;
        const closestPointOnSegment = this.tempVector2;
        // Find the closest point between this triangle and the capsule segment in mesh-space
        const line3MeshRelativeCapsuleSegment = new Line3(
          new Vector3(
            meshRelativeCapsuleSegment.start.x,
            meshRelativeCapsuleSegment.start.y,
            meshRelativeCapsuleSegment.start.z,
          ),
          new Vector3(
            meshRelativeCapsuleSegment.end.x,
            meshRelativeCapsuleSegment.end.y,
            meshRelativeCapsuleSegment.end.z,
          ),
        );

        meshTriangle.closestPointToSegment(
          line3MeshRelativeCapsuleSegment,
          new Vector3(closestPointOnTriangle.x, closestPointOnTriangle.y, closestPointOnTriangle.z),
          new Vector3(closestPointOnSegment.x, closestPointOnSegment.y, closestPointOnSegment.z),
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
            collisionPosition = new Vect3()
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
      Group,
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
          meshState.source,
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
