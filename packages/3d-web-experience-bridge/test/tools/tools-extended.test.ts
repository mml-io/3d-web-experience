/**
 * Extended tests for tool execute() functions — covers edge cases and branches
 * not hit by the basic tools.test.ts:
 *
 * - observe: proximity, scene_changed, stuck, navmesh_ready, deferred arrival, batching
 * - get_scene_info: filterAndSort with avatarPos, include_geometry, label distance
 * - navigate_to: navmesh not ready timeout
 * - set_character_description: mml_character_url, mml_character_string
 */
import { afterEach, describe, expect, test, vi } from "vitest";

import getSceneInfo from "../../src/tools/get-scene-info";
import navigateTo from "../../src/tools/navigate-to";
import observe from "../../src/tools/observe";
import setCharacterDescription from "../../src/tools/set-character-description";

import { createMockContext, parseResult } from "./mock-context";

describe("observe — proximity trigger", () => {
  test("fires when a new user enters proximity threshold", async () => {
    vi.useFakeTimers();
    const ctx = createMockContext();
    ctx.worldConnection.getChatHistory.mockReturnValue([]);
    ctx.avatarController.isMoving.mockReturnValue(false);

    // Initially no users nearby
    let otherUsers: any[] = [];
    ctx.worldConnection.getOtherUsers.mockImplementation(() => otherUsers);
    ctx.avatarController.getPosition.mockReturnValue({ x: 0, y: 0, z: 0 });

    const promise = observe.execute({ timeout_seconds: 10, proximity_distance: 5 }, ctx);

    // Simulate a user appearing nearby after 600ms
    vi.advanceTimersByTime(600);
    otherUsers = [
      {
        connectionId: 42,
        userId: "user-42",
        username: "NearbyUser",
        position: { x: 3, y: 0, z: 0 },
      },
    ];

    // Wait for proximity check interval
    vi.advanceTimersByTime(500);

    const result = parseResult(await promise);
    expect(result.trigger).toBe("proximity");
    expect(result.events[0].type).toBe("proximity");
    expect(result.events[0].name).toBe("NearbyUser");

    vi.useRealTimers();
  });

  test("does not fire for users already nearby at start", async () => {
    vi.useFakeTimers();
    const ctx = createMockContext();
    ctx.worldConnection.getChatHistory.mockReturnValue([]);
    ctx.avatarController.isMoving.mockReturnValue(false);

    // User already nearby when wait starts
    ctx.worldConnection.getOtherUsers.mockReturnValue([
      {
        connectionId: 42,
        userId: "user-42",
        username: "ExistingUser",
        position: { x: 3, y: 0, z: 0 },
      },
    ]);
    ctx.avatarController.getPosition.mockReturnValue({ x: 0, y: 0, z: 0 });

    const promise = observe.execute({ timeout_seconds: 1, proximity_distance: 5 }, ctx);

    // Advance past proximity checks
    vi.advanceTimersByTime(1100);

    const result = parseResult(await promise);
    // Should timeout because the user was already nearby
    expect(result.trigger).toBe("timeout");

    vi.useRealTimers();
  });
});

