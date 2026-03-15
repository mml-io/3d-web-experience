import { describe, expect, test, beforeEach } from "vitest";

import { HeadlessCameraManager } from "../src/HeadlessCameraManager";

describe("HeadlessCameraManager", () => {
  let camera: HeadlessCameraManager;

  beforeEach(() => {
    camera = new HeadlessCameraManager();
  });

  test("initial camera position is behind and above origin", () => {
    const pos = camera.getCameraPosition();
    expect(pos.x).toBe(0);
    expect(pos.y).toBeCloseTo(1.55);
    expect(pos.z).toBe(5);
  });

  test("initial camera rotation is identity quaternion", () => {
    const rot = camera.getCameraRotation();
    expect(rot.x).toBe(0);
    expect(rot.y).toBe(0);
    expect(rot.z).toBe(0);
    expect(rot.w).toBe(1);
  });

  test("setCharacterPosition updates camera to track character", () => {
    camera.setCharacterPosition({ x: 10, y: 2, z: -5 });
    const pos = camera.getCameraPosition();
    expect(pos.x).toBe(10);
    expect(pos.y).toBeCloseTo(3.55); // y + 1.55
    expect(pos.z).toBe(0); // z + 5
  });

  test("camera stays 5 units behind on +Z axis", () => {
    camera.setCharacterPosition({ x: 0, y: 0, z: 0 });
    const pos = camera.getCameraPosition();
    expect(pos.z - 0).toBe(5); // 5 units behind character
  });

  test("getCameraRotation remains identity after position update", () => {
    camera.setCharacterPosition({ x: 100, y: 50, z: -30 });
    const rot = camera.getCameraRotation();
    expect(rot.x).toBe(0);
    expect(rot.y).toBe(0);
    expect(rot.z).toBe(0);
    expect(rot.w).toBe(1);
  });
});
