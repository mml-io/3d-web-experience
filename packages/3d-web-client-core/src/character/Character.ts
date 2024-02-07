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
};

export class Character extends Group {
  private model: CharacterModel | null = null;
  public color: Color = new Color();
  public tooltip: CharacterTooltip | null = null;
  public speakingIndicator: CharacterSpeakingIndicator | null = null;

  constructor(
    private readonly characterDescription: CharacterDescription,
    private readonly animationConfig: AnimationConfig,
    private readonly characterModelLoader: CharacterModelLoader,
    private readonly characterId: number,
    private readonly modelLoadedCallback: () => void,
    private readonly cameraManager: CameraManager,
    private readonly composer: Composer,
  ) {
    super();
    this.tooltip = new CharacterTooltip();
    this.add(this.tooltip);
    this.load();
  }

  private async load(): Promise<void> {
    this.model = new CharacterModel(
      this.characterDescription,
      this.animationConfig,
      this.characterModelLoader,
    );
    await this.model.init();
    this.add(this.model.mesh!);
    if (this.speakingIndicator === null) {
      this.speakingIndicator = new CharacterSpeakingIndicator(this.composer.postPostScene);
    }
    this.color = this.model.material.colorsCube216[this.characterId];
    this.modelLoadedCallback();
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
    if (typeof this.model.material.uniforms.time !== "undefined") {
      this.model.material.uniforms.time.value = time;
      this.model.material.uniforms.diffuseRandomColor.value = this.color;
      this.model.material.update();
    }
    this.model.update(deltaTime);
  }

  getCurrentAnimation(): AnimationState {
    return this.model?.currentAnimation || AnimationState.idle;
  }
}
