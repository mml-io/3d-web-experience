import { Group, Matrix4, Object3D, Skeleton, SkinnedMesh } from "three";
import { GLTF } from "three/examples/jsm/loaders/GLTFLoader";

import { SkeletonHelpers } from "../helpers/SkeletonHelpers";

import { ModelLoader } from "./ModelLoader";

export class Character {
  private skeletonHelpers: SkeletonHelpers = new SkeletonHelpers();
  private skinnedMeshesParent: Group | null = null;
  private sharedSkeleton: Skeleton | null = null;
  private sharedMatrixWorld: Matrix4 | null = null;

  constructor(private modelLoader: ModelLoader) {}

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
        if (child.type === "SkinnedMesh") {
          (child as SkinnedMesh).castShadow = true;
          (child as SkinnedMesh).bind(this.sharedSkeleton!, this.sharedMatrixWorld!);
          this.skinnedMeshesParent?.children.splice(3, 0, child as SkinnedMesh);
        }
      });
    }

    return fullBodyGLTF!.gltf.scene as Object3D;
  }
}
