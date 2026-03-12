import { describe, expect, test } from "@jest/globals";

import { AnimationMixer, AnimationState } from "../../src/character/AnimationMixer";

describe("AnimationMixer", () => {
  test("initializes with idle state and full weight", () => {
    const mixer = new AnimationMixer();
    const weights = mixer.getWeights();
    expect(weights[AnimationState.idle]).toBe(1.0);
    expect(weights[AnimationState.walking]).toBe(0);
    expect(weights[AnimationState.running]).toBe(0);
    expect(mixer.getPrimaryState()).toBe(AnimationState.idle);
    expect(mixer.isTransitioning()).toBe(false);
  });

  test("initializes with custom initial state", () => {
    const mixer = new AnimationMixer(AnimationState.running);
    const weights = mixer.getWeights();
    expect(weights[AnimationState.running]).toBe(1.0);
    expect(weights[AnimationState.idle]).toBe(0);
    expect(mixer.getPrimaryState()).toBe(AnimationState.running);
  });

  test("animation times start at zero", () => {
    const mixer = new AnimationMixer();
    const times = mixer.getAnimationTimes();
    for (const state of [
      AnimationState.idle,
      AnimationState.walking,
      AnimationState.running,
      AnimationState.jumpToAir,
      AnimationState.air,
      AnimationState.airToGround,
      AnimationState.doubleJump,
    ]) {
      expect(times[state]).toBe(0);
    }
  });

  test("setTargetState begins a transition", () => {
    const mixer = new AnimationMixer();
    mixer.setTargetState(AnimationState.walking);
    expect(mixer.isTransitioning()).toBe(true);
    expect(mixer.getPrimaryState()).toBe(AnimationState.walking);
  });

  test("setTargetState to same state does nothing", () => {
    const mixer = new AnimationMixer();
    mixer.setTargetState(AnimationState.idle);
    expect(mixer.isTransitioning()).toBe(false);
  });

  test("transition progresses with update", () => {
    const mixer = new AnimationMixer();
    mixer.setTargetState(AnimationState.walking);

    // At t=0, walking weight should be close to 0
    const initialWeights = mixer.getWeights();
    expect(initialWeights[AnimationState.walking]).toBeCloseTo(0, 2);
    expect(initialWeights[AnimationState.idle]).toBeCloseTo(1, 2);

    // After half the transition (0.075s)
    mixer.update(0.075);
    const midWeights = mixer.getWeights();
    expect(midWeights[AnimationState.walking]).toBeGreaterThan(0);
    expect(midWeights[AnimationState.idle]).toBeGreaterThan(0);
    expect(midWeights[AnimationState.walking] + midWeights[AnimationState.idle]).toBeCloseTo(1, 5);
  });

  test("transition completes after transitionDuration", () => {
    const mixer = new AnimationMixer();
    mixer.setTargetState(AnimationState.walking);

    // Update past the full transition (0.15s)
    mixer.update(0.2);
    const weights = mixer.getWeights();
    expect(weights[AnimationState.walking]).toBe(1.0);
    expect(weights[AnimationState.idle]).toBe(0);
    expect(mixer.isTransitioning()).toBe(false);
  });

  test("update accumulates animation time for active states", () => {
    const mixer = new AnimationMixer();
    mixer.update(0.5);
    const times = mixer.getAnimationTimes();
    expect(times[AnimationState.idle]).toBeCloseTo(0.5, 5);
    expect(times[AnimationState.walking]).toBe(0);
  });

  test("animation times accumulate during transitions for both states", () => {
    const mixer = new AnimationMixer();
    mixer.setTargetState(AnimationState.walking);
    // First update advances transition so both get non-zero weights
    mixer.update(0.05);
    // Second update accumulates time for both since both now have weight > 0
    mixer.update(0.05);
    const times = mixer.getAnimationTimes();
    expect(times[AnimationState.idle]).toBeGreaterThan(0);
    expect(times[AnimationState.walking]).toBeGreaterThan(0);
  });

  test("snapToState immediately sets state without transition", () => {
    const mixer = new AnimationMixer();
    mixer.snapToState(AnimationState.air);
    expect(mixer.getPrimaryState()).toBe(AnimationState.air);
    expect(mixer.isTransitioning()).toBe(false);
    const weights = mixer.getWeights();
    expect(weights[AnimationState.air]).toBe(1.0);
    expect(weights[AnimationState.idle]).toBe(0);
  });

  test("snapToState resets all animation times", () => {
    const mixer = new AnimationMixer();
    mixer.update(1.0);
    mixer.snapToState(AnimationState.walking);
    const times = mixer.getAnimationTimes();
    for (const state of [
      AnimationState.idle,
      AnimationState.walking,
      AnimationState.running,
      AnimationState.jumpToAir,
      AnimationState.air,
      AnimationState.airToGround,
      AnimationState.doubleJump,
    ]) {
      expect(times[state]).toBe(0);
    }
  });

  test("rapid state changes snap mid-transition state", () => {
    const mixer = new AnimationMixer();
    mixer.setTargetState(AnimationState.walking);
    mixer.update(0.05); // mid-transition

    // Change to a third state while mid-transition
    mixer.setTargetState(AnimationState.running);
    expect(mixer.isTransitioning()).toBe(true);

    // The current state should have snapped to walking (the previous target)
    // and we're now transitioning from walking to running
    mixer.update(0.2); // complete the transition
    const weights = mixer.getWeights();
    expect(weights[AnimationState.running]).toBe(1.0);
    expect(weights[AnimationState.walking]).toBe(0);
    expect(weights[AnimationState.idle]).toBe(0);
  });

  test("easeInOut produces smooth curve values", () => {
    const mixer = new AnimationMixer();
    mixer.setTargetState(AnimationState.walking);

    // Test at multiple points during the transition
    const steps = 10;
    const deltaPerStep = 0.15 / steps;
    let lastWeight = 0;
    for (let i = 0; i < steps; i++) {
      mixer.update(deltaPerStep);
      const weight = mixer.getWeights()[AnimationState.walking];
      expect(weight).toBeGreaterThanOrEqual(lastWeight);
      lastWeight = weight;
    }
    // After the full duration, weight should be at or very near 1
    expect(lastWeight).toBeCloseTo(1.0, 2);
  });

  test("new target state resets its animation time to 0", () => {
    const mixer = new AnimationMixer(AnimationState.walking);
    mixer.update(1.0);
    expect(mixer.getAnimationTimes()[AnimationState.walking]).toBeGreaterThan(0);

    mixer.setTargetState(AnimationState.idle);
    expect(mixer.getAnimationTimes()[AnimationState.idle]).toBe(0);
  });

  test("update with no active transition is a no-op on weights", () => {
    const mixer = new AnimationMixer();
    const weightsBefore = { ...mixer.getWeights() };
    mixer.update(0.5);
    const weightsAfter = mixer.getWeights();
    expect(weightsAfter[AnimationState.idle]).toBe(weightsBefore[AnimationState.idle]);
    expect(weightsAfter[AnimationState.walking]).toBe(weightsBefore[AnimationState.walking]);
  });

  test("all animation states have valid enum values", () => {
    expect(AnimationState.idle).toBe(0);
    expect(AnimationState.walking).toBe(1);
    expect(AnimationState.running).toBe(2);
    expect(AnimationState.jumpToAir).toBe(3);
    expect(AnimationState.air).toBe(4);
    expect(AnimationState.airToGround).toBe(5);
    expect(AnimationState.doubleJump).toBe(6);
  });

  test("transition from airToGround to idle", () => {
    const mixer = new AnimationMixer(AnimationState.airToGround);
    mixer.setTargetState(AnimationState.idle);
    mixer.update(0.2);
    expect(mixer.getPrimaryState()).toBe(AnimationState.idle);
    expect(mixer.getWeights()[AnimationState.idle]).toBe(1.0);
    expect(mixer.isTransitioning()).toBe(false);
  });

  test("weights always sum to 1 during transition", () => {
    const mixer = new AnimationMixer();
    mixer.setTargetState(AnimationState.running);
    for (let i = 0; i < 20; i++) {
      mixer.update(0.01);
      const weights = mixer.getWeights();
      let sum = 0;
      for (const state of [
        AnimationState.idle,
        AnimationState.walking,
        AnimationState.running,
        AnimationState.jumpToAir,
        AnimationState.air,
        AnimationState.airToGround,
        AnimationState.doubleJump,
      ]) {
        sum += weights[state];
      }
      expect(sum).toBeCloseTo(1.0, 5);
    }
  });
});
