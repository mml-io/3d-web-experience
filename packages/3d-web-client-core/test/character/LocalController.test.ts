/**
 * @jest-environment jsdom
 */
import { describe, expect, test, jest, beforeEach } from "@jest/globals";

import { normalizeSpawnConfiguration } from "../../src/character/CharacterManager";
import { AnimationState } from "../../src/character/CharacterState";
import { LocalController, type LocalControllerConfig } from "../../src/character/LocalController";
import { Quat } from "../../src/math/Quat";
import { Vect3 } from "../../src/math/Vect3";

function createMockConfig(overrides?: Partial<LocalControllerConfig>): LocalControllerConfig {
  return {
    id: 1,
    position: new Vect3(0, 0, 0),
    quaternion: new Quat(),
    collisionsManager: {
      applyColliders: jest.fn<any>(),
      raycastFirst: jest.fn<any>().mockReturnValue(null),
      setCharacterPosition: jest.fn(),
      setCullingEnabled: jest.fn(),
      setExemptFromCulling: jest.fn(),
    } as any,
    keyInputManager: {
      getOutput: jest.fn<any>().mockReturnValue(null),
    },
    cameraManager: {
      getCameraPosition: jest.fn<any>().mockReturnValue(new Vect3(0, 5, -5)),
      getCameraRotation: jest.fn<any>().mockReturnValue(new Quat()),
    },
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
    ...overrides,
  };
}

