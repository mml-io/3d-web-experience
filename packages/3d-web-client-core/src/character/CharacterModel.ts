import {
  AnimationAction,
  AnimationClip,
  AnimationMixer,
  Bone,
  LoopRepeat,
  Mesh,
  Object3D,
} from "three";

import { CharacterDescription } from "./Character";
import { CharacterMaterial } from "./CharacterMaterial";
import { CharacterModelLoader } from "./CharacterModelLoader";
import { AnimationState } from "./CharacterState";

export class CharacterModel {
  public mesh: Object3D | null = null;
  public material: CharacterMaterial = new CharacterMaterial();
  public headBone: Bone | null = null;

  public animations: Record<string, AnimationAction> = {};
  public animationMixer: AnimationMixer | null = null;
  public currentAnimation: AnimationState = AnimationState.idle;

  constructor(
    private readonly characterDescription: CharacterDescription,
    private characterModelLoader: CharacterModelLoader,
  ) {}

  public async init(): Promise<void> {
    await this.loadMainMesh();
    await this.setAnimationFromFile(
      this.characterDescription.idleAnimationFileUrl,
      AnimationState.idle,
    );
    await this.setAnimationFromFile(
      this.characterDescription.jogAnimationFileUrl,
      AnimationState.walking,
    );
    await this.setAnimationFromFile(
      this.characterDescription.sprintAnimationFileUrl,
      AnimationState.running,
    );
    await this.setAnimationFromFile(
      this.characterDescription.airAnimationFileUrl,
      AnimationState.air,
    );
    this.applyMaterialToAllSkinnedMeshes(this.material);
  }

  public updateAnimation(targetAnimation: AnimationState) {
    if (this.currentAnimation !== targetAnimation) {
      this.transitionToAnimation(targetAnimation);
    }
  }

  private applyMaterialToAllSkinnedMeshes(material: CharacterMaterial): void {
    if (!this.mesh) return;
    this.mesh.traverse((child: Object3D) => {
      if (child.type === "SkinnedMesh") {
        (child as Mesh).material = material;
      }
    });
  }

  private async loadMainMesh(): Promise<void> {
    const mainMeshUrl = this.characterDescription.meshFileUrl;
    const scale = this.characterDescription.modelScale;
    const extension = mainMeshUrl.split(".").pop();
    const name = mainMeshUrl.split("/").pop()!.replace(`.${extension}`, "");
    const mainMesh = await this.characterModelLoader.load(mainMeshUrl, "model");
    if (typeof mainMesh !== "undefined") {
      this.mesh = new Object3D();
      const model = mainMesh as Object3D;
      model.position.set(0, -0.4, 0);
      this.mesh.add(model);
      this.mesh.name = name;
      this.mesh.scale.set(scale, scale, scale);
      this.mesh.traverse((child: Object3D) => {
        if (child.type === "SkinnedMesh") {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });
      this.animationMixer = new AnimationMixer(this.mesh);
    }
  }

  private async setAnimationFromFile(
    animationFileUrl: string,
    animationType: AnimationState,
  ): Promise<void> {
    return new Promise(async (resolve, reject) => {
      const animation = await this.characterModelLoader.load(animationFileUrl, "animation");
      if (typeof animation !== "undefined" && animation instanceof AnimationClip) {
        this.animations[animationType] = this.animationMixer!.clipAction(animation);
        this.animations[animationType].stop();
        if (animationType === AnimationState.idle) {
          this.animations[animationType].play();
        }
        resolve();
      } else {
        reject(`failed to load ${animationType} from ${animationFileUrl}`);
      }
    });
  }

  private transitionToAnimation(
    targetAnimation: AnimationState,
    transitionDuration: number = 0.15,
  ): void {
    if (!this.mesh) return;

    const currentAction = this.animations[this.currentAnimation];
    this.currentAnimation = targetAnimation;
    const targetAction = this.animations[targetAnimation];

    if (!targetAction) return;

    if (currentAction) {
      currentAction.enabled = true;
      currentAction.fadeOut(transitionDuration);
    }

    if (!targetAction.isRunning()) targetAction.play();

    targetAction.setLoop(LoopRepeat, Infinity);
    targetAction.enabled = true;
    targetAction.fadeIn(transitionDuration);
  }

  update(time: number) {
    if (this.animationMixer) {
      this.animationMixer.update(time);
    }
  }
}
