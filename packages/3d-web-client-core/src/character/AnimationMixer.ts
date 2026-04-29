import { AnimationState } from "./CharacterState";

export { AnimationState };

/**
 * Animation weights for rendering. Each animation can have a weight between 0 and 1.
 * When transitioning between animations, multiple animations can have non-zero weights.
 */
export type AnimationWeights = {
  [AnimationState.idle]: number;
  [AnimationState.walking]: number;
  [AnimationState.running]: number;
  [AnimationState.jumpToAir]: number;
  [AnimationState.air]: number;
  [AnimationState.airToGround]: number;
  [AnimationState.doubleJump]: number;
};

/**
 * Animation times for rendering. Each animation has its own time value in seconds.
 * When an animation starts playing, its time is reset to 0.
 */
export type AnimationTimes = {
  [AnimationState.idle]: number;
  [AnimationState.walking]: number;
  [AnimationState.running]: number;
  [AnimationState.jumpToAir]: number;
  [AnimationState.air]: number;
  [AnimationState.airToGround]: number;
  [AnimationState.doubleJump]: number;
};

/**
 * Manages smooth transitions between animation states.
 * Calculates animation weights for blending during transitions.
 */
export class AnimationMixer {
  private currentState: AnimationState;
  private targetState: AnimationState;
  private transitionProgress: number = 1.0; // 0 to 1, where 1 means transition complete
  private transitionDuration: number = 0.15; // Default transition time in seconds
  private weights: AnimationWeights;
  private animationTimes: AnimationTimes;

  constructor(initialState: AnimationState = AnimationState.idle) {
    this.currentState = initialState;
    this.targetState = initialState;
    this.weights = this.createZeroWeights();
    this.weights[initialState] = 1.0;
    this.animationTimes = this.createZeroTimes();
  }

  /**
   * Set the target animation state. If different from current, begins a transition.
   */
  public setTargetState(state: AnimationState): void {
    if (this.targetState === state) {
      return;
    }

    // If we're mid-transition, snap to the target and start a new transition
    if (this.transitionProgress < 1.0) {
      this.currentState = this.targetState;
    }

    this.targetState = state;
    this.transitionProgress = 0.0;

    // Reset the time for the new target animation to start from 0
    this.animationTimes[state] = 0.0;

    // Update weights immediately to reflect the new transition
    this.updateWeights();
  }

  /**
   * Update the animation mixer, progressing any active transitions.
   */
  public update(deltaTime: number): void {
    // Update times for all animations that have non-zero weight
    for (const state of [
      AnimationState.idle,
      AnimationState.walking,
      AnimationState.running,
      AnimationState.jumpToAir,
      AnimationState.air,
      AnimationState.airToGround,
      AnimationState.doubleJump,
    ]) {
      if (this.weights[state] > 0) {
        this.animationTimes[state] += deltaTime;
      }
    }

    if (this.transitionProgress >= 1.0) {
      // No active transition, but ensure weights are up to date
      return;
    }

    this.transitionProgress += deltaTime / this.transitionDuration;
    if (this.transitionProgress >= 1.0) {
      this.transitionProgress = 1.0;
      this.currentState = this.targetState;
    }

    this.updateWeights();
  }

  /**
   * Get the current animation weights for rendering.
   */
  public getWeights(): AnimationWeights {
    return this.weights;
  }

  /**
   * Get the animation times for each animation state.
   */
  public getAnimationTimes(): AnimationTimes {
    return this.animationTimes;
  }

  /**
   * Get the primary animation state (the target we're transitioning to, or current if no transition).
   */
  public getPrimaryState(): AnimationState {
    return this.targetState;
  }

  /**
   * Returns true if currently transitioning between animations.
   */
  public isTransitioning(): boolean {
    return this.transitionProgress < 1.0;
  }

  /**
   * Immediately snap to a state without transitioning.
   */
  public snapToState(state: AnimationState): void {
    this.currentState = state;
    this.targetState = state;
    this.transitionProgress = 1.0;
    this.weights = this.createZeroWeights();
    this.weights[state] = 1.0;
    this.animationTimes = this.createZeroTimes();
  }

  private updateWeights(): void {
    this.weights = this.createZeroWeights();

    if (this.transitionProgress >= 1.0) {
      // Transition complete
      this.weights[this.targetState] = 1.0;
    } else {
      // In transition: blend between current and target
      const t = this.easeInOut(this.transitionProgress);
      this.weights[this.currentState] = 1.0 - t;
      this.weights[this.targetState] = t;
    }
  }

  private createZeroWeights(): AnimationWeights {
    return {
      [AnimationState.idle]: 0,
      [AnimationState.walking]: 0,
      [AnimationState.running]: 0,
      [AnimationState.jumpToAir]: 0,
      [AnimationState.air]: 0,
      [AnimationState.airToGround]: 0,
      [AnimationState.doubleJump]: 0,
    };
  }

  private createZeroTimes(): AnimationTimes {
    return {
      [AnimationState.idle]: 0,
      [AnimationState.walking]: 0,
      [AnimationState.running]: 0,
      [AnimationState.jumpToAir]: 0,
      [AnimationState.air]: 0,
      [AnimationState.airToGround]: 0,
      [AnimationState.doubleJump]: 0,
    };
  }

  private easeInOut(t: number): number {
    // Smooth ease-in-out curve for natural-looking transitions
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  }
}
