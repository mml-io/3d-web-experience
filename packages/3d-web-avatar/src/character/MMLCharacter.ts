import {
  Bone,
  BufferAttribute,
  Euler,
  Group,
  MathUtils,
  Matrix4,
  MeshStandardMaterial,
  Object3D,
  Skeleton,
  SkinnedMesh,
  Vector3,
} from "three";
import { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";

import { MMLCharacterDescriptionPart } from "../helpers/parseMMLDescription";
import { SkeletonHelpers } from "../helpers/SkeletonHelpers";

import { ModelLoader } from "./ModelLoader";

export class MMLCharacter {
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

  public async mergeBodyParts(
    fullBodyURL: string,
    bodyParts: Array<MMLCharacterDescriptionPart>,
  ): Promise<Object3D> {
    const fullBodyAsset = await this.modelLoader.load(fullBodyURL);
    const fullBodyGLTF = this.skeletonHelpers.cloneGLTF(fullBodyAsset as GLTF, "fullBody");
    const assetPromises: Array<Promise<{ asset: GLTF; part: MMLCharacterDescriptionPart }>> =
      bodyParts.map((part) => {
        return new Promise((resolve) => {
          this.modelLoader.load(part.url).then((asset) => {
            resolve({ asset: asset!, part });
          });
        });
      });
    const assets = await Promise.all(assetPromises);

    const fullBodyModelGroup = fullBodyGLTF.gltf.scene;

    this.skinnedMeshesParent = null;

    const availableBones = new Map<string, Bone>();
    fullBodyModelGroup.traverse((child) => {
      const asBone = child as Bone;
      if (asBone.isBone) {
        availableBones.set(child.name, asBone);
      }

      const asSkinnedMesh = child as SkinnedMesh;
      if (asSkinnedMesh.isSkinnedMesh) {
        asSkinnedMesh.castShadow = true;
        asSkinnedMesh.receiveShadow = true;
        if (this.skinnedMeshesParent === null) {
          this.skinnedMeshesParent = asSkinnedMesh.parent as Group;
        }
      }
    });
    this.sharedSkeleton = fullBodyGLTF.sharedSkeleton;
    this.sharedMatrixWorld = fullBodyGLTF.matrixWorld;

    for (const loadingAsset of assets) {
      const part = loadingAsset.part;
      const gltf = this.skeletonHelpers.cloneGLTF(loadingAsset.asset, part.url);
      const modelGroup = gltf.gltf.scene;
      if (part.socket) {
        const socketName = part.socket.socket;
        let bone = availableBones.get("root");
        if (availableBones.has(socketName)) {
          bone = availableBones.get(socketName);
        } else {
          console.warn(
            `WARNING: no bone found for [${socketName}] socket. Attatching to Root bone`,
          );
        }
        if (bone) {
          modelGroup.position.set(0, 0, 0);
          modelGroup.rotation.set(0, 0, 0);
          modelGroup.scale.set(1, 1, 1);

          bone.add(modelGroup);

          modelGroup.rotateZ(-Math.PI / 2);

          const offsetPosition = new Vector3(
            part.socket.position.x,
            part.socket.position.y,
            part.socket.position.z,
          );
          modelGroup.position.copy(offsetPosition);

          const offsetRotation = new Euler(
            MathUtils.degToRad(part.socket.rotation.x),
            MathUtils.degToRad(part.socket.rotation.y),
            MathUtils.degToRad(part.socket.rotation.z),
          );
          modelGroup.setRotationFromEuler(offsetRotation);

          modelGroup.scale.set(part.socket.scale.x, part.socket.scale.y, part.socket.scale.z);
        }
      } else {
        modelGroup.traverse((child) => {
          const asSkinnedMesh = child as SkinnedMesh;
          if (asSkinnedMesh.isSkinnedMesh) {
            const skinnedMeshClone = child.clone(true) as SkinnedMesh;
            this.remapBoneIndices(skinnedMeshClone);
            skinnedMeshClone.castShadow = true;
            skinnedMeshClone.receiveShadow = true;
            skinnedMeshClone.bind(this.sharedSkeleton!, this.sharedMatrixWorld!);
            skinnedMeshClone.children = [];
            this.skinnedMeshesParent?.add(skinnedMeshClone);
          }
        });
      }
    }
    return fullBodyGLTF!.gltf.scene as Object3D;
  }
}
