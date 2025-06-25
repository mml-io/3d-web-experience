import {
  MMLCharacter,
  type MMLCharacterDescription,
  parseMMLDescription,
} from "@mml-io/3d-web-avatar";
import { ModelLoader } from "@mml-io/model-loader";
import { AnimationAction, AnimationClip, AnimationMixer, Bone, Color, LoopRepeat, Object3D, SkinnedMesh } from "three";

import { CameraManager } from "../camera/CameraManager";

import { AnimationConfig, CharacterDescription } from "./Character";
import { CharacterModelLoader } from "./CharacterModelLoader";
import { AnimationState } from "./CharacterState";
import { captureCharacterColors, captureCharacterColorsFromObject3D } from "./CharacterColourSamplingUtils";

export const colorPartNamesIndex = [
"hair",
"skin",
"lips",
"shirt_short",
"shirt_long",
"pants_short",
"pants_long",
"shoes",
]

export function colorsToColorArray(colors: Map<string, Color>): Array<[number, number, number]> {
  const colorArray: Array<[number, number, number]> = [];
  for (const partName of colorPartNamesIndex) {
    const color = colors.get(partName);
    if (color) {
      colorArray.push([Math.round(color.r * 255), Math.round(color.g * 255), Math.round(color.b * 255)]);
    }
  }
  return colorArray;
}

export function colorArrayToColors(colorArray: Array<[number, number, number]>): Map<string, Color> {
  const colors = new Map<string, Color>();
  for (let i = 0; i < colorPartNamesIndex.length; i++) {
    const color = colorArray[i];
    if (color) {
      colors.set(colorPartNamesIndex[i], new Color(color[0] / 255, color[1] / 255, color[2] / 255));
    }
  }
  return colors;
}

export type CharacterModelConfig = {
  characterDescription: CharacterDescription;
  animationConfig: AnimationConfig;
  characterModelLoader: CharacterModelLoader;
  cameraManager: CameraManager;
  characterId: number;
  isLocal: boolean;
};

export class CharacterModel {
  public static ModelLoader: ModelLoader = new ModelLoader();

  public mesh: Object3D | null = null;
  public headBone: Bone | null = null;
  public characterHeight: number | null = null;

  public animations: Record<string, AnimationAction> = {};
  public animationMixer: AnimationMixer | null = null;
  public currentAnimation: AnimationState = AnimationState.idle;

  public mmlCharacterDescription: MMLCharacterDescription;

  private isPostDoubleJump = false;
  
  private colors: Array<[number, number, number]> | null = null;

  constructor(private config: CharacterModelConfig) {}

  public async init(): Promise<void> {
    await this.loadMainMesh();
    if (this.mesh) {
      await this.setAnimationFromFile(
        this.config.animationConfig.idleAnimationFileUrl,
        AnimationState.idle,
        true,
      );
      await this.setAnimationFromFile(
        this.config.animationConfig.jogAnimationFileUrl,
        AnimationState.walking,
        true,
      );
      await this.setAnimationFromFile(
        this.config.animationConfig.sprintAnimationFileUrl,
        AnimationState.running,
        true,
      );
      await this.setAnimationFromFile(
        this.config.animationConfig.airAnimationFileUrl,
        AnimationState.air,
        true,
      );
      await this.setAnimationFromFile(
        this.config.animationConfig.doubleJumpAnimationFileUrl,
        AnimationState.doubleJump,
        false,
        1.45,
      );
    }
  }

  public updateAnimation(targetAnimation: AnimationState) {
    if (this.isPostDoubleJump) {
      if (targetAnimation === AnimationState.doubleJump) {
        // Double jump is requested, but we're in the post double jump state so we play air instead
        targetAnimation = AnimationState.air;
      } else {
        // Reset the post double jump flag if something other than double jump is requested
        this.isPostDoubleJump = false;
      }
    }
    if (this.currentAnimation !== targetAnimation) {
      console.log(`CharacterModel updateAnimation for clientId=${this.config.characterId}`, targetAnimation);
      this.transitionToAnimation(targetAnimation);
    }
  }