describe("observe — scene_changed trigger", () => {
  test("fires on scene change with nearby labels (no clickables/interactions)", async () => {
    const ctx = createMockContext();
    ctx.worldConnection.getChatHistory.mockReturnValue([]);
    ctx.avatarController.isMoving.mockReturnValue(false);
    ctx.avatarController.getPosition.mockReturnValue({ x: 0, y: 0, z: 0 });

    // Set up scene mock data
    ctx.headlessScene!.getLabelElements.mockReturnValue([
      {
        nodeId: 1,
        position: { x: 1, y: 0, z: 0 },
        attributes: { content: "Hello World" },
      },
    ]);

    const promise = observe.execute({ timeout_seconds: 10 }, ctx);

    // Trigger scene change via the mock emitter
    ctx.headlessScene!._emitSceneChanged(["content_changed"]);

    const result = parseResult(await promise);
    expect(result.trigger).toBe("scene_changed");
    expect(result.events[0].type).toBe("scene_changed");
    expect(result.events[0].changes).toContain("content_changed");
    expect(result.events[0].labels.length).toBe(1);
    // clickables and interactions are no longer included in scene_changed enrichment
    expect(result.events[0].clickables).toBeUndefined();
    expect(result.events[0].interactions).toBeUndefined();
  });

  test("filters labels with content [too far to read — move closer]", async () => {
    const ctx = createMockContext();
    ctx.worldConnection.getChatHistory.mockReturnValue([]);
    ctx.avatarController.isMoving.mockReturnValue(false);
    ctx.avatarController.getPosition.mockReturnValue({ x: 0, y: 0, z: 0 });

    ctx.headlessScene!.getLabelElements.mockReturnValue([
      {
        nodeId: 1,
        position: { x: 1, y: 0, z: 0 },
        attributes: { content: "[too far to read — move closer]" },
      },
    ]);
    ctx.headlessScene!.getClickableElements.mockReturnValue([]);
    ctx.headlessScene!.getInteractionElements.mockReturnValue([]);

    const promise = observe.execute({ timeout_seconds: 10 }, ctx);

    ctx.headlessScene!._emitSceneChanged(["content_changed"]);

    const result = parseResult(await promise);
    expect(result.trigger).toBe("scene_changed");
    // The label should be filtered out because of the special text
    expect(result.events[0].labels).toBeUndefined();
  });

  test("does not include scene events when disabled", async () => {
    vi.useFakeTimers();
    const ctx = createMockContext();
    ctx.worldConnection.getChatHistory.mockReturnValue([]);
    ctx.avatarController.isMoving.mockReturnValue(false);

    const promise = observe.execute({ timeout_seconds: 1, scene: false }, ctx);

    // Push a scene change — should be captured by buffer but filtered out
    ctx.headlessScene!._emitSceneChanged(["content_changed"]);

    vi.advanceTimersByTime(1100);

    const result = parseResult(await promise);
    expect(result.trigger).toBe("timeout");
    expect(result.events).toBeUndefined();

    vi.useRealTimers();
  });
});

describe("observe — stuck trigger", () => {
  test("fires on stuck event", async () => {
    const ctx = createMockContext();
    ctx.worldConnection.getChatHistory.mockReturnValue([]);
    ctx.avatarController.isMoving.mockReturnValue(true);

    const promise = observe.execute({ timeout_seconds: 10 }, ctx);
    ctx.avatarController.emit("stuck");

    const result = parseResult(await promise);
    expect(result.trigger).toBe("stuck");
  });
});

describe("observe — navmesh_ready trigger", () => {
  test("fires when navmesh becomes ready", async () => {
    const ctx = createMockContext({ navMeshManager: undefined });
    // Recreate navMeshManager with isReady=false so EventBuffer registers the listener
    const { EventEmitter } = await import("events");
    const navMeshEmitter = new EventEmitter();
    ctx.navMeshManager = {
      isReady: false,
      computePathWithJumpInfo: vi.fn(),
      isWithinRegion: vi.fn().mockReturnValue(true),
      computeEdgePoint: vi.fn(),
      waitForReady: vi.fn<() => Promise<boolean>>().mockResolvedValue(true),
      once: vi.fn((event: string, listener: (...args: any[]) => void) => {
        navMeshEmitter.once(event, listener);
      }),
      removeListener: vi.fn((event: string, listener: (...args: any[]) => void) => {
        navMeshEmitter.removeListener(event, listener);
      }),
      _emitEvent: (event: string) => navMeshEmitter.emit(event),
    } as any;
    // Recreate EventBuffer now that navMeshManager is not ready
    ctx.eventBuffer!.dispose();
    const { EventBuffer } = await import("../../src/tools/EventBuffer");
    ctx.eventBuffer = new EventBuffer(ctx);

    ctx.worldConnection.getChatHistory.mockReturnValue([]);
    ctx.avatarController.isMoving.mockReturnValue(false);

    const promise = observe.execute({ timeout_seconds: 10 }, ctx);

    // Simulate navmesh ready event
    ctx.navMeshManager!._emitEvent("ready");

    const result = parseResult(await promise);
    expect(result.trigger).toBe("navmesh_ready");
  });

  test("does not listen for navmesh when already ready", async () => {
    vi.useFakeTimers();
    const ctx = createMockContext();
    ctx.worldConnection.getChatHistory.mockReturnValue([]);
    ctx.avatarController.isMoving.mockReturnValue(false);

    // navmesh is already ready (default in mock)
    expect(ctx.navMeshManager!.isReady).toBe(true);

    const promise = observe.execute({ timeout_seconds: 1 }, ctx);
    vi.advanceTimersByTime(1100);

    const result = parseResult(await promise);
    expect(result.trigger).toBe("timeout");
    // Should not have registered navmesh listener
    expect(ctx.navMeshManager!.once).not.toHaveBeenCalled();

    vi.useRealTimers();
  });
});

