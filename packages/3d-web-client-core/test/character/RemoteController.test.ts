import { describe, expect, test } from "@jest/globals";

import { AnimationState } from "../../src/character/CharacterState";
import { RemoteController } from "../../src/character/RemoteController";
import { EulXYZ } from "../../src/math/EulXYZ";
import { Vect3 } from "../../src/math/Vect3";

describe("RemoteController", () => {
  function createController(pos = new Vect3(), rot = new EulXYZ()) {
    return new RemoteController(pos, rot, AnimationState.idle);
  }

  function makeUpdate(
    x: number,
    y: number,
    z: number,
    state: AnimationState = AnimationState.idle,
    eulerY = 0,
  ) {
    return {
      position: { x, y, z },
      rotation: { eulerY },
      state,
    };
  }

  test("initializes position from constructor", () => {
    const ctrl = createController(new Vect3(5, 10, 15));
    expect(ctrl.position.x).toBeCloseTo(5);
    expect(ctrl.position.y).toBeCloseTo(10);
    expect(ctrl.position.z).toBeCloseTo(15);
  });

  test("initializes with provided animation state", () => {
    const ctrl = new RemoteController(new Vect3(), new EulXYZ(), AnimationState.running);
    expect(ctrl.animationState).toBe(AnimationState.running);
  });

  test("first update snaps position", () => {
    const ctrl = createController();
    ctrl.update(makeUpdate(10, 20, 30), 0.016);
    expect(ctrl.position.x).toBeCloseTo(10);
    expect(ctrl.position.y).toBeCloseTo(20);
    expect(ctrl.position.z).toBeCloseTo(30);
  });

  test("first update snaps rotation", () => {
    const ctrl = createController();
    const angle = Math.PI / 2;
    ctrl.update(makeUpdate(0, 0, 0, AnimationState.idle, angle), 0.016);
    expect(ctrl.rotation.y).toBeCloseTo(Math.sin(angle / 2));
    expect(ctrl.rotation.w).toBeCloseTo(Math.cos(angle / 2));
  });

  test("first update sets animation state", () => {
    const ctrl = createController();
    ctrl.update(makeUpdate(0, 0, 0, AnimationState.walking), 0.016);
    expect(ctrl.animationState).toBe(AnimationState.walking);
  });

  test("subsequent updates interpolate position", () => {
    const ctrl = createController();
    // First update snaps
    ctrl.update(makeUpdate(0, 0, 0), 0.016);
    // Second update should interpolate
    ctrl.update(makeUpdate(1, 0, 0), 0.016);
    // Position should be between 0 and 1
    expect(ctrl.position.x).toBeGreaterThan(0);
    expect(ctrl.position.x).toBeLessThan(1);
  });

  test("interpolation converges toward target over time", () => {
    const ctrl = createController();
    ctrl.update(makeUpdate(0, 0, 0), 0.016);
    ctrl.update(makeUpdate(2, 0, 0), 0.016);
    const posAfterFirst = ctrl.position.x;

    // Apply many more frames with same target
    for (let i = 0; i < 100; i++) {
      ctrl.update(makeUpdate(2, 0, 0), 0.016);
    }
    expect(ctrl.position.x).toBeGreaterThan(posAfterFirst);
    expect(ctrl.position.x).toBeCloseTo(2, 1);
  });

  test("large jump (>5m) teleports instead of interpolating", () => {
    const ctrl = createController();
    ctrl.update(makeUpdate(0, 0, 0), 0.016);
    // Move more than 5 meters
    ctrl.update(makeUpdate(10, 0, 0), 0.016);
    // Should teleport directly
    expect(ctrl.position.x).toBeCloseTo(10);
  });

  test("teleport threshold is exactly 5m", () => {
    const ctrl = createController();
    ctrl.update(makeUpdate(0, 0, 0), 0.016);
    // Move exactly 5m — should interpolate (not > 5)
    ctrl.update(makeUpdate(5, 0, 0), 0.016);
    // Should NOT have teleported, so position < 5
    expect(ctrl.position.x).toBeLessThan(5);
  });

  test("rotation slerps between updates", () => {
    const ctrl = createController();
    ctrl.update(makeUpdate(0, 0, 0, AnimationState.idle, 0), 0.016);
    const angle = Math.PI / 2;
    const expectedQY = Math.sin(angle / 2);
    ctrl.update(makeUpdate(0, 0, 0, AnimationState.idle, angle), 0.016);
    // Rotation should be partially interpolated
    expect(ctrl.rotation.y).toBeGreaterThan(0);
    expect(ctrl.rotation.y).toBeLessThan(expectedQY);
  });

  test("animation state updates immediately (not interpolated)", () => {
    const ctrl = createController();
    ctrl.update(makeUpdate(0, 0, 0, AnimationState.idle), 0.016);
    ctrl.update(makeUpdate(0, 0, 0, AnimationState.running), 0.016);
    expect(ctrl.animationState).toBe(AnimationState.running);
  });

  test("getRotationEuler returns EulXYZ from current rotation", () => {
    const ctrl = createController();
    const euler = ctrl.getRotationEuler();
    expect(euler).toBeDefined();
    // Identity quaternion => near-zero euler angles
    expect(euler.x).toBeCloseTo(0);
    expect(euler.y).toBeCloseTo(0);
    expect(euler.z).toBeCloseTo(0);
  });

  test("frame-rate independence: large dt converges faster", () => {
    const ctrl1 = createController();
    const ctrl2 = createController();

    // Both start at same position
    ctrl1.update(makeUpdate(0, 0, 0), 0.016);
    ctrl2.update(makeUpdate(0, 0, 0), 0.016);

    // Move to same target with different frame times
    ctrl1.update(makeUpdate(3, 0, 0), 0.016); // small dt
    ctrl2.update(makeUpdate(3, 0, 0), 0.1); // large dt

    // Larger dt should get closer to target
    expect(ctrl2.position.x).toBeGreaterThan(ctrl1.position.x);
  });

  test("position is a copy, not a reference to constructor argument", () => {
    const original = new Vect3(1, 2, 3);
    const ctrl = createController(original);
    original.set(99, 99, 99);
    expect(ctrl.position.x).toBeCloseTo(1);
    expect(ctrl.position.y).toBeCloseTo(2);
    expect(ctrl.position.z).toBeCloseTo(3);
  });
});
