import { AnimationClip, Color, Group, Object3D, Quaternion } from "three";

import { CameraManager } from "../camera/CameraManager";
import { EulXYZ } from "../math/EulXYZ";
import { Vect3 } from "../math/Vect3";
import { Composer } from "../rendering/composer";

import { CharacterModel } from "./CharacterModel";
import { CharacterModelLoader } from "./CharacterModelLoader";
import { AnimationState } from "./CharacterState";
import { CharacterTooltip } from "./CharacterTooltip";

export type AnimationConfig = {
  idleAnimationFileUrl: string;
  jogAnimationFileUrl: string;
  sprintAnimationFileUrl: string;
  airAnimationFileUrl: string;
  doubleJumpAnimationFileUrl: string;
};

export type LoadedAnimations = {
  idleAnimation: AnimationClip;
  jogAnimation: AnimationClip;
  sprintAnimation: AnimationClip;
  airAnimation: AnimationClip;
  doubleJumpAnimation: AnimationClip;
};

export type CharacterDescription =
  | {
      meshFileUrl: string;
      mmlCharacterString?: null;
      mmlCharacterUrl?: null;
    }
  | {
      meshFileUrl?: null;
      mmlCharacterString: string;
      mmlCharacterUrl?: null;
    }
  | {
      meshFileUrl?: null;
      mmlCharacterString?: null;
      mmlCharacterUrl: string;
    };

export type CharacterConfig = {
  username: string;
  characterDescription: CharacterDescription;
  animationsPromise: Promise<LoadedAnimations>;
  characterModelLoader: CharacterModelLoader;
  characterId: number;
  modelLoadedCallback: () => void;
  cameraManager: CameraManager;
  composer: Composer;
  isLocal: boolean;
  abortController?: AbortController;
};

function characterHeightToTooltipHeightOffset(characterHeight: number): number {
  return characterHeight - 0.4 + 0.1;
}

function characterDescriptionMatches(a: CharacterDescription, b: CharacterDescription): boolean {
  return (
    a.meshFileUrl === b.meshFileUrl &&
    a.mmlCharacterString === b.mmlCharacterString &&
    a.mmlCharacterUrl === b.mmlCharacterUrl
  );
}

export class Character extends Group {
  private model: CharacterModel | null = null;
  public tooltip: CharacterTooltip;

  public chatTooltips: CharacterTooltip[] = [];

  constructor(private config: CharacterConfig) {
    super();
    this.tooltip = new CharacterTooltip(
      this.config.isLocal
        ? {
            secondsToFadeOut: 10,
          }
        : {},
    );
    this.tooltip.setText(this.config.username);
    this.add(this.tooltip);

    // Check if operation was cancelled before starting loading
    if (this.config.abortController?.signal.aborted) {
      console.log(`Character loading cancelled before starting for ${this.config.characterId}`);
      return;
    }

    this.load()
      .then(() => {
        this.config.modelLoadedCallback();
        this.setTooltipHeights();
      })
      .catch((error) => {
        // Check if the error is due to cancellation
        if (this.config.abortController?.signal.aborted) {
          console.log(`Character loading cancelled in constructor for ${this.config.characterId}`);
          return;
        }
        console.error(
          `Character loading failed in constructor for ${this.config.username} (${this.config.characterId}):`,
          error,
        );
      });
  }

  getColors(): Array<[number, number, number]> {
    return this.model?.getColors() || [];
  }

  updateCharacter(username: string, characterDescription: CharacterDescription) {
    if (!characterDescriptionMatches(this.config.characterDescription, characterDescription)) {
      this.config.characterDescription = characterDescription;
      this.load()
        .then(() => {
          // Check if operation was cancelled after loading
          if (this.config.abortController?.signal.aborted) {
            console.log(`Character update cancelled for ${this.config.characterId}`);
            return;
          }
          this.setTooltipHeights();
        })
        .catch((error) => {
          // Check if the error is due to cancellation
          if (this.config.abortController?.signal.aborted) {
            console.log(`Character update cancelled during loading for ${this.config.characterId}`);
            return;
          }
          console.error(
            `Character update failed for ${this.config.username} (${this.config.characterId}):`,
            error,
          );
        });
    }
    if (this.config.username !== username) {
      this.config.username = username;
      this.tooltip.setText(username);
      // Force the tooltip to show if the character's name changes
      this.tooltip.show();
    }
  }

  private setTooltipHeights() {
    if (this.model && this.model.characterHeight) {
      let height = characterHeightToTooltipHeightOffset(this.model.characterHeight);
      this.tooltip.setHeightOffset(height);
      height += this.tooltip.scale.y;

      for (const chatTooltip of this.chatTooltips) {
        chatTooltip.setHeightOffset(height);
        height += chatTooltip.scale.y;
      }
    }
  }

