import { Bone, Group, Matrix4, Mesh, Object3D, Skeleton, SkinnedMesh } from "three";
import { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";

type ClonedGLTFParts = {
  gltf: GLTF;
  sharedSkeleton: Skeleton;
  matrixWorld: Matrix4;
};

type BoneHierarchyMap = Map<string, BoneHierarchyMap>;
type DiffResult = {
  identical: boolean;
  differences: string[];
};

export function cloneModel(model: Group) {
  const clone = SkeletonUtils.clone(model);
  return clone;
}

export class SkeletonHelpers {
  private debug: boolean = false;
  private hierarchies: BoneHierarchyMap[] = [];
  private modelNames: string[] = [];

  private extractBoneHierarchy(node: Object3D): BoneHierarchyMap | null {
    if (node.type !== "Bone") return null;
    const boneMap: BoneHierarchyMap = new Map();
    node.children.forEach((child) => {
      const childHierarchy = this.extractBoneHierarchy(child);
      if (childHierarchy) boneMap.set(child.name, childHierarchy);
    });
    return boneMap;
  }

  private areBoneHierarchiesEqual(
    a: BoneHierarchyMap,
    b: BoneHierarchyMap,
    modelNameA: string,
    modelNameB: string,
    path: string[] = [],
  ): DiffResult {
    let identical = true;
    const differences: string[] = [];

    if (a.size !== b.size) {
      differences.push(
        `Different number of children at path: ${path.join(
          " -> ",
        )} in models ${modelNameA} and ${modelNameB}.`,
      );
      identical = false;
    }

    for (const [key, value] of a) {
      if (!b.has(key)) {
        differences.push(
          `Bone "${key}" was found in model ${modelNameA} but not in model ${modelNameB} at path: ${path.join(
            " -> ",
          )}.`,
        );
        identical = false;
        continue;
      }

      const newPath = [...path, key];
      const result = this.areBoneHierarchiesEqual(
        value,
        b.get(key)!,
        modelNameA,
        modelNameB,
        newPath,
      );

      if (!result.identical) {
        identical = false;
        differences.push(...result.differences);
      }
    }

    for (const key of b.keys()) {
      if (!a.has(key)) {
        differences.push(
          `Bone "${key}" was found in model ${modelNameB} but not in model ${modelNameA} at path: ${path.join(
            " -> ",
          )}.`,
        );
        identical = false;
      }
    }

    return {
      identical,
      differences,
    };
  }

  public extractAndStoreBoneHierarchy(node: Object3D, modelName: string) {
    const newHierarchy = this.extractBoneHierarchy(node);

    if (!newHierarchy) {
      console.log(`No bone hierarchy found in the model: ${modelName}.`);
      return;
    }

    this.hierarchies.push(newHierarchy);
    this.modelNames.push(modelName);
  }

  public compareLatestHierarchies() {
    if (this.hierarchies.length < 2) return;

    const latestHierarchy = this.hierarchies[this.hierarchies.length - 1];
    const previousHierarchy = this.hierarchies[this.hierarchies.length - 2];

    const diff = this.areBoneHierarchiesEqual(
      previousHierarchy,
      latestHierarchy,
      this.modelNames[this.modelNames.length - 2],
      this.modelNames[this.modelNames.length - 1],
      [],
    );

    if (diff.identical) {
      if (this.debug) console.log("The skeletons are identical.");
    } else {
      diff.differences.forEach((difference) => console.log(difference));
    }
  }

  public cloneGLTF(gltf: GLTF, modelName: string): ClonedGLTFParts {
    const clone: Partial<GLTF> = {
      animations: gltf.animations,
      scene: cloneModel(gltf.scene) as Group,
    };

    let sharedSkeleton: Skeleton | null = null;
    let matrixWorld: Matrix4 | null = null;

    const skinnedMeshes: Record<string, SkinnedMesh> = {};

    gltf.scene.traverse((node) => {
      if (node.type === "SkinnedMesh") {
        skinnedMeshes[node.name] = node as SkinnedMesh;
      }
    });

    const cloneBones: Record<string, Bone> = {};
    const cloneSkinnedMeshes: Record<string, SkinnedMesh> = {};

    let hierarchyCheck = false;
    clone.scene!.traverse((node) => {
      if ((node as Mesh).isMesh || (node as SkinnedMesh).isSkinnedMesh) {
        node.castShadow = true;
        node.receiveShadow = true;
      }
      if (node.type === "Bone") {
        if (hierarchyCheck === false) {
          hierarchyCheck = true;
          this.extractAndStoreBoneHierarchy(node, modelName);
        }
        cloneBones[node.name] = node as Bone;
      }

      if (node.type === "SkinnedMesh") {
        cloneSkinnedMeshes[node.name] = node as SkinnedMesh;
      }
    });

    for (const name in skinnedMeshes) {
      const skinnedMesh = skinnedMeshes[name];
      const skeleton = skinnedMesh.skeleton;
      const cloneSkinnedMesh = cloneSkinnedMeshes[name];

      const orderedCloneBones = [];

      for (let i = 0; i < skeleton.bones.length; ++i) {
        const cloneBone = cloneBones[skeleton.bones[i].name];
        orderedCloneBones.push(cloneBone);
      }

      if (sharedSkeleton === null) {
        sharedSkeleton = new Skeleton(orderedCloneBones, skeleton.boneInverses);
      }

      if (matrixWorld === null) {
        matrixWorld = cloneSkinnedMesh.matrixWorld;
      }

      cloneSkinnedMesh.bind(sharedSkeleton, matrixWorld);
    }

    return {
      gltf: clone as GLTF,
      sharedSkeleton: sharedSkeleton as Skeleton,
      matrixWorld: matrixWorld as Matrix4,
    };
  }
}
