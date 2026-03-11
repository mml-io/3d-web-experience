/**
 * @jest-environment jsdom
 */

import { jest } from "@jest/globals";

import { Key, KeyInputManager } from "../../src/input/KeyInputManager";

describe("KeyInputManager", () => {
  let manager: KeyInputManager;

  beforeEach(() => {
    manager = new KeyInputManager();
  });

  afterEach(() => {
    manager.dispose();
  });

  function pressKey(key: string, options?: Partial<KeyboardEvent>) {
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...options }),
    );
  }

  function releaseKey(key: string, options?: Partial<KeyboardEvent>) {
    document.dispatchEvent(
      new KeyboardEvent("keyup", { key, bubbles: true, cancelable: true, ...options }),
    );
  }

  it("tracks key press and release", () => {
    pressKey("w");
    expect(manager.isKeyPressed("w")).toBe(true);
    releaseKey("w");
    expect(manager.isKeyPressed("w")).toBe(false);
  });

  it("getOutput returns null when no movement keys pressed", () => {
    expect(manager.getOutput()).toBeNull();
  });

  it("getOutput returns direction for W key (forward)", () => {
    pressKey("w");
    const output = manager.getOutput();
    expect(output).not.toBeNull();
    // W: dy = 0-1 = -1, dx = 0 → atan2(0, -1) = π
    expect(output!.direction).toBeCloseTo(Math.PI);
    expect(output!.isSprinting).toBe(false);
    expect(output!.jump).toBe(false);
  });

  it("getOutput returns direction for S key (backward)", () => {
    pressKey("s");
    const output = manager.getOutput();
    expect(output).not.toBeNull();
    // S: dy = 1-0 = 1, dx = 0 → atan2(0, 1) = 0
    expect(output!.direction).toBeCloseTo(0);
  });

  it("getOutput returns direction for A key (left)", () => {
    pressKey("a");
    const output = manager.getOutput();
    expect(output).not.toBeNull();
    // A: dy = 0, dx = 0-1 = -1 → atan2(-1, 0) = -π/2
    expect(output!.direction).toBeCloseTo(-Math.PI / 2);
  });

  it("getOutput returns direction for D key (right)", () => {
    pressKey("d");
    const output = manager.getOutput();
    expect(output).not.toBeNull();
    // D: dy = 0, dx = 1-0 = 1 → atan2(1, 0) = π/2
    expect(output!.direction).toBeCloseTo(Math.PI / 2);
  });

  it("sprint detection with Shift", () => {
    pressKey("w");
    pressKey("Shift");
    const output = manager.getOutput();
    expect(output).not.toBeNull();
    expect(output!.isSprinting).toBe(true);
  });

  it("jump detection with Space", () => {
    pressKey(" ");
    const output = manager.getOutput();
    expect(output).not.toBeNull();
    expect(output!.direction).toBeNull();
    expect(output!.jump).toBe(true);
  });

  it("jump + movement", () => {
    pressKey("w");
    pressKey(" ");
    const output = manager.getOutput();
    expect(output).not.toBeNull();
    expect(output!.jump).toBe(true);
    expect(output!.direction).not.toBeNull();
  });

  it("isMovementKeyPressed", () => {
    expect(manager.isMovementKeyPressed()).toBe(false);
    pressKey("w");
    expect(manager.isMovementKeyPressed()).toBe(true);
  });

  it("key bindings fire on keyup", () => {
    const callback = jest.fn();
    manager.createKeyBinding(Key.C, callback);
    pressKey("c");
    expect(callback).not.toHaveBeenCalled();
    releaseKey("c");
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("removeKeyBinding stops callback", () => {
    const callback = jest.fn();
    manager.createKeyBinding(Key.C, callback);
    manager.removeKeyBinding(Key.C);
    pressKey("c");
    releaseKey("c");
    expect(callback).not.toHaveBeenCalled();
  });

  it("duplicate createKeyBinding is ignored", () => {
    const callback1 = jest.fn();
    const callback2 = jest.fn();
    manager.createKeyBinding(Key.C, callback1);
    manager.createKeyBinding(Key.C, callback2);
    pressKey("c");
    releaseKey("c");
    expect(callback1).toHaveBeenCalledTimes(1);
    expect(callback2).not.toHaveBeenCalled();
  });

  it("removeKeyBinding for non-existent key is safe", () => {
    expect(() => manager.removeKeyBinding(Key.C)).not.toThrow();
  });

  it("shouldCaptureKeyPress filter", () => {
    manager.dispose();
    manager = new KeyInputManager(() => false);
    pressKey("w");
    expect(manager.isKeyPressed("w")).toBe(false);
  });

  it("meta key is ignored", () => {
    pressKey("w", { metaKey: true });
    expect(manager.isKeyPressed("w")).toBe(false);
  });

  it("function keys are ignored", () => {
    pressKey("F5");
    expect(manager.isKeyPressed("f5")).toBe(false);
  });

  it("blur clears all keys", () => {
    pressKey("w");
    pressKey("a");
    expect(manager.isKeyPressed("w")).toBe(true);
    window.dispatchEvent(new Event("blur"));
    expect(manager.isKeyPressed("w")).toBe(false);
    expect(manager.isKeyPressed("a")).toBe(false);
  });

  it("dispose clears listeners", () => {
    manager.dispose();
    pressKey("w");
    expect(manager.isKeyPressed("w")).toBe(false);
  });
});