describe("observe — deferred arrival check", () => {
  test("detects arrival after short delay when avatar stopped moving", async () => {
    vi.useFakeTimers();
    const ctx = createMockContext();
    ctx.worldConnection.getChatHistory.mockReturnValue([]);
    // Start moving, then stop after the initial checks
    ctx.avatarController.isMoving
      .mockReturnValueOnce(true) // immediate stale-arrival filter
      .mockReturnValueOnce(true) // section 4 initial check → enters polling branch
      .mockReturnValue(false); // interval poll → avatar has stopped

    const promise = observe.execute({ timeout_seconds: 10 }, ctx);

    // Advance past the 250ms deferred arrival poll interval
    await vi.advanceTimersByTimeAsync(300);

    const result = parseResult(await promise);
    expect(result.trigger).toBe("arrival");

    vi.useRealTimers();
  });
});

describe("observe — user_left trigger", () => {
  test("fires on user_left event", async () => {
    const ctx = createMockContext();
    ctx.worldConnection.getChatHistory.mockReturnValue([]);
    ctx.avatarController.isMoving.mockReturnValue(false);

    const promise = observe.execute({ timeout_seconds: 10 }, ctx);
    ctx.worldConnection._emitEvent({
      type: "user_left",
      connectionId: 7,
      userId: "user-7",
      username: "LeavingUser",
    });

    const result = parseResult(await promise);
    expect(result.trigger).toBe("user_left");
    expect(result.events[0].id).toBe(7);
    expect(result.events[0].name).toBe("LeavingUser");
  });
});

describe("observe — no headlessScene", () => {
  test("does not set up scene listener when headlessScene is null", async () => {
    vi.useFakeTimers();
    const ctx = createMockContext({ headlessScene: undefined });
    ctx.worldConnection.getChatHistory.mockReturnValue([]);

    const promise = observe.execute({ timeout_seconds: 1 }, ctx);
    vi.advanceTimersByTime(1100);

    const result = parseResult(await promise);
    expect(result.trigger).toBe("timeout");

    vi.useRealTimers();
  });
});

describe("observe — no navMeshManager", () => {
  test("works without navmesh manager", async () => {
    vi.useFakeTimers();
    const ctx = createMockContext({ navMeshManager: undefined });
    ctx.worldConnection.getChatHistory.mockReturnValue([]);

    const promise = observe.execute({ timeout_seconds: 1 }, ctx);
    vi.advanceTimersByTime(1100);

    const result = parseResult(await promise);
    expect(result.trigger).toBe("timeout");

    vi.useRealTimers();
  });
});

