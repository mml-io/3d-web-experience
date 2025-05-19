import { parseMMLDescription, type MMLCharacterDescription } from "@mml-io/3d-web-avatar";
import * as playcanvas from "playcanvas";

import { CameraManager } from "../camera/CameraManager";

import { AnimationConfig, CharacterDescription } from "./Character";
import { CharacterMaterial } from "./CharacterMaterial";
import { CharacterModelLoader } from "./CharacterModelLoader";
import { AnimationState } from "./CharacterState";
import { PlayCanvasMMLCharacter } from "./PlayCanvasMMLCharacter";

export type CharacterModelConfig = {
  playcanvasApp: playcanvas.AppBase;
  characterDescription: CharacterDescription;
  animationConfig: AnimationConfig;
  characterModelLoader: CharacterModelLoader;
  cameraManager: CameraManager;
  characterId: number;
  isLocal: boolean;
};

export const AnimationStateStrings: string[] = [
  "idle", //        0
  "walking", //     1
  "running", //     2
  "jumpToAir", //   3
  "air", //         4
  "airToGround", // 5
  "doubleJump", //  6
];

export class CharacterModel {
  public mesh: playcanvas.Entity | null = null;
  // public headBone: Bone | null = null;
  public characterHeight: number | null = null;

  private materials: Map<string, CharacterMaterial> = new Map();

  private animations: Record<string, playcanvas.Animation> = {};
  // private animationMixer: AnimationMixer | null = null;
  public currentAnimation: AnimationState = AnimationState.idle;

  public mmlCharacterDescription: MMLCharacterDescription;

  private isPostDoubleJump = false;

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
      this.transitionToAnimation(targetAnimation);
    }
  }

  private setMainMesh(mainMesh: playcanvas.Entity): void {
    this.mesh = mainMesh;
    this.mesh.setPosition(0, -0.44, 0);
    // this.animationMixer = new AnimationMixer(this.mesh);
  }

  private async composeMMLCharacter(
    mmlCharacterDescription: MMLCharacterDescription,
  ): Promise<playcanvas.Entity | undefined> {
    if (mmlCharacterDescription.base?.url.length === 0) {
      throw new Error(
        "ERROR: An MML Character Description was provided, but it's not a valid <m-character> string, or a valid URL",
      );
    }

    let mergedCharacter: playcanvas.Entity | null = null;
    if (mmlCharacterDescription) {
      const characterBase = mmlCharacterDescription.base?.url || null;
      if (characterBase) {
        this.mmlCharacterDescription = mmlCharacterDescription;
        const mmlCharacter = new PlayCanvasMMLCharacter(this.config.characterModelLoader);
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

  private async loadCharacterFromDescription(): Promise<playcanvas.Entity | null> {
    if (this.config.characterDescription.meshFileUrl) {
      const asset = await this.config.characterModelLoader.load(
        this.config.characterDescription.meshFileUrl,
      );
      console.log(asset);
      const renderEntity: playcanvas.Entity = asset.resource.instantiateRenderEntity();
      renderEntity.addComponent("anim", {
        activate: true,
        speed: 1,
      });
      return renderEntity;
    }
    console.error("TODO - load character from MML description");

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
      mmlCharacterBody.addComponent("anim", {
        activate: true,
        speed: 1,
      });
      return mmlCharacterBody;
    }
    return null;
  }

  private async loadMainMesh(): Promise<void> {
    let mainMesh: playcanvas.Entity | null = null;
    try {
      mainMesh = await this.loadCharacterFromDescription();
    } catch (error) {
      console.error("Failed to load character from description", error);
    }
    if (mainMesh) {
      this.setMainMesh(mainMesh as playcanvas.Entity);
    }
  }

  // private cleanAnimationClips(
  //   skeletalMesh: Object3D | null,
  //   animationClip: AnimationClip,
  //   keepRootBonePositionAnimation: boolean,
  // ): AnimationClip {
  //   const availableBones = new Set<string>();
  //   if (skeletalMesh) {
  //     skeletalMesh.traverse((child) => {
  //       const asBone = child as Bone;
  //       if (asBone.isBone) {
  //         availableBones.add(child.name);
  //       }
  //     });
  //   }
  //   animationClip.tracks = animationClip.tracks.filter((track) => {
  //     const [trackName, trackProperty] = track.name.split(".");
  //     if (keepRootBonePositionAnimation && trackName === "root" && trackProperty === "position") {
  //       return true;
  //     }
  //     const shouldAnimate =
  //       availableBones.has(trackName) && trackProperty !== "position" && trackProperty !== "scale";
  //     return shouldAnimate;
  //   });
  //   return animationClip;
  // }

  private async setAnimationFromFile(
    animationFileUrl: string,
    animationType: AnimationState,
    loop: boolean = true,
    playbackSpeed: number = 1.0,
  ): Promise<void> {
    return new Promise(async (resolve, reject) => {
      const fileName = animationFileUrl.split("/").pop() || "";
      const animationAsset = new playcanvas.Asset(
        fileName,
        "container",
        { url: animationFileUrl, filename: fileName },
        undefined,
      );

      animationAsset.ready(() => {
        if (!this.mesh || !this.mesh.anim) {
          reject("Mesh or anim component not found");
          return;
        }

        const animTrack = animationAsset.resource.animations[0].resource;
        const animName = AnimationStateStrings[animationType];
        this.animations[animName] = animTrack;
        this.mesh.anim.addAnimationState(animName, animTrack);

        // Set animation properties
        if (!loop) {
          const layer = this.mesh.anim.findAnimationLayer("BaseLayer");
          if (layer) {
            // Configure the animation through assignAnimation which allows setting loop property
            layer.assignAnimation(animName, animTrack, playbackSpeed, loop);
          }
        }

        resolve(animTrack);
      });

      this.config.playcanvasApp.assets.add(animationAsset);
      this.config.playcanvasApp.assets.load(animationAsset);
    });
  }

  private transitionToAnimation(
    targetAnimation: AnimationState,
    transitionDuration: number = 0.15,
  ): void {
    if (!this.mesh || !this.mesh.anim) {
      return;
    }

    const animName = AnimationStateStrings[targetAnimation];

    // Check if the target animation exists in our loaded animations
    if (animName in this.animations) {
      // Use the transition method with the specified duration
      this.mesh.anim.baseLayer.transition(animName, transitionDuration);

      // Update our current animation state
      this.currentAnimation = targetAnimation;

      // Special handling for double jump animation
      if (targetAnimation === AnimationState.doubleJump) {
        // Set a flag to track that we're in post-double-jump state
        // This will be reset when any other animation is requested
        this.isPostDoubleJump = true;
      }
    } else {
      console.warn(`Animation ${targetAnimation} not found in loaded animations`);
    }
  }

  update(time: number) {
    // Update animations if needed
    if (this.mesh && this.mesh.anim) {
      // PlayCanvas handles animation updates internally
      this.materials.forEach((material) => material.update());
    }
  }
}
