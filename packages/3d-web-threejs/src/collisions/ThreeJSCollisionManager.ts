import { Matr4, CollisionMesh } from "@mml-io/3d-web-client-core";
import {
  BufferGeometry,
  InstancedMesh,
  Matrix4,
  Group,
  Object3D,
  Mesh,
  MeshBasicMaterial,
  LineBasicMaterial,
  Color,
  Scene,
  Float32BufferAttribute,
} from "three";
import { VertexNormalsHelper } from "three/examples/jsm/helpers/VertexNormalsHelper.js";
import * as BufferGeometryUtils from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { MeshBVH, MeshBVHHelper } from "three-mesh-bvh";

export class ThreeJSCollisionManager {
  private tempMatrixThree = new Matrix4();
  private collisionDebugGroups = new Map<Group, Group>();
  private collisionMeshBVHs = new Map<Group, MeshBVH>();

  constructor(private scene: Scene) {}

  public createCollisionMesh(group: Group): CollisionMesh {
    const geometries: Array<BufferGeometry> = [];
    group.updateWorldMatrix(true, false);
    group.traverse((child: Object3D) => {
      const asMesh = child as Mesh;
      if (asMesh.isMesh) {
        const asInstancedMesh = asMesh as InstancedMesh;
        if (asInstancedMesh.isInstancedMesh) {
          // Compute the InstancedMesh's transformation relative to the group
          const instancedMeshRelativeMatrix = new Matrix4();
          let currentObject: Object3D | null = asInstancedMesh;
          while (currentObject && currentObject !== group) {
            currentObject.updateMatrix();
            instancedMeshRelativeMatrix.premultiply(currentObject.matrix);
            currentObject = currentObject.parent;
          }

          for (let i = 0; i < asInstancedMesh.count; i++) {
            const clonedGeometry = asInstancedMesh.geometry.clone();
            for (const key in clonedGeometry.attributes) {
              if (key !== "position") {
                clonedGeometry.deleteAttribute(key);
              }
            }
            // Apply instance matrix first, then the InstancedMesh's relative transformation
            clonedGeometry.applyMatrix4(
              this.tempMatrixThree.fromArray(asInstancedMesh.instanceMatrix.array, i * 16),
            );
            clonedGeometry.applyMatrix4(instancedMeshRelativeMatrix);
            if (clonedGeometry.index) {
              geometries.push(clonedGeometry.toNonIndexed());
            } else {
              geometries.push(clonedGeometry);
            }
          }
        } else {
          const clonedGeometry = asMesh.geometry.clone();
          for (const key in clonedGeometry.attributes) {
            if (key !== "position") {
              clonedGeometry.deleteAttribute(key);
            }
          }

          // Compute the mesh's transformation relative to the group by accumulating local matrices
          this.tempMatrixThree.identity();
          let currentObject: Object3D | null = asMesh;
          while (currentObject && currentObject !== group) {
            currentObject.updateMatrix();
            this.tempMatrixThree.premultiply(currentObject.matrix);
            currentObject = currentObject.parent;
          }

          clonedGeometry.applyMatrix4(this.tempMatrixThree);
          if (clonedGeometry.index) {
            geometries.push(clonedGeometry.toNonIndexed());
          } else {
            geometries.push(clonedGeometry);
          }
        }
      }
    });

    let bufferGeometry: BufferGeometry;
    if (geometries.length === 0) {
      bufferGeometry = new BufferGeometry();
      bufferGeometry.setAttribute("position", new Float32BufferAttribute(new Float32Array(), 3));
    } else {
      bufferGeometry = BufferGeometryUtils.mergeGeometries(geometries, false);
      bufferGeometry.computeVertexNormals();
    }
    const meshBVH = new MeshBVH(bufferGeometry);

    return {
      meshBVH,
      matrix: new Matr4().fromArray(group.matrixWorld.elements),
      localScale: {
        x: group.scale.x,
        y: group.scale.y,
        z: group.scale.z,
      },
    };
  }

  public updateDebugVisualization(enabled: boolean, source: Group, meshBVH: MeshBVH): void {
    this.collisionMeshBVHs.set(source, meshBVH);

    if (enabled) {
      if (!this.collisionDebugGroups.has(source)) {
        const debugGroup = this.createCollisionDebugVisuals(source, meshBVH);
        this.collisionDebugGroups.set(source, debugGroup);
        this.scene.add(debugGroup);
      }
    } else {
      const debugGroup = this.collisionDebugGroups.get(source);
      if (debugGroup) {
        this.scene.remove(debugGroup);
        // Dispose of all resources used by the debug visuals
        debugGroup.traverse((object) => {
          if (typeof (object as any).dispose === "function") {
            (object as any).dispose();
          }
        });
        debugGroup.clear();
        this.collisionDebugGroups.delete(source);
      }
    }
  }

  public removeDebugVisualization(source: Group): void {
    const debugGroup = this.collisionDebugGroups.get(source);
    if (debugGroup) {
      this.scene.remove(debugGroup);
      debugGroup.traverse((object) => {
        if (typeof (object as any).dispose === "function") {
          (object as any).dispose();
        }
      });
      debugGroup.clear();
      this.collisionDebugGroups.delete(source);
    }
    this.collisionMeshBVHs.delete(source);
  }

  public updateDebugPosition(source: Group): void {
    const debugGroup = this.collisionDebugGroups.get(source);
    if (debugGroup) {
      source.updateWorldMatrix(true, false);
      source.matrixWorld.decompose(debugGroup.position, debugGroup.quaternion, debugGroup.scale);
    }
  }

  public toggleDebugForAll(enabled: boolean): void {
    this.collisionMeshBVHs.forEach((meshBVH, source) => {
      this.updateDebugVisualization(enabled, source, meshBVH);
    });
  }

  public clearAllDebugVisualizations(): void {
    this.collisionDebugGroups.forEach((debugGroup) => {
      this.scene.remove(debugGroup);
      debugGroup.traverse((object) => {
        if (typeof (object as any).dispose === "function") {
          (object as any).dispose();
        }
      });
      debugGroup.clear();
    });
    this.collisionDebugGroups.clear();
    this.collisionMeshBVHs.clear();
  }

  private createCollisionDebugVisuals(source: Group, meshBVH: MeshBVH): Group {
    const geometry = meshBVH.geometry;

    // Add the boundsTree property to the geometry so that the MeshBVHHelper can find it
    geometry.boundsTree = meshBVH;
    const wireframeMesh = new Mesh(geometry, new MeshBasicMaterial({ wireframe: true }));
    wireframeMesh.name = "wireframe mesh";
    const normalsHelper = new VertexNormalsHelper(wireframeMesh, 0.25, 0x00ff00);
    normalsHelper.name = "normals helper";
    const visualizer = new MeshBVHHelper(wireframeMesh, 4);
    visualizer.name = "meshBVH visualizer";
    (visualizer.edgeMaterial as LineBasicMaterial).color = new Color("blue");

    const debugGroup = new Group();
    debugGroup.add(wireframeMesh, normalsHelper, visualizer);
    source.matrixWorld.decompose(debugGroup.position, debugGroup.quaternion, debugGroup.scale);
    visualizer.update();

    return debugGroup;
  }
}