describe("get_scene_info — extended", () => {
  test("includes geometry when include_geometry is true", async () => {
    const ctx = createMockContext();
    ctx.headlessScene!.getFilteredSceneInfo.mockReturnValue([
      { name: "mesh1", position: { x: 1, y: 0, z: 0 }, size: { x: 1, y: 1, z: 1 } },
    ]);
    const result = parseResult(
      await getSceneInfo.execute({ include_geometry: true, geometry_radius: 15 }, ctx),
    );
    expect(result.nearbyGeometry).toBeDefined();
    expect(result.nearbyGeometry).toHaveLength(1);
    expect(ctx.headlessScene!.getFilteredSceneInfo).toHaveBeenCalledWith({ x: 0, y: 0, z: 0 }, 15);
  });

  test("returns categorized elements from getCategorizedElements", async () => {
    const ctx = createMockContext();
    ctx.avatarController.getPosition.mockReturnValue({ x: 0, y: 0, z: 0 });
    ctx.headlessScene!.getCategorizedElements.mockReturnValue([
      {
        nodeId: 1,
        tag: "m-cube",
        position: { x: 5, y: 0, z: 0 },
        attributes: { color: "red" },
        distance: 5,
        categories: ["clickable"],
      },
    ]);

    const result = parseResult(await getSceneInfo.execute({ radius: 20 }, ctx));
    expect(result.elements).toHaveLength(1);
    expect(result.elements[0].nodeId).toBe(1);
    expect(result.elements[0].categories).toEqual(["clickable"]);
    expect(result.elements[0].attrs.color).toBe("red");
  });

  test("no headlessScene returns sceneLoaded false and empty elements", async () => {
    const ctx = createMockContext({ headlessScene: undefined });
    const result = parseResult(await getSceneInfo.execute({}, ctx));
    expect(result.sceneLoaded).toBe(false);
    expect(result.elements).toEqual([]);
    expect(result.self).toBeDefined();
  });

  test("no avatarController returns empty elements", async () => {
    const ctx = createMockContext();
    (ctx as any).avatarController = undefined;
    const result = parseResult(await getSceneInfo.execute({}, ctx));
    expect(result.sceneLoaded).toBe(true);
    expect(result.elements).toEqual([]);
    expect(result.self).toBeUndefined();
  });
});

describe("observe — repeated arrival after teleport", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test("does not spam synthetic arrivals on consecutive observe calls after teleport", async () => {
    vi.useFakeTimers();
    const ctx = createMockContext();
    ctx.worldConnection.getChatHistory.mockReturnValue([]);
    ctx.avatarController.isMoving.mockReturnValue(false);

    // Simulate teleport: avatar emits "arrived" which the EventBuffer captures
    ctx.avatarController.emit("arrived");

    // First observe picks up the real arrival event — this is expected.
    // Use min_wait_ms: 0 so it resolves immediately with the buffered event.
    const result1 = parseResult(
      await observe.execute({ timeout_seconds: 1, resume_from: 0, min_wait_ms: 0 }, ctx),
    );
    expect(result1.trigger).toBe("arrival");
    const cursor1 = result1.resume_from;

    // Advance time a bit (but stay within the 5s LOOKBACK_MS window)
    vi.advanceTimersByTime(500);

    // Second observe using the cursor from the first — should NOT get another arrival
    const promise2 = observe.execute(
      { timeout_seconds: 1, resume_from: cursor1, min_wait_ms: 0 },
      ctx,
    );
    // Let the deferred arrival setTimeout(0) and timeout fire
    await vi.advanceTimersByTimeAsync(1100);

    const result2 = parseResult(await promise2);
    expect(result2.trigger).toBe("timeout");
    expect(result2.events).toBeUndefined();
  });

  test("does not spam synthetic arrivals when using resume_from last", async () => {
    vi.useFakeTimers();
    const ctx = createMockContext();
    ctx.worldConnection.getChatHistory.mockReturnValue([]);
    ctx.avatarController.isMoving.mockReturnValue(false);

    // Simulate teleport arrival
    ctx.avatarController.emit("arrived");

    // First observe picks up the arrival
    const result1 = parseResult(
      await observe.execute({ timeout_seconds: 1, resume_from: 0, min_wait_ms: 0 }, ctx),
    );
    expect(result1.trigger).toBe("arrival");

    vi.advanceTimersByTime(500);

    // Second observe with resume_from: "last" — should NOT get a synthetic arrival
    const promise2 = observe.execute(
      { timeout_seconds: 1, resume_from: "last", min_wait_ms: 0 },
      ctx,
    );
    await vi.advanceTimersByTimeAsync(1100);

    const result2 = parseResult(await promise2);
    expect(result2.trigger).toBe("timeout");
    expect(result2.events).toBeUndefined();
  });
});

