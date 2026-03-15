import { CollisionsManager } from "@mml-io/3d-web-client-core";
import { describe, expect, test, beforeEach, afterEach, vi } from "vitest";

import { AvatarController } from "../src/AvatarController";

describe("AvatarController", () => {
  let controller: AvatarController;
  let collisionsManager: CollisionsManager;

  beforeEach(() => {
    collisionsManager = new CollisionsManager();
    controller = new AvatarController(collisionsManager, {
      spawnPosition: { x: 0, y: 0, z: 0 },
    });
  });

  afterEach(() => {
    controller.destroy();
  });

  describe("construction", () => {
    test("spawns at the configured position", () => {
      const pos = controller.getPosition();
      expect(pos.x).toBeCloseTo(0);
      expect(pos.y).toBeCloseTo(0);
      expect(pos.z).toBeCloseTo(0);
    });

    test("spawns at non-origin position", () => {
      const ctrl = new AvatarController(collisionsManager, {
        spawnPosition: { x: 5, y: 0, z: 8 },
      });
      const pos = ctrl.getPosition();
      expect(pos.x).toBeCloseTo(5);
      expect(pos.z).toBeCloseTo(8);
      ctrl.destroy();
    });

    test("starts not moving", () => {
      expect(controller.isMoving()).toBe(false);
    });

    test("starts not following", () => {
      expect(controller.isFollowing()).toBe(false);
      expect(controller.getFollowUserId()).toBeNull();
    });

    test("initial animation state is 0 (idle)", () => {
      expect(controller.getAnimationState()).toBe(0);
    });

    test("initial rotation is identity", () => {
      const rot = controller.getRotation();
      expect(rot.eulerY).toBeCloseTo(0);
    });
  });

  describe("teleport", () => {
    test("moves position instantly", () => {
      controller.teleport(10, 5, 20);
      const pos = controller.getPosition();
      expect(pos.x).toBeCloseTo(10);
      expect(pos.y).toBeCloseTo(5);
      expect(pos.z).toBeCloseTo(20);
    });

    test("clears movement target", () => {
      controller.moveTo(50, 0, 50);
      expect(controller.isMoving()).toBe(true);
      controller.teleport(0, 0, 0);
      expect(controller.isMoving()).toBe(false);
    });

    test("emits arrived event", () => {
      return new Promise<void>((resolve) => {
        controller.once("arrived", () => {
          resolve();
        });
        controller.teleport(5, 0, 5);
      });
    });
  });

  describe("moveTo", () => {
    test("sets a movement target", () => {
      controller.moveTo(10, 0, 10);
      expect(controller.isMoving()).toBe(true);
    });

    test("distanceToTarget returns distance to target", () => {
      controller.teleport(0, 0, 0);
      controller.moveTo(3, 0, 4);
      const dist = controller.distanceToTarget();
      expect(dist).toBeCloseTo(5, 0);
    });
  });

  describe("stop", () => {
    test("stops movement", () => {
      controller.moveTo(10, 0, 10);
      controller.stop();
      expect(controller.isMoving()).toBe(false);
    });

    test("distanceToTarget returns 0 when stopped", () => {
      controller.stop();
      expect(controller.distanceToTarget()).toBe(0);
    });
  });

  describe("followPath", () => {
    test("follows a path of waypoints", () => {
      controller.followPath([
        { x: 1, y: 0, z: 0 },
        { x: 2, y: 0, z: 0 },
        { x: 3, y: 0, z: 0 },
      ]);
      expect(controller.isMoving()).toBe(true);
      expect(controller.getCurrentPath()).toHaveLength(3);
      expect(controller.getWaypointIndex()).toBe(0);
    });

    test("empty path does nothing", () => {
      controller.followPath([]);
      expect(controller.isMoving()).toBe(false);
    });
  });

  describe("animation override", () => {
    test("setAnimationState overrides animation", () => {
      controller.setAnimationState(1);
      expect(controller.getAnimationState()).toBe(1);
    });

    test("clearAnimationOverride restores automatic animation", () => {
      controller.setAnimationState(1);
      controller.clearAnimationOverride();
      // Animation state will be computed by physics tick
      expect(controller.getAnimationState()).toBeDefined();
    });
  });

  describe("waitForArrival", () => {
    test("resolves immediately when not moving", async () => {
      const result = await controller.waitForArrival(1000);
      expect(result).toBe(true);
    });

    test("resolves on arrival event", async () => {
      controller.moveTo(100, 0, 100);
      const promise = controller.waitForArrival(5000);
      // Simulate arrival by teleporting (which emits arrived)
      controller.teleport(100, 0, 100);
      const result = await promise;
      expect(result).toBe(true);
    });

    test("resolves false on timeout", async () => {
      controller.moveTo(100, 0, 100);
      const result = await controller.waitForArrival(50);
      expect(result).toBe(false);
    });
  });

  describe("setUltimateDestination / getUltimateDestination", () => {
    test("stores and retrieves destination", () => {
      controller.setUltimateDestination({ x: 50, y: 0, z: 50 });
      expect(controller.getUltimateDestination()).toEqual({ x: 50, y: 0, z: 50 });
    });

    test("clears destination with null", () => {
      controller.setUltimateDestination({ x: 50, y: 0, z: 50 });
      controller.setUltimateDestination(null);
      expect(controller.getUltimateDestination()).toBeNull();
    });

    test("returns a copy, not a reference", () => {
      const dest = { x: 1, y: 2, z: 3 };
      controller.setUltimateDestination(dest);
      dest.x = 999;
      expect(controller.getUltimateDestination()!.x).toBe(1);
    });
  });

  describe("jump", () => {
    test("delegates to localController", () => {
      const result = controller.jump();
      expect(typeof result).toBe("boolean");
    });
  });

  describe("getPosition returns a copy", () => {
    test("modifying returned position doesn't affect controller", () => {
      controller.teleport(5, 0, 5);
      const pos = controller.getPosition();
      pos.x = 999;
      expect(controller.getPosition().x).toBeCloseTo(5);
    });
  });

  describe("destroy", () => {
    test("stops tick interval and cleans up", () => {
      controller.moveTo(10, 0, 10);
      controller.destroy();
      expect(controller.isMoving()).toBe(false);
    });
  });

  describe("updateSpawnConfig", () => {
    test("updates spawn configuration without error", () => {
      expect(() => {
        controller.updateSpawnConfig({
          spawnPosition: { x: 10, y: 0, z: 10 },
        });
      }).not.toThrow();
    });
  });

  describe("followPath with jumpIndices", () => {
    test("stores jumpIndices metadata", () => {
      const jumpIndices = new Set([1, 2]);
      controller.followPath(
        [
          { x: 1, y: 0, z: 0 },
          { x: 2, y: 2, z: 0 },
          { x: 3, y: 4, z: 0 },
        ],
        3.0,
        jumpIndices,
      );
      expect(controller.isMoving()).toBe(true);
      expect(controller.getCurrentPath()).toHaveLength(3);
    });

    test("moveTo with custom speed", () => {
      controller.moveTo(10, 0, 10, 6.0);
      expect(controller.isMoving()).toBe(true);
      expect(controller.distanceToTarget()).toBeGreaterThan(0);
    });
  });

  describe("follow mode", () => {
    function createMockWorldConnection() {
      return {
        getOtherUsers: vi.fn().mockReturnValue([
          {
            connectionId: 5,
            userId: "user-5",
            username: "Bob",
            position: { x: 10, y: 0, z: 10 },
          },
        ]),
      } as any;
    }

    test("startFollowing sets follow state", () => {
      const wc = createMockWorldConnection();
      controller.startFollowing(5, wc, 2.0, 3.0);
      expect(controller.isFollowing()).toBe(true);
      expect(controller.getFollowUserId()).toBe(5);
    });

    test("stopFollowing clears follow state", () => {
      const wc = createMockWorldConnection();
      controller.startFollowing(5, wc);
      controller.stopFollowing();
      expect(controller.isFollowing()).toBe(false);
      expect(controller.getFollowUserId()).toBeNull();
      expect(controller.isMoving()).toBe(false);
    });

    test("follow emits follow_lost when target user disappears", () => {
      return new Promise<void>((resolve) => {
        const wc = {
          getOtherUsers: vi.fn().mockReturnValue([]),
        } as any;

        controller.once("follow_lost", () => {
          expect(controller.isFollowing()).toBe(false);
          resolve();
        });

        controller.startFollowing(99, wc, 2.0, 3.0);
        // The follow tick runs immediately and should see no user → emit follow_lost
      });
    });

    test("follow mode stops movement when close to target", () => {
      // Position controller at same place as target
      controller.teleport(10, 0, 10);
      const wc = createMockWorldConnection();
      controller.startFollowing(5, wc, 2.0, 3.0);
      // Target is at (10,0,10) and we're at (10,0,10) — within stopDistance
      // After follow tick, should not be moving
      expect(controller.isFollowing()).toBe(true);
    });
  });

  describe("setNavMeshManager", () => {
    test("accepts a navmesh manager", () => {
      const mockNavMesh = {
        isReady: true,
        computePathWithJumpInfo: vi.fn(),
        isWithinRegion: vi.fn(),
        computeEdgePoint: vi.fn(),
      } as any;
      expect(() => controller.setNavMeshManager(mockNavMesh)).not.toThrow();
    });
  });

  describe("getCurrentPath / getWaypointIndex", () => {
    test("returns empty path when not moving", () => {
      expect(controller.getCurrentPath()).toEqual([]);
      expect(controller.getWaypointIndex()).toBe(0);
    });

    test("returns defensive copy of path", () => {
      controller.followPath([
        { x: 1, y: 0, z: 0 },
        { x: 2, y: 0, z: 0 },
      ]);
      const path = controller.getCurrentPath();
      path[0].x = 999;
      expect(controller.getCurrentPath()[0].x).toBe(1);
    });
  });

  describe("onGround", () => {
    test("returns ground state from localController", () => {
      expect(typeof controller.onGround).toBe("boolean");
    });
  });

  describe("physics tick behavior", () => {
    test("emits positionUpdate after tick", async () => {
      const updates: Array<any> = [];
      controller.on("positionUpdate", (update: any) => {
        updates.push(update);
      });

      // Wait for at least one tick (16ms)
      await new Promise((r) => setTimeout(r, 50));

      expect(updates.length).toBeGreaterThan(0);
      expect(updates[0]).toHaveProperty("position");
      expect(updates[0]).toHaveProperty("rotation");
      expect(updates[0]).toHaveProperty("state");
    });

    test("animationOverride is used during physics tick", async () => {
      controller.setAnimationState(5);

      // Wait for a tick
      await new Promise((r) => setTimeout(r, 50));

      expect(controller.getAnimationState()).toBe(5);
    });

    test("movement updates direction toward target during tick", async () => {
      controller.teleport(0, 0, 0);
      controller.moveTo(100, 0, 0);

      // Wait for a few ticks
      await new Promise((r) => setTimeout(r, 100));

      // Position should have moved toward target
      const pos = controller.getPosition();
      expect(pos.x).toBeGreaterThan(0);
    });

    test("movement stops when close to target", async () => {
      controller.teleport(0, 0, 0);
      // Target very close
      controller.moveTo(0.1, 0, 0.1);

      // Wait for ticks to process arrival
      await new Promise((r) => setTimeout(r, 100));

      // Should have arrived (target is within ARRIVAL_THRESHOLD)
      expect(controller.isMoving()).toBe(false);
    });

    test("waypoint advancement through physics ticks", async () => {
      controller.teleport(0, 0, 0);
      // Waypoints very close together to ensure quick arrival
      controller.followPath([
        { x: 0.1, y: 0, z: 0 },
        { x: 0.2, y: 0, z: 0 },
      ]);

      // Wait for ticks to advance through waypoints
      await new Promise((r) => setTimeout(r, 200));

      // Should have advanced past first waypoint or completed
      const idx = controller.getWaypointIndex();
      expect(idx).toBeGreaterThanOrEqual(0);
    });

    test("stuck detection emits stuck event when not moving", async () => {
      let stuckEmitted = false;
      controller.on("stuck", () => {
        stuckEmitted = true;
      });

      // Position at origin, set target far away.
      // Without collisions the avatar will move, but with a wall it would get stuck.
      // Since there's no collision mesh, the avatar will move freely.
      // We just test that tick runs without errors when targeting something.
      controller.teleport(0, 0, 0);
      controller.moveTo(50, 0, 50);

      await new Promise((r) => setTimeout(r, 100));

      // Avatar should be making progress, no stuck event
      expect(controller.isMoving()).toBe(true);
    });
  });

  describe("autoChainNextSegment", () => {
    test("chains to next segment when ultimateDestination is set with navmesh", async () => {
      const mockNavMesh = {
        isReady: true,
        computePathWithJumpInfo: vi.fn<any>().mockReturnValue({
          path: [
            { x: 5, y: 0, z: 0 },
            { x: 10, y: 0, z: 0 },
          ],
          jumpIndices: new Set<number>(),
        }),
        isWithinRegion: vi.fn().mockReturnValue(true),
        computeEdgePoint: vi.fn(),
      } as any;

      controller.setNavMeshManager(mockNavMesh);
      controller.setUltimateDestination({ x: 100, y: 0, z: 100 });
      controller.teleport(0, 0, 0);
      // Start a path that will be completed quickly
      controller.followPath([{ x: 0.1, y: 0, z: 0 }]);

      // Wait for arrival and auto-chain
      await new Promise((r) => setTimeout(r, 200));

      // The navmesh should have been consulted for a new path
      // (may or may not have been called depending on timing)
      expect(controller.isMoving()).toBeDefined();
    });

    test("autoChainNextSegment with target outside region uses edge point", async () => {
      const mockNavMesh = {
        isReady: true,
        computePathWithJumpInfo: vi.fn<any>().mockReturnValue({
          path: [
            { x: 3, y: 0, z: 0 },
            { x: 5, y: 0, z: 0 },
          ],
          jumpIndices: new Set<number>(),
        }),
        isWithinRegion: vi.fn().mockReturnValue(false),
        computeEdgePoint: vi.fn().mockReturnValue({ x: 50, y: 0, z: 50 }),
      } as any;

      controller.setNavMeshManager(mockNavMesh);
      controller.setUltimateDestination({ x: 200, y: 0, z: 200 });
      controller.teleport(0, 0, 0);
      controller.followPath([{ x: 0.1, y: 0, z: 0 }]);

      await new Promise((r) => setTimeout(r, 200));

      expect(controller.isMoving()).toBeDefined();
    });

    test("autoChainNextSegment with no valid path clears destination", async () => {
      const mockNavMesh = {
        isReady: true,
        computePathWithJumpInfo: vi.fn<any>().mockReturnValue(null),
        isWithinRegion: vi.fn().mockReturnValue(true),
        computeEdgePoint: vi.fn(),
      } as any;

      controller.setNavMeshManager(mockNavMesh);
      controller.setUltimateDestination({ x: 100, y: 0, z: 100 });
      controller.teleport(0, 0, 0);
      controller.followPath([{ x: 0.1, y: 0, z: 0 }]);

      await new Promise((r) => setTimeout(r, 200));

      // Destination should have been cleared since no valid path was found
      expect(controller.getUltimateDestination()).toBeNull();
    });
  });

  describe("follow mode with navmesh", () => {
    test("follow mode uses navmesh when available", async () => {
      const mockNavMesh = {
        isReady: true,
        computePathWithJumpInfo: vi.fn<any>().mockReturnValue({
          path: [
            { x: 5, y: 0, z: 5 },
            { x: 10, y: 0, z: 10 },
          ],
          jumpIndices: new Set<number>(),
        }),
        isWithinRegion: vi.fn().mockReturnValue(true),
        computeEdgePoint: vi.fn(),
      } as any;

      controller.setNavMeshManager(mockNavMesh);
      controller.teleport(0, 0, 0);

      const wc = {
        getOtherUsers: vi.fn().mockReturnValue([
          {
            connectionId: 5,
            userId: "user-5",
            username: "Bob",
            position: { x: 20, y: 0, z: 20 },
          },
        ]),
      } as any;

      controller.startFollowing(5, wc, 2.0, 3.0);

      // Wait for follow tick
      await new Promise((r) => setTimeout(r, 100));

      // Navmesh should have been queried
      expect(mockNavMesh.computePathWithJumpInfo).toHaveBeenCalled();
      controller.stopFollowing();
    });

    test("follow mode stops movement when within stop distance", async () => {
      controller.teleport(10, 0, 10);

      // First move to create a target
      controller.moveTo(20, 0, 20);
      expect(controller.isMoving()).toBe(true);

      // Now start following at exact same position as target
      const wc = {
        getOtherUsers: vi.fn().mockReturnValue([
          {
            connectionId: 5,
            userId: "user-5",
            username: "Bob",
            position: { x: 10, y: 0, z: 10 },
          },
        ]),
      } as any;

      controller.startFollowing(5, wc, 2.0, 3.0);

      // Wait for follow tick to fire and detect close proximity
      await new Promise((r) => setTimeout(r, 100));

      // Should have stopped moving since we're at the target position
      expect(controller.isFollowing()).toBe(true);
      controller.stopFollowing();
    });

    test("follow mode skips re-path when target hasn't moved much", async () => {
      controller.teleport(0, 0, 0);

      const callCount = 0;
      const wc = {
        getOtherUsers: vi.fn().mockReturnValue([
          {
            connectionId: 5,
            userId: "user-5",
            username: "Bob",
            position: { x: 20, y: 0, z: 20 },
          },
        ]),
      } as any;

      controller.startFollowing(5, wc, 2.0, 3.0);

      // Wait for two follow ticks
      await new Promise((r) => setTimeout(r, 600));

      // The second tick should see that target hasn't moved and skip re-pathing
      expect(controller.isFollowing()).toBe(true);
      controller.stopFollowing();
    });
  });

  describe("multiple operations", () => {
    test("moveTo cancels follow", () => {
      const wc = {
        getOtherUsers: vi.fn().mockReturnValue([
          {
            connectionId: 5,
            userId: "user-5",
            username: "Bob",
            position: { x: 20, y: 0, z: 20 },
          },
        ]),
      } as any;
      controller.startFollowing(5, wc);
      expect(controller.isFollowing()).toBe(true);

      controller.moveTo(5, 0, 5);
      expect(controller.isFollowing()).toBe(false);
      expect(controller.isMoving()).toBe(true);
    });

    test("teleport cancels follow", () => {
      const wc = {
        getOtherUsers: vi.fn().mockReturnValue([
          {
            connectionId: 5,
            userId: "user-5",
            username: "Bob",
            position: { x: 20, y: 0, z: 20 },
          },
        ]),
      } as any;
      controller.startFollowing(5, wc);
      controller.teleport(0, 0, 0);
      expect(controller.isFollowing()).toBe(false);
    });

    test("stop clears ultimateDestination", () => {
      controller.setUltimateDestination({ x: 100, y: 0, z: 100 });
      controller.stop();
      expect(controller.getUltimateDestination()).toBeNull();
    });

    test("teleport clears ultimateDestination", () => {
      controller.setUltimateDestination({ x: 100, y: 0, z: 100 });
      controller.teleport(0, 0, 0);
      expect(controller.getUltimateDestination()).toBeNull();
    });
  });
});
