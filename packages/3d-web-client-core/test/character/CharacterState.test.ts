import { describe, expect, test } from "@jest/globals";

import { AnimationState, type CharacterState } from "../../src/character/CharacterState";

describe("CharacterState", () => {
  test("AnimationState enum values are stable", () => {
    expect(AnimationState.idle).toBe(0);
    expect(AnimationState.walking).toBe(1);
    expect(AnimationState.running).toBe(2);
    expect(AnimationState.jumpToAir).toBe(3);
    expect(AnimationState.air).toBe(4);
    expect(AnimationState.airToGround).toBe(5);
    expect(AnimationState.doubleJump).toBe(6);
  });

  test("AnimationState enum has exactly 7 values", () => {
    // numeric enums have forward and reverse mappings
    const names = Object.keys(AnimationState).filter((k) => isNaN(Number(k)));
    expect(names).toHaveLength(7);
  });

  test("AnimationState names match expected string values", () => {
    expect(AnimationState[0]).toBe("idle");
    expect(AnimationState[1]).toBe("walking");
    expect(AnimationState[2]).toBe("running");
    expect(AnimationState[3]).toBe("jumpToAir");
    expect(AnimationState[4]).toBe("air");
    expect(AnimationState[5]).toBe("airToGround");
    expect(AnimationState[6]).toBe("doubleJump");
  });

  test("CharacterState type can be constructed", () => {
    const state: CharacterState = {
      position: { x: 1, y: 2, z: 3 },
      rotation: { eulerY: 0 },
      state: AnimationState.idle,
    };
    expect(state.position.x).toBe(1);
    expect(state.rotation.eulerY).toBe(0);
    expect(state.state).toBe(AnimationState.idle);
  });
});
