/**
 * @jest-environment jsdom
 */
import { jest, describe, expect, test, beforeEach } from "@jest/globals";

import {
  normalizeSpawnConfiguration,
  type CharacterManagerConfig,
  type SpawnConfiguration,
} from "../../src/character/CharacterManager";
import { AnimationState, type CharacterState } from "../../src/character/CharacterState";
import { EulXYZ } from "../../src/math/EulXYZ";
import { Vect3 } from "../../src/math/Vect3";

// ── normalizeSpawnConfiguration ──────────────────────────────────────────

describe("normalizeSpawnConfiguration", () => {
  test("returns full defaults when called with undefined", () => {
    const result = normalizeSpawnConfiguration();
    expect(result.spawnPosition).toEqual({ x: 0, y: 0, z: 0 });
    expect(result.spawnPositionVariance).toEqual({ x: 0, y: 0, z: 0 });
    expect(result.spawnYRotation).toBe(0);
    expect(result.respawnTrigger.minY).toBe(-100);
    expect(result.respawnTrigger.maxY).toBe(Number.POSITIVE_INFINITY);
    expect(result.respawnTrigger.minX).toBe(Number.NEGATIVE_INFINITY);
    expect(result.enableRespawnButton).toBe(false);
  });

  test("returns full defaults when called with empty object", () => {
    const result = normalizeSpawnConfiguration({});
    expect(result.spawnPosition).toEqual({ x: 0, y: 0, z: 0 });
  });

  test("preserves provided values", () => {
    const config: SpawnConfiguration = {
      spawnPosition: { x: 10, y: 5, z: -3 },
      spawnYRotation: 90,
      enableRespawnButton: true,
    };
    const result = normalizeSpawnConfiguration(config);
    expect(result.spawnPosition).toEqual({ x: 10, y: 5, z: -3 });
    expect(result.spawnYRotation).toBe(90);
    expect(result.enableRespawnButton).toBe(true);
  });

  test("fills in partial spawnPosition", () => {
    const result = normalizeSpawnConfiguration({ spawnPosition: { y: 5 } });
    expect(result.spawnPosition).toEqual({ x: 0, y: 5, z: 0 });
  });

  test("fills in partial respawnTrigger", () => {
    const result = normalizeSpawnConfiguration({ respawnTrigger: { minY: -50 } });
    expect(result.respawnTrigger.minY).toBe(-50);
    expect(result.respawnTrigger.maxY).toBe(Number.POSITIVE_INFINITY);
    expect(result.respawnTrigger.minX).toBe(Number.NEGATIVE_INFINITY);
  });
});

// ── CharacterManager ─────────────────────────────────────────────────────

// Minimal mock for LocalController's dependencies
jest.unstable_mockModule("@mml-io/mml-web", () => ({
  radToDeg: (rad: number) => (rad * 180) / Math.PI,
}));

const { CharacterManager: CharacterManagerReloaded } =
  await import("../../src/character/CharacterManager");

function createMockConfig(overrides?: Partial<CharacterManagerConfig>): CharacterManagerConfig {
  return {
    collisionsManager: {
      applyColliders: jest.fn<any>().mockReturnValue({ onGround: true }),
      raycastFirst: jest.fn<any>().mockReturnValue(null),
      setCharacterPosition: jest.fn(),
      setCullingEnabled: jest.fn(),
      setExemptFromCulling: jest.fn(),
    } as any,
    cameraManager: {
      setTarget: jest.fn(),
      getCameraState: jest.fn<any>().mockReturnValue({
        position: new Vect3(),
        rotation: { x: 0, y: 0, z: 0, w: 1 },
      }),
      hasActiveInput: jest.fn<any>().mockReturnValue(false),
    } as any,
    keyInputManager: {
      isMovementKeyPressed: jest.fn<any>().mockReturnValue(false),
      getOutput: jest.fn<any>().mockReturnValue(null),
    } as any,
    remoteUserStates: new Map<number, CharacterState>(),
    sendUpdate: jest.fn(),
    sendLocalCharacterColors: jest.fn(),
    spawnConfiguration: normalizeSpawnConfiguration(),
    characterControllerValues: {
      gravity: 37,
      jumpForce: 17,
      doubleJumpForce: 16.7,
      coyoteJump: 120,
      airResistance: 0.5,
      groundResistance: 0,
      airControlModifier: 0.05,
      groundWalkControl: 0.625,
      groundRunControl: 0.8,
      baseControlMultiplier: 1,
      minimumSurfaceAngle: 0.6,
    },
    characterResolve: jest.fn<any>().mockReturnValue({
      username: "TestUser",
      characterDescription: null,
      colors: null,
    }),
    ...overrides,
  };
}