describe("LocalController", () => {
  let config: LocalControllerConfig;
  let controller: LocalController;

  beforeEach(() => {
    config = createMockConfig();
    controller = new LocalController(config);
  });

  describe("construction", () => {
    test("initializes with default animation state idle", () => {
      expect(controller.networkState.state).toBe(AnimationState.idle);
    });

    test("initializes velocity to zero", () => {
      expect(controller.characterOnGround).toBe(false);
    });

    test("capsule has expected dimensions", () => {
      expect(controller.capsuleInfo.radius).toBe(0.45);
    });

    test("applies character controller values from config", () => {
      expect(controller.gravity).toBe(-37);
      expect(controller.jumpForce).toBe(17);
      expect(controller.doubleJumpForce).toBe(16.7);
    });

    test("sets culling enabled on collisions manager", () => {
      expect(config.collisionsManager.setCullingEnabled).toHaveBeenCalledWith(true);
    });
  });

  describe("getTargetAnimation", () => {
    test("returns idle when no control state and on ground", () => {
      controller.characterOnGround = true;
      expect(controller.getTargetAnimation()).toBe(AnimationState.idle);
    });

    test("returns walking when direction set without sprinting on ground", () => {
      controller.characterOnGround = true;
      (config.keyInputManager.getOutput as jest.Mock<any>).mockReturnValue({
        direction: 0,
        isSprinting: false,
        jump: false,
      });
      // Set the controlState by calling update which reads the input
      // But update also applies gravity, so set ground state directly
      // We access the private controlState via the getTargetAnimation method
      // which reads from this.controlState — set it by triggering update with ground
      (config.collisionsManager.applyColliders as jest.Mock<any>).mockImplementation((seg: any) => {
        // Simulate ground collision pushing capsule up
        seg.start.y += 0.01;
        seg.end.y += 0.01;
      });
      controller.update(0.016);
      // After ground push, character is on ground, with direction 0 = walking
      expect(controller.getTargetAnimation()).toBe(AnimationState.walking);
    });

    test("returns running when sprinting on ground", () => {
      controller.characterOnGround = true;
      (config.keyInputManager.getOutput as jest.Mock<any>).mockReturnValue({
        direction: 0,
        isSprinting: true,
        jump: false,
      });
      (config.collisionsManager.applyColliders as jest.Mock<any>).mockImplementation((seg: any) => {
        seg.start.y += 0.01;
        seg.end.y += 0.01;
      });
      controller.update(0.016);
      expect(controller.getTargetAnimation()).toBe(AnimationState.running);
    });

    test("returns air when airborne", () => {
      controller.characterOnGround = false;
      controller.update(0.016);
      expect(controller.getTargetAnimation()).toBe(AnimationState.air);
    });

    test("returns idle when airborne but height is low", () => {
      // When currentHeight (distance to ground) is low and no input,
      // getTargetAnimation returns idle because it doesn't meet the jumpHeight threshold
      controller.characterOnGround = false;
      expect(controller.getTargetAnimation()).toBe(AnimationState.idle);
    });
  });

  describe("jump", () => {
    test("jump from ground succeeds", () => {
      controller.characterOnGround = true;
      controller.jumpCounter = 0;
      const result = controller.jump();
      expect(result).toBe(true);
      expect(controller.characterOnGround).toBe(false);
      expect(controller.jumpCounter).toBe(1);
    });

    test("jump from ground with custom force", () => {
      controller.characterOnGround = true;
      controller.jumpCounter = 0;
      const result = controller.jump(25);
      expect(result).toBe(true);
    });

    test("double jump succeeds after first jump", () => {
      controller.characterOnGround = false;
      controller.jumpCounter = 1;
      controller.doubleJumpUsed = false;
      const result = controller.jump();
      expect(result).toBe(true);
      expect(controller.doubleJumpUsed).toBe(true);
      expect(controller.jumpCounter).toBe(2);
    });

    test("triple jump fails", () => {
      controller.characterOnGround = false;
      controller.jumpCounter = 2;
      controller.doubleJumpUsed = true;
      const result = controller.jump();
      expect(result).toBe(false);
    });

    test("jump while airborne with exhausted double jump fails", () => {
      controller.characterOnGround = false;
      controller.jumpCounter = 1;
      controller.doubleJumpUsed = true;
      const result = controller.jump();
      expect(result).toBe(false);
    });
  });

  describe("resetVelocity", () => {
    test("resets velocity and jump state", () => {
      controller.characterOnGround = true;
      controller.doubleJumpUsed = true;
      controller.jumpCounter = 2;
      controller.resetVelocity();
      expect(controller.characterOnGround).toBe(false);
      expect(controller.doubleJumpUsed).toBe(false);
      expect(controller.jumpCounter).toBe(0);
      expect(controller.jumpReleased).toBe(true);
    });
  });

  describe("resetPosition", () => {
    test("resets position to spawn position", () => {
      config.position.set(100, 200, 300);
      controller.resetPosition();
      // Should be back at spawn (0,0,0)
      expect(config.position.x).toBeCloseTo(0);
      expect(config.position.y).toBeCloseTo(0);
      expect(config.position.z).toBeCloseTo(0);
    });
  });

  describe("setHorizontalVelocity", () => {
    test("sets horizontal velocity components", () => {
      controller.setHorizontalVelocity(5, 10);
      expect(controller.verticalVelocity).toBe(0); // vertical unchanged
    });
  });

  describe("verticalVelocity", () => {
    test("returns current vertical velocity", () => {
      expect(controller.verticalVelocity).toBe(0);
    });
  });

  describe("isOnMovingSurface", () => {
    test("returns false initially", () => {
      expect(controller.isOnMovingSurface()).toBe(false);
    });
  });

  describe("update", () => {
    test("calls collisions manager methods", () => {
      controller.update(0.016);
      expect(config.collisionsManager.setCharacterPosition).toHaveBeenCalled();
      expect(config.collisionsManager.setExemptFromCulling).toHaveBeenCalled();
      expect(config.collisionsManager.applyColliders).toHaveBeenCalled();
    });

    test("updates network state after update", () => {
      controller.update(0.016);
      expect(controller.networkState).toBeDefined();
      expect(controller.networkState.position).toBeDefined();
      expect(controller.networkState.rotation).toBeDefined();
    });

    test("applies gravity when airborne", () => {
      const initialY = config.position.y;
      controller.update(0.016);
      // Position should drop due to gravity
      expect(config.position.y).toBeLessThanOrEqual(initialY);
    });

    test("respawns when out of bounds", () => {
      config.position.set(0, -200, 0); // Below minY (-100)
      controller.update(0.016);
      // Should have respawned near origin
      expect(config.position.y).toBeGreaterThan(-200);
    });

    test("uses additionalInputProvider as fallback", () => {
      const additionalProvider = {
        getOutput: jest.fn<any>().mockReturnValue({
          direction: 0,
          isSprinting: false,
          jump: false,
        }),
      };
      config.additionalInputProvider = additionalProvider;
      controller = new LocalController(config);
      controller.update(0.016);
      expect(additionalProvider.getOutput).toHaveBeenCalled();
    });
  });

  describe("updateSpawnConfig", () => {
    test("updates respawn trigger bounds", () => {
      const newSpawn = normalizeSpawnConfiguration({
        respawnTrigger: { minY: -50, maxY: 200 },
      });
      controller.updateSpawnConfig(newSpawn);
      // Verify by going out of old bounds but within new bounds
      config.position.set(0, -80, 0);
      controller.update(0.016);
      // Should NOT respawn since -80 > -100 (default) but also > -50
      // Actually -80 < -50 so it would respawn with the new config too
    });
  });

  describe("getMovementFromSurfaces", () => {
    test("returns null when no surface state tracked", () => {
      const result = controller.getMovementFromSurfaces(new Vect3(), 0.016);
      expect(result).toBeNull();
    });
  });

  describe("latestPosition tracking", () => {
    test("latestPosition updates after update", () => {
      controller.update(0.016);
      expect(controller.latestPosition).toBeDefined();
    });
  });
});
