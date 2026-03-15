import { describe, expect, test, beforeEach } from "vitest";

import { ProgrammaticInputProvider } from "../src/ProgrammaticInputProvider";

describe("ProgrammaticInputProvider", () => {
  let provider: ProgrammaticInputProvider;

  beforeEach(() => {
    provider = new ProgrammaticInputProvider();
  });

  test("getOutput returns null when no direction is set", () => {
    expect(provider.getOutput()).toBeNull();
  });

  test("getOutput returns direction and sprint state when direction is set", () => {
    provider.setDirection(Math.PI / 4);
    const output = provider.getOutput();
    expect(output).not.toBeNull();
    expect(output!.direction).toBeCloseTo(Math.PI / 4);
    expect(output!.isSprinting).toBe(false);
    expect(output!.jump).toBe(false);
  });

  test("setSprinting controls sprint flag", () => {
    provider.setDirection(0);
    provider.setSprinting(true);
    expect(provider.getOutput()!.isSprinting).toBe(true);

    provider.setSprinting(false);
    expect(provider.getOutput()!.isSprinting).toBe(false);
  });

  test("clear resets direction and sprint", () => {
    provider.setDirection(1.5);
    provider.setSprinting(true);
    provider.clear();
    expect(provider.getOutput()).toBeNull();
  });

  test("setDirection to null stops movement", () => {
    provider.setDirection(0);
    expect(provider.getOutput()).not.toBeNull();
    provider.setDirection(null);
    expect(provider.getOutput()).toBeNull();
  });

  test("direction 0 is valid (not confused with null)", () => {
    provider.setDirection(0);
    const output = provider.getOutput();
    expect(output).not.toBeNull();
    expect(output!.direction).toBe(0);
  });
});