describe("observe — arrival extended", () => {
  test("resolves on stuck event", async () => {
    const ctx = createMockContext();
    ctx.avatarController.isMoving.mockReturnValue(true);
    ctx.worldConnection.getChatHistory.mockReturnValue([]);

    const promise = observe.execute({ timeout_seconds: 10 }, ctx);
    ctx.avatarController.emit("stuck");

    const result = parseResult(await promise);
    expect(result.trigger).toBe("stuck");
  });

  test("resolves immediately with unread chat before waiting", async () => {
    const ctx = createMockContext();
    ctx.avatarController.isMoving.mockReturnValue(true);
    const now = Date.now();
    ctx.worldConnection.getChatHistory.mockReturnValue([
      { fromConnectionId: 2, userId: "user-2", username: "Alice", message: "hi", timestamp: now },
    ]);
    ctx.worldConnection.getConnectionId.mockReturnValue(1);

    const result = parseResult(await observe.execute({ resume_from: 0 }, ctx));
    expect(result.trigger).toBe("chat");
  });

  test("resolves on timeout", async () => {
    vi.useFakeTimers();
    const ctx = createMockContext();
    ctx.avatarController.isMoving.mockReturnValue(true);
    ctx.worldConnection.getChatHistory.mockReturnValue([]);

    const promise = observe.execute({ timeout_seconds: 1 }, ctx);
    vi.advanceTimersByTime(1100);

    const result = parseResult(await promise);
    expect(result.trigger).toBe("timeout");

    vi.useRealTimers();
  });
});

describe("navigate_to — extended", () => {
  test("waits for navmesh ready when not yet ready", async () => {
    const ctx = createMockContext();
    (ctx.navMeshManager as any).isReady = false;
    ctx.navMeshManager!.waitForReady.mockResolvedValue(true);
    ctx.navMeshManager!.isWithinRegion.mockReturnValue(true);

    const result = parseResult(await navigateTo.execute({ x: 5, y: 0, z: 5 }, ctx));
    expect(ctx.navMeshManager!.waitForReady).toHaveBeenCalledWith(30000);
    expect(result.status).toBe("navigating");
  });

  test("returns error when navmesh fails to become ready", async () => {
    const ctx = createMockContext();
    (ctx.navMeshManager as any).isReady = false;
    ctx.navMeshManager!.waitForReady.mockResolvedValue(false);

    const result = parseResult(await navigateTo.execute({ x: 5, y: 0, z: 5 }, ctx));
    expect(result.status).toBe("error");
    expect(result.error).toMatch(/still loading/);
  });

  test("handles partial path with no edge point", async () => {
    const ctx = createMockContext();
    ctx.navMeshManager!.isWithinRegion.mockReturnValue(false);
    ctx.navMeshManager!.computeEdgePoint.mockReturnValue(null);
    ctx.navMeshManager!.computePathWithJumpInfo.mockReturnValue(null);

    const result = parseResult(await navigateTo.execute({ x: 50, y: 0, z: 0 }, ctx));
    expect(result.status).toBe("no_path");
  });

  test("handles edge point with no path", async () => {
    const ctx = createMockContext();
    ctx.navMeshManager!.isWithinRegion.mockReturnValue(false);
    ctx.navMeshManager!.computeEdgePoint.mockReturnValue({ x: 10, y: 0, z: 0 });
    ctx
      .navMeshManager!.computePathWithJumpInfo.mockReturnValueOnce(null) // path to edge
      .mockReturnValue(null); // direct path

    const result = parseResult(await navigateTo.execute({ x: 50, y: 0, z: 0 }, ctx));
    expect(result.status).toBe("no_path");
  });

  test("includes jump count in result", async () => {
    const ctx = createMockContext();
    ctx.navMeshManager!.isWithinRegion.mockReturnValue(true);
    ctx.navMeshManager!.computePathWithJumpInfo.mockReturnValue({
      path: [
        { x: 0, y: 0, z: 0 },
        { x: 2, y: 2, z: 0 },
        { x: 5, y: 0, z: 5 },
      ],
      jumpIndices: new Set([1]),
    });

    const result = parseResult(await navigateTo.execute({ x: 5, y: 0, z: 5 }, ctx));
    expect(result.status).toBe("navigating");
    expect(result.jumps).toBe(1);
    expect(result.waypoints).toBe(3);
  });
});

