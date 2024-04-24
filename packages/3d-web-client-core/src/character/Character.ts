import { Color, Group, Vector3 } from "three";

import { CameraManager } from "../camera/CameraManager";
import { Composer } from "../rendering/composer";

import { CharacterModel } from "./CharacterModel";
import { CharacterModelLoader } from "./CharacterModelLoader";
import { CharacterSpeakingIndicator } from "./CharacterSpeakingIndicator";
import { AnimationState } from "./CharacterState";
import { CharacterTooltip } from "./CharacterTooltip";

export type AnimationConfig = {
  idleAnimationFileUrl: string;
  jogAnimationFileUrl: string;
  sprintAnimationFileUrl: string;
  airAnimationFileUrl: string;
};

export type CharacterDescription = {
  meshFileUrl?: string;
  mmlCharacterUrl?: string;
  mmlCharacterString?: string;
} & (
  | {
      meshFileUrl: string;
    }
  | {
      mmlCharacterUrl: string;
    }
  | {
      mmlCharacterString: string;
    }
);

export class Character extends Group {
  private model: CharacterModel | null = null;
  public color: Color = new Color();
  public tooltip: CharacterTooltip;
  public speakingIndicator: CharacterSpeakingIndicator | null = null;

  constructor(
    private username: string,
    private characterDescription: CharacterDescription,
    private readonly animationConfig: AnimationConfig,
    private readonly characterModelLoader: CharacterModelLoader,
    private readonly characterId: number,
    private readonly modelLoadedCallback: () => void,
    private readonly cameraManager: CameraManager,
    private readonly composer: Composer,
    private readonly isLocal: boolean,
  ) {
    super();
    this.tooltip = new CharacterTooltip();
    this.tooltip.setText(this.username, isLocal);
    this.add(this.tooltip);
    this.load().then(() => {
      this.modelLoadedCallback();
    });
  }

  updateCharacter(username: string, characterDescription: CharacterDescription) {
    this.username = username;
    this.characterDescription = characterDescription;
    this.load();
    this.tooltip.setText(username, this.isLocal);
  }

  private async load(callback?: () => void): Promise<void> {
    const previousModel = this.model;
    this.model = new CharacterModel(
      this.characterDescription,
      this.animationConfig,
      this.characterModelLoader,
      this.cameraManager,
      this.characterId,
      this.isLocal,
    );
    await this.model.init();
    if (previousModel && previousModel.mesh) {
      this.remove(previousModel.mesh!);
    }
    this.add(this.model.mesh!);
    if (this.speakingIndicator === null) {
      this.speakingIndicator = new CharacterSpeakingIndicator(this.composer.postPostScene);
    }
  }

  public updateAnimation(targetAnimation: AnimationState) {
    this.model?.updateAnimation(targetAnimation);
  }

  public update(time: number, deltaTime: number) {
    if (!this.model) return;
    if (this.tooltip) {
      this.tooltip.update(this.cameraManager.camera);
    }
    if (this.speakingIndicator) {
      this.speakingIndicator.setTime(time);
      if (this.model.mesh && this.model.headBone) {
        this.speakingIndicator.setBillboarding(
          this.model.headBone?.getWorldPosition(new Vector3()),
          this.cameraManager.camera,
        );
      }
    }
    this.model.update(deltaTime);
  }

  getCurrentAnimation(): AnimationState {
    return this.model?.currentAnimation || AnimationState.idle;
  }
}
