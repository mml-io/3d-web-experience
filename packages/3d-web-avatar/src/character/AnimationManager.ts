import { AnimationAction, AnimationClip, AnimationMixer, LoopRepeat, Object3D } from "three";

import { AnimationState } from "./Character";
import MODEL_LOADER, { ModelLoader } from "./ModelLoader";
import { TimeManager } from "./TimeManager";

export class AnimationManager {
  private modelLoader: ModelLoader = MODEL_LOADER;

  private mixer: AnimationMixer | null = null;
  private animations: Map<number, AnimationAction> = new Map();
  private currentAnimationAction: AnimationState = AnimationState.idle;

  constructor(private timeManager: TimeManager) {}

  public async setAnimationFromURL(
    url: string,
    state: AnimationState,
    model: Object3D,
  ): Promise<void> {
    if (this.mixer !== null) this.mixer = null;
    this.mixer = new AnimationMixer(model);

    const gltf = await this.modelLoader.load(url);
    if (gltf && gltf.animations) {
      const animationClip = gltf.animations[0];
      model.animations[0] = animationClip;
      const animationAction = this.mixer.clipAction(animationClip);
      this.animations.set(state, animationAction);
      this.currentAnimationAction = state;
      const anim = this.animations.get(state);
      anim?.setLoop(LoopRepeat, Infinity);
      anim!.play();
    }
  }

  public stopCurrentAnimation(): void {
    const anim = this.animations.get(this.currentAnimationAction);
    anim?.stop();
  }

  public get currentAction(): AnimationState {
    return this.currentAnimationAction;
  }

  public update(): void {
    if (this.mixer) {
      this.mixer.update(this.timeManager.smoothDeltaTime);
    }
  }
}
