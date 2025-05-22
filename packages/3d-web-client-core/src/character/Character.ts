import * as playcanvas from "playcanvas";

import { CameraManager } from "../camera/CameraManager";
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
  animationConfig: AnimationConfig;
  characterModelLoader: CharacterModelLoader;
  characterId: number;
  modelLoadedCallback: () => void;
  cameraManager: CameraManager;
  composer: Composer;
  isLocal: boolean;
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

export class Character extends playcanvas.Entity {
  private characterModel: CharacterModel | null = null;
  public tooltip: CharacterTooltip;

  public chatTooltips: CharacterTooltip[] = [];

  constructor(
    private playcanvasApp: playcanvas.AppBase,
    private config: CharacterConfig,
  ) {
    super();
    this.tooltip = new CharacterTooltip(
      this.playcanvasApp,
      this.config.cameraManager,
      this.config.isLocal
        ? {
            secondsToFadeOut: 10,
          }
        : {},
    );
    this.tooltip.setText(this.config.username);
    this.addChild(this.tooltip);
    this.load().then(() => {
      this.config.modelLoadedCallback();
      this.setTooltipHeights();
    });
  }

  updateCharacter(username: string, characterDescription: CharacterDescription) {
    if (!characterDescriptionMatches(this.config.characterDescription, characterDescription)) {
      this.config.characterDescription = characterDescription;
      this.load().then(() => {
        this.setTooltipHeights();
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
    if (this.characterModel && this.characterModel.characterHeight) {
      let height = characterHeightToTooltipHeightOffset(this.characterModel.characterHeight);
      this.tooltip.setHeightOffset(height);

      height = this.tooltip.getSpriteHeight();

      for (const chatTooltip of this.chatTooltips) {
        chatTooltip.setHeightOffset(height);
        height += chatTooltip.getSpriteHeight();
      }
    }
  }

  private async load(): Promise<void> {
    const previousModel = this.characterModel;
    if (previousModel && previousModel.mesh) {
      this.removeChild(previousModel.mesh);
    }
    this.characterModel = new CharacterModel({
      playcanvasApp: this.playcanvasApp,
      characterDescription: this.config.characterDescription,
      animationConfig: this.config.animationConfig,
      characterModelLoader: this.config.characterModelLoader,
      cameraManager: this.config.cameraManager,
      characterId: this.config.characterId,
      isLocal: this.config.isLocal,
    });
    await this.characterModel.init();
    if (this.characterModel.mesh) {
      this.addChild(this.characterModel.mesh);
    }
  }

  public updateAnimation(targetAnimation: AnimationState) {
    this.characterModel?.updateAnimation(targetAnimation);
  }

  public update(time: number, deltaTime: number) {
    if (!this.characterModel) return;
    if (this.tooltip) {
      this.tooltip.update();
    }
    this.characterModel.update(deltaTime);
  }

  getCurrentAnimation(): AnimationState {
    return this.characterModel?.currentAnimation || AnimationState.idle;
  }

  addChatBubble(message: string) {
    const tooltip = new CharacterTooltip(this.playcanvasApp, this.config.cameraManager, {
      maxWidth: 1000,
      secondsToFadeOut: 10,
      color: new playcanvas.Color(0.125, 0.125, 0.125),
    });
    this.tooltip.addChild(tooltip);
    this.chatTooltips.unshift(tooltip);
    tooltip.setText(message, () => {
      this.chatTooltips = this.chatTooltips.filter((t) => t !== tooltip);
      this.tooltip.removeChild(tooltip);
      this.setTooltipHeights();
    });
    if (this.config.isLocal) {
      // Show the character's name if they're local and they emit a chat bubble
      this.tooltip.show();
    }
    this.setTooltipHeights();
  }
}