  public static loadAnimations(
    characterModelLoader: CharacterModelLoader,
    animationConfig: AnimationConfig,
  ): Promise<LoadedAnimations> {
    return new Promise((resolve) => {
      const idleAnimation = characterModelLoader.load(
        animationConfig.idleAnimationFileUrl,
        "animation",
      );
      const jogAnimation = characterModelLoader.load(
        animationConfig.jogAnimationFileUrl,
        "animation",
      );
      const sprintAnimation = characterModelLoader.load(
        animationConfig.sprintAnimationFileUrl,
        "animation",
      );
      const airAnimation = characterModelLoader.load(
        animationConfig.airAnimationFileUrl,
        "animation",
      );
      const doubleJumpAnimation = characterModelLoader.load(
        animationConfig.doubleJumpAnimationFileUrl,
        "animation",
      );
      resolve(
        Promise.all([
          idleAnimation,
          jogAnimation,
          sprintAnimation,
          airAnimation,
          doubleJumpAnimation,
        ]).then((animations) => {
          const animationConfig: LoadedAnimations = {
            idleAnimation: animations[0]!,
            jogAnimation: animations[1]!,
            sprintAnimation: animations[2]!,
            airAnimation: animations[3]!,
            doubleJumpAnimation: animations[4]!,
          };
          return animationConfig;
        }),
      );
    });
  }

  private async load(): Promise<void> {
    // Check if operation was cancelled before starting
    if (this.config.abortController?.signal.aborted) {
      console.log(`Character loading cancelled for ${this.config.characterId}`);
      return;
    }

    const previousModel = this.model;
    if (previousModel && previousModel.mesh) {
      this.remove(previousModel.mesh);
    }
    this.model = new CharacterModel({
      characterDescription: this.config.characterDescription,
      animationsPromise: this.config.animationsPromise,
      characterModelLoader: this.config.characterModelLoader,
      cameraManager: this.config.cameraManager,
      characterId: this.config.characterId,
      isLocal: this.config.isLocal,
      abortController: this.config.abortController,
    });

    try {
      await this.model.init();

      // Check if operation was cancelled after loading
      if (this.config.abortController?.signal.aborted) {
        console.log(`Character loading cancelled after init for ${this.config.characterId}`);
        if (this.model) {
          this.model.dispose();
          this.model = null;
        }
        return;
      }

      if (this.model && this.model.mesh) {
        this.add(this.model.mesh);
      } else {
        console.warn(
          `Character model for ${this.config.username} (${this.config.characterId}) failed to load.`,
        );
      }
    } catch (error) {
      // Check if the error is due to cancellation
      if (this.config.abortController?.signal.aborted) {
        console.log(`Character loading cancelled during init for ${this.config.characterId}`);
        return;
      }
      console.error(
        `Character loading failed for ${this.config.username} (${this.config.characterId}):`,
        error,
      );
      throw error;
    }
  }

  public updateAnimation(targetAnimation: AnimationState) {
    this.model?.updateAnimation(targetAnimation);
  }

  public update(time: number, deltaTime: number) {
    if (!this.model) return;
    if (this.tooltip) {
      this.tooltip.update();
    }
    this.model.update(deltaTime);
  }

  public getPosition(): Vect3 {
    return this.position as unknown as Vect3;
  }

  public getRotation(): EulXYZ {
    return this.rotation as unknown as EulXYZ;
  }

  public setPosition(x: number, y: number, z: number) {
    this.position.set(x, y, z);
  }

  public setRotation(x: number, y: number, z: number, w: number) {
    this.rotation.setFromQuaternion(new Quaternion(x, y, z, w));
  }

  getCurrentAnimation(): AnimationState {
    return this.model?.currentAnimation || AnimationState.idle;
  }

  addChatBubble(message: string) {
    const tooltip = new CharacterTooltip({
      maxWidth: 1000,
      secondsToFadeOut: 10,
      color: new Color(0.125, 0.125, 0.125),
    });
    this.add(tooltip);
    this.chatTooltips.unshift(tooltip);
    tooltip.setText(message, () => {
      this.chatTooltips = this.chatTooltips.filter((t) => t !== tooltip);
      this.remove(tooltip);
      this.setTooltipHeights();
    });
    if (this.config.isLocal) {
      // Show the character's name if they're local and they emit a chat bubble
      this.tooltip.show();
    }
    this.setTooltipHeights();
  }

  public getMesh(): Object3D | null {
    return this.model?.mesh || null;
  }

  dispose() {
    if (this.model) {
      this.model.dispose();
      this.model = null;
    }
    // TODO - dispose of the tooltip and chat tooltips
  }
}
