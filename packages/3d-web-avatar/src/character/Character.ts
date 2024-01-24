import {
  BoxHelper,
  BufferAttribute,
  Group,
  Matrix4,
  MeshStandardMaterial,
  Object3D,
  Skeleton,
  SkinnedMesh,
} from "three";
import { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";

import { SkeletonHelpers } from "../helpers/SkeletonHelpers";

import { ModelLoader } from "./ModelLoader";

export class Character {
  private skeletonHelpers: SkeletonHelpers = new SkeletonHelpers();
  private skinnedMeshesParent: Group | null = null;
  private sharedSkeleton: Skeleton | null = null;
  private sharedMatrixWorld: Matrix4 | null = null;

  constructor(private modelLoader: ModelLoader) {}

  private createBoneIndexMap(
    originSkeleton: Skeleton,
    targetSkeleton: Skeleton,
  ): Map<number, number> {
    const boneIndexMap = new Map<number, number>();

    for (let i = 0; i < originSkeleton.bones.length; i++) {
      const originBone = originSkeleton.bones[i];
      const targetBone = targetSkeleton.bones.find((bone) => bone.name === originBone.name);
      if (targetBone) {
        boneIndexMap.set(i, targetSkeleton.bones.indexOf(targetBone));
      }
    }
    return boneIndexMap;
  }

  private remapBoneIndices(skinnedMesh: SkinnedMesh): void {
    const targetSkeleton = this.sharedSkeleton!;
    const originSkeleton = skinnedMesh.skeleton;
    const originGeometry = skinnedMesh.geometry;

    const boneIndexMap = this.createBoneIndexMap(originSkeleton, targetSkeleton);

    const newSkinIndexArray = [];
    for (let i = 0; i < originGeometry.attributes.skinIndex.array.length; i++) {
      const originIndex = originGeometry.attributes.skinIndex.array[i];
      const targetIndex = boneIndexMap.get(originIndex);
      if (targetIndex !== undefined) {
        newSkinIndexArray.push(targetIndex);
      } else {
        console.error("Missing bone index", originIndex);
        newSkinIndexArray.push(0);
      }
    }
    skinnedMesh.geometry.attributes.skinIndex = new BufferAttribute(
      new Uint8Array(newSkinIndexArray),
      4,
    );
  }

  public async mergeBodyParts(fullBodyURL: string, bodyParts: Array<string>): Promise<Object3D> {
    const fullBodyAsset = await this.modelLoader.load(fullBodyURL);
    const fullBodyGLTF = this.skeletonHelpers.cloneGLTF(fullBodyAsset as GLTF, "fullBody");

    const assetPromises: Array<Promise<{ asset: GLTF; partUrl: string }>> = bodyParts.map(
      (partUrl) => {
        return new Promise((resolve) => {
          this.modelLoader.load(partUrl).then((asset) => {
            resolve({ asset: asset!, partUrl });
          });
        });
      },
    );
    const assets = await Promise.all(assetPromises);

    const fullBodyModelGroup = fullBodyGLTF.gltf.scene;

    this.skinnedMeshesParent = null;

    fullBodyModelGroup.traverse((child) => {
      if (child.type === "SkinnedMesh") {
        (child as SkinnedMesh).castShadow = true;
        (child as SkinnedMesh).receiveShadow = true;
        const asSkinnedMesh = child as SkinnedMesh;
        const asMeshStandardMaterial = asSkinnedMesh.material as MeshStandardMaterial;
        // asMeshStandardMaterial.envMapIntensity = 2.0;
        if (this.skinnedMeshesParent === null) {
          this.skinnedMeshesParent = child.parent as Group;
        }
      }
    });
    this.sharedSkeleton = fullBodyGLTF.sharedSkeleton;
    this.sharedMatrixWorld = fullBodyGLTF.matrixWorld;

    for (const loadingAsset of assets) {
      const gltf = this.skeletonHelpers.cloneGLTF(loadingAsset.asset, loadingAsset.partUrl);
      const modelGroup = gltf.gltf.scene;
      modelGroup.traverse((child) => {
        const asSkinnedMesh = child as SkinnedMesh;
        if (asSkinnedMesh.type === "SkinnedMesh") {
          const skinnedMeshClone = child.clone(true) as SkinnedMesh;
          this.remapBoneIndices(skinnedMeshClone);
          skinnedMeshClone.castShadow = true;
          skinnedMeshClone.receiveShadow = true;
          skinnedMeshClone.bind(this.sharedSkeleton!, this.sharedMatrixWorld!);
          this.skinnedMeshesParent?.children.splice(3, 0, skinnedMeshClone as SkinnedMesh);
          this.skinnedMeshesParent?.add(skinnedMeshClone);
        }
      });
    }
    return fullBodyGLTF!.gltf.scene as Object3D;
  }
}
