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
  public currentAnimation: AnimationState = AnimationState.idle;

  public mmlCharacterDescription: MMLCharacterDescription;

  private isPostDoubleJump = false;
  private doubleJumpDuration: number | null = null;

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
        true,
      );
      console.log(this.mesh);
    }
  }

  public updateAnimation(targetAnimation: AnimationState) {
    if (this.isPostDoubleJump) {
      if (targetAnimation === AnimationState.doubleJump) {
        targetAnimation = AnimationState.air;
      } else {
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

  private async setAnimationFromFile(
    animationFileUrl: string,
    animationType: AnimationState,
    loop: boolean = true,
    playbackSpeed: number = 1.0,
    filterNonRotation: boolean = false,
  ): Promise<void> {
    return new Promise(async (resolve, reject) => {
      const fileName = animationFileUrl.split("/").pop() || "";
      const animationAsset = new playcanvas.Asset(
        fileName,
        "container",
        {
          url: animationFileUrl,
          filename: fileName,
        },
        undefined,
        // { // doesn't work on playcanvas 1.73.5
        //   animation: {
        //     preprocess: (data: any) => {
        //       data.channels.forEach((item: any) => {
        //         console.log(item.target);
        //         return item.target.node <= 2 || item.target.path === "rotation";
        //       });
        //     },
        //   },
        // },
      );

      animationAsset.ready(() => {
        if (!this.mesh || !this.mesh.anim) {
          reject("Mesh or anim component not found");
          return;
        }

        const container = animationAsset.resource;
        const animAsset = container.animations?.[0];
        const anim = animAsset?.resource;

        if (!anim || !anim.curves) {
          reject("Animation resource or curves missing");
          return;
        }

        const animName = AnimationStateStrings[animationType];

        // TODO: update playcanvas to use the new way of filtering animation tracks
        // that was commented out above
        if (filterNonRotation) {
          let removed = 0;
          anim.curves.forEach((curve: any) => {
            const keep = curve._paths.some(
              (path: any) => path.propertyPath?.[0] === "localRotation",
            );

            if (!keep) {
              curve._keys = [];
              curve._paths = [];
              removed++;
            }
          });

          console.log(`[FILTER] Removed ${removed} non-rotation from '${anim.name}'`);
        }

        this.animations[animName] = anim;
        this.mesh.anim.addAnimationState(animName, anim, playbackSpeed, loop);

        // TODO: add a way to bind a callback to the end of the animation
        // playcanvas 1.73.5 doesn't seem to have a static event for that

        // if (animName === AnimationStateStrings[AnimationState.doubleJump]) {
        //   this.mesh.anim.on("end", () => {});
        // }

        resolve();
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
    if (animName === AnimationStateStrings[AnimationState.doubleJump]) {
      this.doubleJumpDuration = this.mesh.anim.baseLayer.activeStateDuration;
    }

    // Check if the target animation exists in our loaded animations
    if (animName in this.animations) {
      // Use the transition method with the specified duration
      this.mesh.anim.baseLayer.transition(animName, transitionDuration);

      // Update our current animation state
      this.currentAnimation = targetAnimation;

      if (targetAnimation === AnimationState.doubleJump) {
        const duration = this.doubleJumpDuration ? this.doubleJumpDuration * 1000 : 500;
        setTimeout(() => (this.isPostDoubleJump = true), duration);
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