describe("CharacterManager", () => {
  let config: CharacterManagerConfig;
  let manager: InstanceType<typeof CharacterManagerReloaded>;

  beforeEach(() => {
    config = createMockConfig();
    manager = new CharacterManagerReloaded(config);
  });

  test("starts with no local controller", () => {
    expect(manager.localController).toBeNull();
    expect(manager.getLocalConnectionId()).toBe(0);
  });

  test("setLocalConnectionId prevents self from spawning as remote", () => {
    manager.setLocalConnectionId(42);
    expect(manager.getLocalConnectionId()).toBe(42);
  });

  test("spawnLocalCharacter creates local controller", () => {
    manager.spawnLocalCharacter(1, new Vect3(5, 10, 15));
    expect(manager.localController).not.toBeNull();
    expect(manager.getLocalConnectionId()).toBe(1);
  });

  test("spawnLocalCharacter sends initial update", () => {
    manager.spawnLocalCharacter(1, new Vect3(5, 10, 15));
    expect(config.sendUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        position: { x: 5, y: 10, z: 15 },
        state: AnimationState.idle,
      }),
    );
  });

  test("getAllCharacterStates includes local character after spawn", () => {
    manager.spawnLocalCharacter(1);
    const states = manager.getAllCharacterStates();
    expect(states.has(1)).toBe(true);
    const local = states.get(1)!;
    expect(local.isLocal).toBe(true);
    expect(local.username).toBe("TestUser");
  });

  test("update creates remote characters from remoteUserStates", () => {
    manager.setLocalConnectionId(1);
    config.remoteUserStates.set(2, {
      position: { x: 10, y: 0, z: 0 },
      rotation: { eulerY: 0 },
      state: AnimationState.idle,
    });
    manager.update(0.016, 0);
    expect(manager.remoteCharacters.has(2)).toBe(true);
    const states = manager.getAllCharacterStates();
    expect(states.has(2)).toBe(true);
    expect(states.get(2)!.isLocal).toBe(false);
  });

  test("update skips local client ID from remote states", () => {
    manager.spawnLocalCharacter(1);
    config.remoteUserStates.set(1, {
      position: { x: 99, y: 0, z: 0 },
      rotation: { eulerY: 0 },
      state: AnimationState.idle,
    });
    manager.update(0.016, 0);
    expect(manager.remoteCharacters.has(1)).toBe(false);
  });

  test("update detects despawned remote characters", () => {
    manager.setLocalConnectionId(1);
    config.remoteUserStates.set(2, {
      position: { x: 0, y: 0, z: 0 },
      rotation: { eulerY: 0 },
      state: AnimationState.idle,
    });
    manager.update(0.016, 0);
    expect(manager.remoteCharacters.has(2)).toBe(true);

    config.remoteUserStates.delete(2);
    const result = manager.update(0.016, 1);
    expect(result.removedConnectionIds).toContain(2);
    expect(manager.remoteCharacters.has(2)).toBe(false);
  });

  test("networkCharacterInfoUpdated marks remote character for description update", () => {
    manager.setLocalConnectionId(1);
    config.remoteUserStates.set(2, {
      position: { x: 0, y: 0, z: 0 },
      rotation: { eulerY: 0 },
      state: AnimationState.idle,
    });
    manager.update(0.016, 0);

    // Change the resolved info
    (config.characterResolve as jest.Mock<any>).mockReturnValue({
      username: "NewName",
      characterDescription: null,
      colors: null,
    });
    manager.networkCharacterInfoUpdated(2);

    const result = manager.update(0.016, 1);
    expect(result.updatedCharacterDescriptions).toContain(2);
  });

  test("networkCharacterInfoUpdated updates local character renderState", () => {
    manager.spawnLocalCharacter(1);
    (config.characterResolve as jest.Mock<any>).mockReturnValue({
      username: "UpdatedLocal",
      characterDescription: null,
      colors: null,
    });
    manager.networkCharacterInfoUpdated(1);
    const result = manager.update(0.016, 0);
    expect(result.updatedCharacterDescriptions).toContain(1);
  });

  test("clear marks all characters for removal", () => {
    manager.spawnLocalCharacter(1);
    config.remoteUserStates.set(2, {
      position: { x: 0, y: 0, z: 0 },
      rotation: { eulerY: 0 },
      state: AnimationState.idle,
    });
    manager.update(0.016, 0);

    manager.clear();
    expect(manager.remoteCharacters.size).toBe(0);
    expect(manager.localController).toBeNull();

    const result = manager.update(0.016, 1);
    expect(result.removedConnectionIds).toContain(1);
    expect(result.removedConnectionIds).toContain(2);
  });

  test("dispose clears everything", () => {
    manager.spawnLocalCharacter(1);
    manager.dispose();
    expect(manager.localController).toBeNull();
    expect(manager.remoteCharacters.size).toBe(0);
  });

  test("getLocalCharacterPositionAndRotation returns zero when no local controller", () => {
    const posAndRot = manager.getLocalCharacterPositionAndRotation();
    expect(posAndRot.position).toEqual({ x: 0, y: 0, z: 0 });
    expect(posAndRot.rotation).toEqual({ x: 0, y: 0, z: 0 });
  });

  test("getLocalCharacterPositionAndRotation returns position after spawn", () => {
    manager.spawnLocalCharacter(1, new Vect3(5, 10, 15));
    const posAndRot = manager.getLocalCharacterPositionAndRotation();
    expect(posAndRot.position.x).toBeCloseTo(5);
    expect(posAndRot.position.y).toBeCloseTo(10);
    expect(posAndRot.position.z).toBeCloseTo(15);
  });

  test("headTargetOffset is at head height", () => {
    expect(CharacterManagerReloaded.headTargetOffset.y).toBe(1.75);
  });

  test("update returns empty arrays when no changes", () => {
    const result = manager.update(0.016, 0);
    expect(result.updatedCharacterDescriptions).toEqual([]);
    expect(result.removedConnectionIds).toEqual([]);
  });

  test("remote character defaults to Unknown User when no username", () => {
    (config.characterResolve as jest.Mock<any>).mockReturnValue({
      username: null,
      characterDescription: null,
      colors: null,
    });
    manager.setLocalConnectionId(1);
    config.remoteUserStates.set(5, {
      position: { x: 0, y: 0, z: 0 },
      rotation: { eulerY: 0 },
      state: AnimationState.idle,
    });
    manager.update(0.016, 0);
    const states = manager.getAllCharacterStates();
    expect(states.get(5)!.username).toBe("Unknown User 5");
  });
});