describe("set_character_description — extended", () => {
  test("updates with mml_character_url", async () => {
    const ctx = createMockContext();
    const result = parseResult(
      await setCharacterDescription.execute(
        { mml_character_url: "https://example.com/char.html" },
        ctx,
      ),
    );
    expect(result.status).toBe("updated");
    expect(ctx.worldConnection.updateCharacterDescription).toHaveBeenCalledWith({
      mmlCharacterUrl: "https://example.com/char.html",
    });
  });

  test("updates with mml_character_string", async () => {
    const ctx = createMockContext();
    const result = parseResult(
      await setCharacterDescription.execute(
        { mml_character_string: "<m-character src='model.glb'/>" },
        ctx,
      ),
    );
    expect(result.status).toBe("updated");
    expect(ctx.worldConnection.updateCharacterDescription).toHaveBeenCalledWith({
      mmlCharacterString: "<m-character src='model.glb'/>",
    });
  });
});

describe("observe — chat filtering", () => {
  test("respects resume_from for chat filtering", async () => {
    vi.useFakeTimers();
    const ctx = createMockContext();
    const now = Date.now();
    // Chat exists but it's before resume_from
    ctx.worldConnection.getChatHistory.mockReturnValue([
      {
        fromConnectionId: 2,
        userId: "user-2",
        username: "Alice",
        message: "old",
        timestamp: now - 10000,
      },
    ]);
    ctx.worldConnection.getConnectionId.mockReturnValue(1);

    const promise = observe.execute({ timeout_seconds: 1, resume_from: now - 1000 }, ctx);
    vi.advanceTimersByTime(1100);

    const result = parseResult(await promise);
    expect(result.trigger).toBe("timeout");

    vi.useRealTimers();
  });

  test("ignores own chat messages", async () => {
    vi.useFakeTimers();
    const ctx = createMockContext();
    const now = Date.now();
    // Chat exists but it's from ourselves
    ctx.worldConnection.getChatHistory.mockReturnValue([
      {
        fromConnectionId: 1,
        userId: "user-1",
        username: "Bot",
        message: "my message",
        timestamp: now,
      },
    ]);
    ctx.worldConnection.getConnectionId.mockReturnValue(1);

    const promise = observe.execute({ timeout_seconds: 1, resume_from: 0 }, ctx);
    vi.advanceTimersByTime(1100);

    const result = parseResult(await promise);
    expect(result.trigger).toBe("timeout");

    vi.useRealTimers();
  });

  test("does not include users for chat-only events", async () => {
    const ctx = createMockContext();
    const now = Date.now();
    const msg = {
      fromConnectionId: 2,
      userId: "user-2",
      username: "Alice",
      message: "hi",
      timestamp: now,
    };
    ctx.worldConnection.getChatHistory.mockReturnValue([msg]);
    ctx.worldConnection.getOtherUsers.mockReturnValue([
      { connectionId: 2, userId: "user-2", username: "Alice", position: { x: 3, y: 0, z: 4 } },
    ]);
    ctx.avatarController.getPosition.mockReturnValue({ x: 0, y: 0, z: 0 });

    const result = parseResult(await observe.execute({ resume_from: 0 }, ctx));
    expect(result.trigger).toBe("chat");
    expect(result.events.some((e: any) => e.type === "chat" && e.from === "Alice")).toBe(true);
    // Users are not included for chat-only events
    expect(result.users).toBeUndefined();
  });
});
