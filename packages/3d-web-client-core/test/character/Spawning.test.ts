/**
 * @jest-environment jsdom
 */
import { getSpawnData } from "../../src/character/Spawning";
import { EulXYZ } from "../../src/math/EulXYZ";
import { Vect3 } from "../../src/math/Vect3";

describe("Spawning", () => {
  const baseConfig = {
    spawnPosition: { x: 0, y: 0, z: 0 },
    spawnPositionVariance: { x: 0, y: 0, z: 0 },
    spawnYRotation: 0,
    respawnTrigger: {
      minX: -1000,
      maxX: 1000,
      minY: -50,
      maxY: 1000,
      minZ: -1000,
      maxZ: 1000,
    },
    enableRespawnButton: false,
  };

  it("getSpawnData with zero variance returns exact position", () => {
    const result = getSpawnData(baseConfig);
    expect(result.spawnPosition).toBeInstanceOf(Vect3);
    expect(result.spawnPosition.x).toBe(0);
    expect(result.spawnPosition.y).toBe(0);
    expect(result.spawnPosition.z).toBe(0);
    expect(result.spawnRotation).toBeInstanceOf(EulXYZ);
  });

  it("getSpawnData with non-zero position", () => {
    const config = { ...baseConfig, spawnPosition: { x: 10, y: 5, z: -3 } };
    const result = getSpawnData(config);
    expect(result.spawnPosition.x).toBe(10);
    expect(result.spawnPosition.y).toBe(5);
    expect(result.spawnPosition.z).toBe(-3);
  });

  it("getSpawnData with spawnYRotation", () => {
    const config = { ...baseConfig, spawnYRotation: 90 };
    const result = getSpawnData(config);
    // spawnRotation.y = -90 * (π/180) = -π/2
    expect(result.spawnRotation.y).toBeCloseTo(-Math.PI / 2);
  });

  it("getSpawnData with variance produces values within range", () => {
    const config = {
      ...baseConfig,
      spawnPosition: { x: 10, y: 0, z: 10 },
      spawnPositionVariance: { x: 5, y: 0, z: 5 },
    };
    // Run multiple times to probabilistically confirm variance
    for (let i = 0; i < 10; i++) {
      const result = getSpawnData(config);
      expect(result.spawnPosition.x).toBeGreaterThanOrEqual(5);
      expect(result.spawnPosition.x).toBeLessThanOrEqual(15);
      expect(result.spawnPosition.z).toBeGreaterThanOrEqual(5);
      expect(result.spawnPosition.z).toBeLessThanOrEqual(15);
    }
  });

  it("getSpawnData returns a camera position", () => {
    const result = getSpawnData(baseConfig);
    expect(result.cameraPosition).toBeInstanceOf(Vect3);
    // Camera should be behind the character (offset in z direction)
    expect(result.cameraPosition).toBeDefined();
  });
});
