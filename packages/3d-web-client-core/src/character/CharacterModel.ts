import {
  MMLCharacter,
  type MMLCharacterDescription,
  ModelLoader,
  parseMMLDescription,
} from "@mml-io/3d-web-avatar";
import {
  AnimationAction,
  AnimationClip,
  AnimationMixer,
  Bone,
  LoopRepeat,
  MeshStandardMaterial,
  Object3D,
  SkinnedMesh,
} from "three";

import { AnimationConfig, CharacterDescription } from "./Character";
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

  public mmlCharacterDescription: MMLCharacterDescription;

  constructor(
    private readonly characterDescription: CharacterDescription,
    private readonly animationConfig: AnimationConfig,
    private characterModelLoader: CharacterModelLoader,
  ) {}

  public async init(): Promise<void> {
    await this.loadMainMesh();
    await this.setAnimationFromFile(this.animationConfig.idleAnimationFileUrl, AnimationState.idle);
    await this.setAnimationFromFile(
      this.animationConfig.jogAnimationFileUrl,
      AnimationState.walking,
    );
    await this.setAnimationFromFile(
      this.animationConfig.sprintAnimationFileUrl,
      AnimationState.running,
    );
    await this.setAnimationFromFile(this.animationConfig.airAnimationFileUrl, AnimationState.air);
    if (this.characterDescription.meshFileUrl) {
      this.applyCustomMaterial(this.material);
    }
  }

  private applyCustomMaterial(material: CharacterMaterial): void {
    if (!this.mesh) return;
    this.mesh.traverse((child: Object3D) => {
      const asSkinnedMesh = child as SkinnedMesh;
      if (asSkinnedMesh.isSkinnedMesh) {
        const mat = asSkinnedMesh.material as MeshStandardMaterial;
        if (!mat.name.includes("joints")) {
          asSkinnedMesh.material = material;
        } else {
          const color = mat.color;
          asSkinnedMesh.material = new CharacterMaterial(color);
        }
      }
    });
  }

  public updateAnimation(targetAnimation: AnimationState) {
    if (this.currentAnimation !== targetAnimation) {
      this.transitionToAnimation(targetAnimation);
    }
  }

  private setMainMesh(mainMesh: Object3D): void {
    this.mesh = mainMesh;
    this.mesh.position.set(0, -0.4, 0);
    this.mesh.traverse((child: Object3D) => {
      if (child.type === "SkinnedMesh") {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
    this.animationMixer = new AnimationMixer(this.mesh);
  }

  private async composeMMLCharacter(
    mmlCharacterDescription: MMLCharacterDescription,
  ): Promise<Object3D | undefined> {
    if (mmlCharacterDescription.base?.url.length === 0) {
      throw new Error(
        "ERROR: An MML Character Description was provided but it's not a valid <m-character> string, or a valid URL",
      );
    }

    let mergedCharacter: Object3D | null = null;
    if (mmlCharacterDescription) {
      const characterBase = mmlCharacterDescription.base?.url || null;
      if (characterBase) {
        this.mmlCharacterDescription = mmlCharacterDescription;
        const mmlCharacter = new MMLCharacter(new ModelLoader());
        mergedCharacter = await mmlCharacter.mergeBodyParts(
          characterBase,
          mmlCharacterDescription.parts,
        );
        if (mergedCharacter) {
          return mergedCharacter.children[0].children[0];
        }
      }
    }
  }

  private async loadCharacterFromDescription(): Promise<Object3D | null> {
    if (this.characterDescription.meshFileUrl) {
      return (
        (await this.characterModelLoader.load(this.characterDescription.meshFileUrl, "model")) ||
        null
      );
    }

    let mmlCharacterSource: string;
    if (this.characterDescription.mmlCharacterUrl) {
      const res = await fetch(this.characterDescription.mmlCharacterUrl);
      mmlCharacterSource = await res.text();
    } else if (this.characterDescription.mmlCharacterString) {
      mmlCharacterSource = this.characterDescription.mmlCharacterString;
    } else {
      throw new Error(
        "ERROR: No Character Description was provided. Specify one of meshFileUrl, mmlCharacterUrl or mmlCharacterString",
      );
    }

    const parsedMMLDescription = parseMMLDescription(mmlCharacterSource);
    const mmlCharacterDescription = parsedMMLDescription[0];
    if (parsedMMLDescription[1].length > 0) {
      console.warn("Errors parsing MML Character Description: ", parsedMMLDescription[1]);
    }
    const mmlCharacterBody = await this.composeMMLCharacter(mmlCharacterDescription);
    if (mmlCharacterBody) {
      return mmlCharacterBody;
    }
    return null;
  }

  private async loadMainMesh(): Promise<void> {
    const mainMesh = await this.loadCharacterFromDescription();
    if (typeof mainMesh !== "undefined") {
      this.setMainMesh(mainMesh as Object3D);
    } else {
      throw new Error("ERROR: No Character Model was loaded");
    }
  }

  private cleanAnimationClips(skeletalMesh: Object3D, animationClip: AnimationClip): AnimationClip {
    const availableBones = new Set<string>();
    skeletalMesh.traverse((child) => {
      const asBone = child as Bone;
      if (asBone.isBone) {
        availableBones.add(child.name);
      }
    });
    animationClip.tracks = animationClip.tracks.filter((track) => {
      const trackName = track.name.split(".")[0];
      return availableBones.has(trackName);
    });
    return animationClip;
  }

  private async setAnimationFromFile(
    animationFileUrl: string,
    animationType: AnimationState,
  ): Promise<void> {
    return new Promise(async (resolve, reject) => {
      const animation = await this.characterModelLoader.load(animationFileUrl, "animation");
      const cleanAnimation = this.cleanAnimationClips(this.mesh!, animation as AnimationClip);
      if (typeof animation !== "undefined" && cleanAnimation instanceof AnimationClip) {
        this.animations[animationType] = this.animationMixer!.clipAction(cleanAnimation);
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
