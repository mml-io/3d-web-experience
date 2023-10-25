/* eslint-disable @typescript-eslint/no-loop-func */
import { Group, Matrix4, Object3D, Scene, Skeleton, SkeletonHelper, SkinnedMesh } from "three";
import { GLTF } from "three/examples/jsm/loaders/GLTFLoader";

import { SkeletonHelpers } from "../helpers/SkeletonHelpers";

import { AnimationManager } from "./AnimationManager";
import { ModelLoader } from "./ModelLoader";
import { TimeManagerInterface } from "./types";

export enum AnimationState {
  "idle" = 0,
  "walking" = 1,
  "running" = 2,
  "jumpToAir" = 3,
  "air" = 4,
  "airToGround" = 5,
}

export type CharacterState = {
  id: number;
  position: {
    x: number;
    y: number;
    z: number;
  };
  rotation: {
    quaternionY: number;
    quaternionW: number;
  };
  state: AnimationState;
};

export class Character {
  public animationManager: AnimationManager | null = null;
  public animationState = AnimationState;

  private skeletonHelpers: SkeletonHelpers = new SkeletonHelpers();

  private skeletonHelper: SkeletonHelper | null = null;
  private skinnedMeshesParent: Group | null = null;
  private sharedSkeleton: Skeleton | null = null;
  private sharedMatrixWorld: Matrix4 | null = null;

  constructor(
    public scene: Scene,
    private modelLoader: ModelLoader,
    private timeManager: TimeManagerInterface,
  ) {}

  public async mergeBodyParts(
    headURL: string,
    upperBodyURL: string,
    lowerBodyURL: string,
    feetURL: string,
    callBack: (bodyMesh: Object3D) => void,
  ): Promise<void> {
    const fullBodyAsset = await this.modelLoader.load("/assets/avatar/SK_Outfit_Body_Male.glb");
    const fullBodyGLTF = this.skeletonHelpers.cloneGLTF(fullBodyAsset as GLTF, "fullBody");

    const headAsset = await this.modelLoader.load(headURL);
    const upperBodyAsset = await this.modelLoader.load(upperBodyURL);
    const lowerBodyAsset = await this.modelLoader.load(lowerBodyURL);
    const feetAsset = await this.modelLoader.load(feetURL);

    const skinnedMeshesToRemove: SkinnedMesh[] = [];

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
    this.skeletonHelper = new SkeletonHelper(fullBodyModelGroup);
    this.sharedSkeleton = fullBodyGLTF.sharedSkeleton;
    this.sharedMatrixWorld = fullBodyGLTF.matrixWorld;

    skinnedMeshesToRemove.forEach((child) => {
      child.removeFromParent();
    });

    const headGLTF = this.skeletonHelpers.cloneGLTF(headAsset as GLTF, "headGLTF");
    const headModelGroup = headGLTF.gltf.scene;
    headModelGroup.traverse((child) => {
      if (child.type === "SkinnedMesh") {
        (child as SkinnedMesh).castShadow = true;
        (child as SkinnedMesh).bind(this.sharedSkeleton!, this.sharedMatrixWorld!);
        this.skinnedMeshesParent?.children.splice(0, 0, child as SkinnedMesh);
      }
    });

    const upperBodyGLTF = this.skeletonHelpers.cloneGLTF(upperBodyAsset as GLTF, "upperBodyGLTF");
    const upperBodyModelGroup = upperBodyGLTF.gltf.scene;
    upperBodyModelGroup.traverse((child) => {
      if (child.type === "SkinnedMesh") {
        (child as SkinnedMesh).castShadow = true;
        (child as SkinnedMesh).bind(this.sharedSkeleton!, this.sharedMatrixWorld!);
        this.skinnedMeshesParent?.children.splice(1, 0, child as SkinnedMesh);
      }
    });

    const lowerBodyGLTF = this.skeletonHelpers.cloneGLTF(lowerBodyAsset as GLTF, "lowerBodyGLTF");
    const lowerBodyModelGroup = lowerBodyGLTF.gltf.scene;
    lowerBodyModelGroup.traverse((child) => {
      if (child.type === "SkinnedMesh") {
        (child as SkinnedMesh).castShadow = true;
        (child as SkinnedMesh).bind(this.sharedSkeleton!, this.sharedMatrixWorld!);
        this.skinnedMeshesParent?.children.splice(2, 0, child as SkinnedMesh);
      }
    });

    const feetGLTF = this.skeletonHelpers.cloneGLTF(feetAsset as GLTF, "feetGLTF");
    const feetModelGroup = feetGLTF.gltf.scene;
    feetModelGroup.traverse((child) => {
      if (child.type === "SkinnedMesh") {
        (child as SkinnedMesh).castShadow = true;
        (child as SkinnedMesh).bind(this.sharedSkeleton!, this.sharedMatrixWorld!);
        this.skinnedMeshesParent?.children.splice(3, 0, child as SkinnedMesh);
      }
    });

    if (this.animationManager === null) {
      this.animationManager = new AnimationManager(this.modelLoader, this.timeManager);
    }
    callBack(fullBodyGLTF!.gltf.scene as Object3D);
  }

  public viewSkeleton(): void {
    if (this.skeletonHelper) {
      this.scene.add(this.skeletonHelper);
    } else {
      console.error("Character.viewSkeleton Error: skeletonHelper is null or undefined");
    }
  }

  public hideSkeleton(): void {
    if (this.skeletonHelper) {
      this.scene.remove(this.skeletonHelper);
    } else {
      console.error("Character.hideSkeleton Error: skeletonHelper is null or undefined");
    }
  }

  public update(): void {
    if (this.timeManager) this.timeManager.update();
    if (this.animationManager) this.animationManager.update();
  }
}