  private setMainMesh(mainMesh: Object3D): void {
    this.mesh = mainMesh;
    this.mesh.position.set(0, -0.44, 0);
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
        "ERROR: An MML Character Description was provided, but it's not a valid <m-character> string, or a valid URL",
      );
    }

    let mergedCharacter: Object3D | null = null;
    if (mmlCharacterDescription) {
      const characterBase = mmlCharacterDescription.base?.url || null;
      if (characterBase) {
        this.mmlCharacterDescription = mmlCharacterDescription;
        const mmlCharacter = new MMLCharacter(CharacterModel.ModelLoader);
        mergedCharacter = await mmlCharacter.mergeBodyParts(
          characterBase,
          mmlCharacterDescription.parts,
        );
        if (mergedCharacter) {
          return mergedCharacter;
        }
      }
    }
  }

  private async loadCharacterFromDescription(): Promise<Object3D | null> {
    if (this.config.characterDescription.meshFileUrl) {
      return (
        (await this.config.characterModelLoader.load(
          this.config.characterDescription.meshFileUrl,
          "model",
        )) || null
      );
    }

    let mmlCharacterSource: string;
    if (this.config.characterDescription.mmlCharacterUrl) {
      const res = await fetch(this.config.characterDescription.mmlCharacterUrl);
      mmlCharacterSource = await res.text();
    } else if (this.config.characterDescription.mmlCharacterString) {
      mmlCharacterSource = this.config.characterDescription.mmlCharacterString;
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

  public getColors(): Array<[number, number, number]> {
    if (!this.mesh) {
      return [];
    }
    if (this.colors) {
      return this.colors;
    }
    const colors = captureCharacterColorsFromObject3D(this.mesh, {
      circularSamplingRadius: 12,
      topDownSamplingSize: { width: 5, height: 150 },
      debug: false, // Reduced debug spam
    });
    this.colors = colorsToColorArray(colors);
    console.log("CharacterModel.getColors", this.colors);
    return this.colors;
  }

  private async loadMainMesh(): Promise<void> {
    let mainMesh: Object3D | null = null;
    try {
      mainMesh = await this.loadCharacterFromDescription();
    } catch (error) {
      console.error("Failed to load character from description", error);
    }
    if (mainMesh) {
      this.setMainMesh(mainMesh as Object3D);
    }
  }

  private cleanAnimationClips(
    skeletalMesh: Object3D | null,
    animationClip: AnimationClip,
    keepRootBonePositionAnimation: boolean,
  ): AnimationClip {
    const availableBones = new Set<string>();
    if (skeletalMesh) {
      skeletalMesh.traverse((child) => {
        const asBone = child as Bone;
        if (asBone.isBone) {
          availableBones.add(child.name);
        }
      });
    }
    animationClip.tracks = animationClip.tracks.filter((track) => {
      const [trackName, trackProperty] = track.name.split(".");
      if (keepRootBonePositionAnimation && trackName === "root" && trackProperty === "position") {
        return true;
      }
      const shouldAnimate =
        availableBones.has(trackName) && trackProperty !== "position" && trackProperty !== "scale";
      return shouldAnimate;
    });
    return animationClip;
  }

  private async setAnimationFromFile(
    animationFileUrl: string,
    animationType: AnimationState,
    loop: boolean = true,
    playbackSpeed: number = 1.0,
  ): Promise<void> {
    return new Promise(async (resolve, reject) => {
      const animation = await this.config.characterModelLoader.load(animationFileUrl, "animation");
      const cleanAnimation = this.cleanAnimationClips(this.mesh, animation as AnimationClip, true);
      if (typeof animation !== "undefined" && cleanAnimation instanceof AnimationClip) {
        this.animations[animationType] = this.animationMixer!.clipAction(cleanAnimation);
        this.animations[animationType].stop();
        this.animations[animationType].timeScale = playbackSpeed;
        if (animationType === AnimationState.idle) {
          this.animations[animationType].play();
        }
        if (!loop) {
          this.animations[animationType].setLoop(LoopRepeat, 1); // Ensure non-looping
          this.animations[animationType].clampWhenFinished = true;
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
    if (!this.mesh) {
      return;
    }

    const currentAction = this.animations[this.currentAnimation];
    this.currentAnimation = targetAnimation;
    const targetAction = this.animations[targetAnimation];

    if (!targetAction) {
      return;
    }

    if (currentAction) {
      currentAction.fadeOut(transitionDuration);
    }

    targetAction.reset();
    if (!targetAction.isRunning()) {
      targetAction.play();
    }

    if (targetAnimation === AnimationState.doubleJump) {
      targetAction.getMixer().addEventListener("finished", (_event) => {
        if (this.currentAnimation === AnimationState.doubleJump) {
          this.isPostDoubleJump = true;
          // This triggers the transition to the air animation because the double jump animation is done
          this.updateAnimation(AnimationState.doubleJump);
        }
      });
    }

    targetAction.enabled = true;
    targetAction.fadeIn(transitionDuration);
  }

  update(time: number) {
    if (this.animationMixer) {
      this.animationMixer.update(time);
    }
  }
}
