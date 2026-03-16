import { describe, expect, test, beforeEach, vi } from "vitest";

import click from "../../src/tools/click";
import followUser from "../../src/tools/follow-user";
import getChatHistory from "../../src/tools/get-chat-history";
import getElement from "../../src/tools/get-element";
import getSceneInfo from "../../src/tools/get-scene-info";
import interact from "../../src/tools/interact";
import jump from "../../src/tools/jump";
import moveTo from "../../src/tools/move-to";
import navigateTo from "../../src/tools/navigate-to";
import observe from "../../src/tools/observe";
import searchNearby from "../../src/tools/search-nearby";
import sendChat from "../../src/tools/send-chat";
import setAnimation from "../../src/tools/set-animation";
import setCharacterDescription from "../../src/tools/set-character-description";
import stopFollowing from "../../src/tools/stop-following";
import stopMoving from "../../src/tools/stop-moving";
import teleport from "../../src/tools/teleport";

import { createMockContext, parseResult } from "./mock-context";

describe("teleport", () => {
  test("teleports avatar and returns position", async () => {
    const ctx = createMockContext();
    ctx.avatarController.getPosition.mockReturnValue({ x: 10, y: 0, z: 20 });
    const result = parseResult(await teleport.execute({ x: 10, y: 0, z: 20 }, ctx));
    expect(ctx.avatarController.teleport).toHaveBeenCalledWith(10, 0, 20);
    expect(result.status).toBe("teleported");
    expect(result.position).toEqual({ x: 10, y: 0, z: 20 });
  });

  test("returned position reflects the post-teleport state from getPosition", async () => {
    const ctx = createMockContext();
    ctx.avatarController.getPosition.mockReturnValue({ x: -5, y: 3, z: 12 });
    const result = parseResult(await teleport.execute({ x: -5, y: 3, z: 12 }, ctx));
    expect(result.position.x).toBe(-5);
    expect(result.position.y).toBe(3);
    expect(result.position.z).toBe(12);
  });
});

describe("move_to", () => {
  test("starts movement and returns from/to positions", async () => {
    const ctx = createMockContext();
    ctx.avatarController.getPosition.mockReturnValue({ x: 0, y: 0, z: 0 });
    const result = parseResult(await moveTo.execute({ x: 5, y: 0, z: 5 }, ctx));
    expect(ctx.avatarController.moveTo).toHaveBeenCalledWith(5, 0, 5, undefined);
    expect(result.status).toBe("moving");
    expect(result.to).toEqual({ x: 5, y: 0, z: 5 });
    expect(result.speed).toBe(3.0);
  });

  test("passes custom speed", async () => {
    const ctx = createMockContext();
    await moveTo.execute({ x: 5, y: 0, z: 5, speed: 10 }, ctx);
    expect(ctx.avatarController.moveTo).toHaveBeenCalledWith(5, 0, 5, 10);
  });

  test("result contains from position reflecting current avatar location", async () => {
    const ctx = createMockContext();
    ctx.avatarController.getPosition.mockReturnValue({ x: 1, y: 2, z: 3 });
    const result = parseResult(await moveTo.execute({ x: 10, y: 0, z: 10 }, ctx));
    expect(result.status).toBe("moving");
    expect(result.from).toEqual({ x: 1, y: 2, z: 3 });
    expect(result.to).toEqual({ x: 10, y: 0, z: 10 });
  });
});

describe("stop_moving", () => {
  test("returns 'stopped' when avatar was moving", async () => {
    const ctx = createMockContext();
    ctx.avatarController.isMoving.mockReturnValue(true);
    const result = parseResult(await stopMoving.execute({}, ctx));
    expect(ctx.avatarController.stop).toHaveBeenCalled();
    expect(result.status).toBe("stopped");
  });

  test("returns 'already_idle' when not moving", async () => {
    const ctx = createMockContext();
    ctx.avatarController.isMoving.mockReturnValue(false);
    const result = parseResult(await stopMoving.execute({}, ctx));
    expect(result.status).toBe("already_idle");
  });
});

describe("jump", () => {
  test("returns jump success and position", async () => {
    const ctx = createMockContext();
    ctx.avatarController.jump.mockReturnValue(true);
    const result = parseResult(await jump.execute({}, ctx));
    expect(result.jumped).toBe(true);
    expect(result.position).toBeDefined();
  });

  test("returns false when jump fails", async () => {
    const ctx = createMockContext();
    ctx.avatarController.jump.mockReturnValue(false);
    const result = parseResult(await jump.execute({}, ctx));
    expect(result.jumped).toBe(false);
  });
});

describe("set_animation_state", () => {
  test("sets animation state", async () => {
    const ctx = createMockContext();
    const result = parseResult(await setAnimation.execute({ state: 1 }, ctx));
    expect(ctx.avatarController.setAnimationState).toHaveBeenCalledWith(1);
    expect(result.animationState).toBe(1);
  });

  test("tracks state changes across multiple calls", async () => {
    const ctx = createMockContext();
    let trackedState = 0;
    ctx.avatarController.setAnimationState.mockImplementation((s: number) => {
      trackedState = s;
    });
    ctx.avatarController.getAnimationState.mockImplementation(() => trackedState);

    const result0 = parseResult(await setAnimation.execute({ state: 0 }, ctx));
    expect(result0.animationState).toBe(0);
    expect(trackedState).toBe(0);

    const result1 = parseResult(await setAnimation.execute({ state: 1 }, ctx));
    expect(result1.animationState).toBe(1);
    expect(trackedState).toBe(1);
  });
});

describe("send_chat_message", () => {
  test("sends chat message", async () => {
    const ctx = createMockContext();
    const result = parseResult(await sendChat.execute({ message: "hello" }, ctx));
    expect(ctx.worldConnection.sendChatMessage).toHaveBeenCalledWith("hello");
    expect(result.status).toBe("sent");
    expect(result.message).toBe("hello");
  });

  test("strips spurious backslash escapes from LLM output", async () => {
    const ctx = createMockContext();
    const result = parseResult(
      await sendChat.execute({ message: "Hey\\! Yeah I'm good\\, just looking around\\." }, ctx),
    );
    expect(ctx.worldConnection.sendChatMessage).toHaveBeenCalledWith(
      "Hey! Yeah I'm good, just looking around.",
    );
    expect(result.message).toBe("Hey! Yeah I'm good, just looking around.");
  });

  test("preserves valid escape sequences", async () => {
    const ctx = createMockContext();
    const result = parseResult(await sendChat.execute({ message: "line1\\nline2\\ttab\\\\" }, ctx));
    expect(ctx.worldConnection.sendChatMessage).toHaveBeenCalledWith("line1\\nline2\\ttab\\\\");
    expect(result.message).toBe("line1\\nline2\\ttab\\\\");
  });
});

describe("get_chat_history", () => {
  test("returns formatted chat messages", async () => {
    const ctx = createMockContext();
    const now = Date.now();
    ctx.worldConnection.getChatHistory.mockReturnValue([
      {
        fromConnectionId: 2,
        userId: "user-2",
        username: "Alice",
        message: "hi",
        timestamp: now - 5000,
      },
      {
        fromConnectionId: 3,
        userId: "user-3",
        username: "Bob",
        message: "hey",
        timestamp: now - 2000,
      },
    ]);
    const result = parseResult(await getChatHistory.execute({}, ctx));
    expect(result.count).toBe(2);
    expect(result.messages[0].username).toBe("Alice");
  });

  test("respects last_n parameter", async () => {
    const ctx = createMockContext();
    const now = Date.now();
    ctx.worldConnection.getChatHistory.mockReturnValue([
      { fromConnectionId: 2, userId: "user-2", username: "A", message: "1", timestamp: now - 3000 },
      { fromConnectionId: 2, userId: "user-2", username: "A", message: "2", timestamp: now - 2000 },
      { fromConnectionId: 2, userId: "user-2", username: "A", message: "3", timestamp: now - 1000 },
    ]);
    const result = parseResult(await getChatHistory.execute({ last_n: 2 }, ctx));
    expect(result.count).toBe(2);
    expect(result.messages[0].message).toBe("2");
  });
});

describe("follow_user", () => {
  test("starts following found user", async () => {
    const ctx = createMockContext();
    ctx.worldConnection.getOtherUsers.mockReturnValue([
      {
        connectionId: 42,
        userId: "user-42",
        username: "Alice",
        position: { x: 10, y: 0, z: 10 },
        characterDescription: null,
        colors: null,
      },
    ]);
    const result = parseResult(await followUser.execute({ username: "Alice" }, ctx));
    expect(result.status).toBe("following");
    expect(result.connectionId).toBe(42);
    expect(ctx.avatarController.startFollowing).toHaveBeenCalledWith(42, ctx.worldConnection, 2, 3);
  });

  test("returns error when user not found", async () => {
    const ctx = createMockContext();
    ctx.worldConnection.getOtherUsers.mockReturnValue([]);
    const result = parseResult(await followUser.execute({ username: "Nobody" }, ctx));
    expect(result.status).toBe("error");
    expect(result.error).toMatch(/not found/);
  });

  test("case-insensitive username matching", async () => {
    const ctx = createMockContext();
    ctx.worldConnection.getOtherUsers.mockReturnValue([
      {
        connectionId: 1,
        userId: "user-1",
        username: "Alice",
        position: { x: 0, y: 0, z: 0 },
        characterDescription: null,
        colors: null,
      },
    ]);
    const result = parseResult(await followUser.execute({ username: "alice" }, ctx));
    expect(result.status).toBe("following");
  });
});

describe("stop_following", () => {
  test("returns 'stopped' when was following", async () => {
    const ctx = createMockContext();
    ctx.avatarController.isFollowing.mockReturnValue(true);
    const result = parseResult(await stopFollowing.execute({}, ctx));
    expect(result.status).toBe("stopped");
    expect(ctx.avatarController.stopFollowing).toHaveBeenCalled();
  });

  test("returns 'not_following' when not following", async () => {
    const ctx = createMockContext();
    ctx.avatarController.isFollowing.mockReturnValue(false);
    const result = parseResult(await stopFollowing.execute({}, ctx));
    expect(result.status).toBe("not_following");
  });
});

describe("navigate_to", () => {
  test("computes path and follows it", async () => {
    const ctx = createMockContext();
    const result = parseResult(await navigateTo.execute({ x: 5, y: 0, z: 5 }, ctx));
    expect(result.status).toBe("navigating");
    expect(result.waypoints).toBeGreaterThanOrEqual(1);
    expect(ctx.avatarController.followPath).toHaveBeenCalled();
  });

  test("returns error when navmesh not available", async () => {
    const ctx = createMockContext({ navMeshManager: undefined });
    const result = parseResult(await navigateTo.execute({ x: 5, y: 0, z: 5 }, ctx));
    expect(result.status).toBe("error");
  });

  test("returns no_path when path not found", async () => {
    const ctx = createMockContext();
    ctx.navMeshManager!.computePathWithJumpInfo.mockReturnValue(null);
    const result = parseResult(await navigateTo.execute({ x: 5, y: 0, z: 5 }, ctx));
    expect(result.status).toBe("no_path");
  });

  test("computes partial path when destination is outside navmesh region", async () => {
    const ctx = createMockContext();
    ctx.navMeshManager!.isWithinRegion.mockReturnValue(false);
    ctx.navMeshManager!.computeEdgePoint.mockReturnValue({ x: 10, y: 0, z: 0 });
    ctx.navMeshManager!.computePathWithJumpInfo.mockReturnValue({
      path: [
        { x: 0, y: 0, z: 0 },
        { x: 10, y: 0, z: 0 },
      ],
      jumpIndices: new Set<number>(),
    });
    const result = parseResult(await navigateTo.execute({ x: 50, y: 0, z: 0 }, ctx));
    expect(result.status).toBe("partial_path");
    expect(result.autoResuming).toBe(true);
    expect(ctx.avatarController.setUltimateDestination).toHaveBeenCalled();
  });
});

describe("observe", () => {
  test("returns immediately if unread chat exists", async () => {
    const ctx = createMockContext();
    const now = Date.now();
    ctx.worldConnection.getChatHistory.mockReturnValue([
      { fromConnectionId: 2, userId: "user-2", username: "Alice", message: "hi", timestamp: now },
    ]);
    ctx.worldConnection.getConnectionId.mockReturnValue(1);
    const result = parseResult(await observe.execute({ resume_from: 0 }, ctx));
    expect(result.trigger).toBe("chat");
    expect(result.events).toHaveLength(1);
    expect(result.events[0].from).toBe("Alice");
    expect(result.events[0].text).toBe("hi");
    expect(result.resume_from).toBeDefined();
  });

  test("resolves on arrived event", async () => {
    const ctx = createMockContext();
    ctx.worldConnection.getChatHistory.mockReturnValue([]);
    ctx.avatarController.isMoving.mockReturnValue(true);
    const promise = observe.execute({ timeout_seconds: 5 }, ctx);
    ctx.avatarController.emit("arrived");
    const result = parseResult(await promise);
    expect(result.trigger).toBe("arrival");
    expect(result.resume_from).toBeDefined();
  });

  test("resolves on chat event", async () => {
    const ctx = createMockContext();
    ctx.avatarController.isMoving.mockReturnValue(false);
    ctx.worldConnection.getChatHistory.mockReturnValue([]);
    const promise = observe.execute({ timeout_seconds: 5 }, ctx);

    const msg = {
      fromConnectionId: 2,
      userId: "user-2",
      username: "Alice",
      message: "delayed",
      timestamp: Date.now() + 1,
    };
    ctx.worldConnection.getChatHistory.mockReturnValue([msg]);
    ctx.worldConnection._emitEvent({ type: "chat", message: msg });

    const result = parseResult(await promise);
    expect(result.trigger).toBe("chat");
    expect(result.events.some((e: any) => e.type === "chat" && e.from === "Alice")).toBe(true);
  });

  test("resolves on user_joined event", async () => {
    const ctx = createMockContext();
    ctx.worldConnection.getChatHistory.mockReturnValue([]);
    const promise = observe.execute({ timeout_seconds: 5 }, ctx);
    ctx.worldConnection._emitEvent({
      type: "user_joined",
      connectionId: 5,
      userId: "user-5",
      username: "Bob",
    });
    const result = parseResult(await promise);
    expect(result.trigger).toBe("user_joined");
    expect(result.events[0].name).toBe("Bob");
    expect(result.events[0].id).toBe(5);
  });

  test("resolves on follow_lost event", async () => {
    const ctx = createMockContext();
    ctx.worldConnection.getChatHistory.mockReturnValue([]);
    const promise = observe.execute({ timeout_seconds: 5 }, ctx);
    ctx.avatarController.emit("follow_lost");
    const result = parseResult(await promise);
    expect(result.trigger).toBe("follow_lost");
  });

  test("times out when no events fire", async () => {
    vi.useFakeTimers();
    const ctx = createMockContext();
    ctx.worldConnection.getChatHistory.mockReturnValue([]);
    const promise = observe.execute({ timeout_seconds: 1 }, ctx);
    vi.advanceTimersByTime(1100);
    const result = parseResult(await promise);
    expect(result.trigger).toBe("timeout");
    expect(result.resume_from).toBeDefined();
    vi.useRealTimers();
  });

  test("returns position as {x, y, z} object", async () => {
    const ctx = createMockContext();
    const now = Date.now();
    ctx.worldConnection.getChatHistory.mockReturnValue([
      { fromConnectionId: 2, userId: "user-2", username: "Alice", message: "hi", timestamp: now },
    ]);
    ctx.worldConnection.getConnectionId.mockReturnValue(1);
    ctx.avatarController.getPosition.mockReturnValue({ x: 1.23, y: 4.56, z: 7.89 });
    const result = parseResult(await observe.execute({ resume_from: 0 }, ctx));
    expect(result.position).toEqual({ x: 1.23, y: 4.56, z: 7.89 });
  });

  test("does not include users for non-user events", async () => {
    const ctx = createMockContext();
    const now = Date.now();
    ctx.worldConnection.getChatHistory.mockReturnValue([
      { fromConnectionId: 2, userId: "user-2", username: "Alice", message: "hi", timestamp: now },
    ]);
    ctx.worldConnection.getOtherUsers.mockReturnValue([
      { connectionId: 2, userId: "user-2", username: "Alice", position: { x: 3, y: 0, z: 4 } },
    ]);
    ctx.worldConnection.getConnectionId.mockReturnValue(1);
    const result = parseResult(await observe.execute({ resume_from: 0 }, ctx));
    // Chat events don't trigger user inclusion
    expect(result.users).toBeUndefined();
  });

  test("includes users when user_joined event occurs", async () => {
    const ctx = createMockContext();
    ctx.worldConnection.getChatHistory.mockReturnValue([]);
    ctx.worldConnection.getOtherUsers.mockReturnValue([
      { connectionId: 5, userId: "user-5", username: "Bob", position: { x: 3, y: 0, z: 4 } },
    ]);
    const promise = observe.execute({ timeout_seconds: 5 }, ctx);
    ctx.worldConnection._emitEvent({
      type: "user_joined",
      connectionId: 5,
      userId: "user-5",
      username: "Bob",
    });
    const result = parseResult(await promise);
    expect(result.trigger).toBe("user_joined");
    expect(result.users).toHaveLength(1);
    expect(result.users[0].name).toBe("Bob");
  });

  test("resolves with 'superseded' when abort signal fires", async () => {
    const ctx = createMockContext();
    ctx.worldConnection.getChatHistory.mockReturnValue([]);
    const ac = new AbortController();
    const promise = observe.execute({ timeout_seconds: 30 }, ctx, ac.signal);
    ac.abort();
    const result = parseResult(await promise);
    expect(result.trigger).toBe("superseded");
    expect(result.resume_from).toBeDefined();
    expect(result.position).toBeDefined();
  });

  test("resolves immediately with 'superseded' when signal is already aborted", async () => {
    const ctx = createMockContext();
    ctx.worldConnection.getChatHistory.mockReturnValue([]);
    const ac = new AbortController();
    ac.abort();
    const result = parseResult(await observe.execute({ timeout_seconds: 30 }, ctx, ac.signal));
    expect(result.trigger).toBe("superseded");
  });

  test("superseded observe includes events collected before abort", async () => {
    const ctx = createMockContext();
    ctx.worldConnection.getChatHistory.mockReturnValue([]);
    const ac = new AbortController();
    const promise = observe.execute({ timeout_seconds: 30 }, ctx, ac.signal);

    // Emit a user_joined event, then abort
    ctx.worldConnection._emitEvent({
      type: "user_joined",
      connectionId: 5,
      userId: "user-5",
      username: "Bob",
    });

    // Small delay to let the event buffer process
    await new Promise((r) => setTimeout(r, 10));
    ac.abort();

    const result = parseResult(await promise);
    expect(result.trigger).toBe("superseded");
    expect(result.events).toBeDefined();
    expect(result.events.some((e: any) => e.type === "user_joined")).toBe(true);
  });

  test("abort signal cleans up timers and listeners", async () => {
    vi.useFakeTimers();
    const ctx = createMockContext();
    ctx.worldConnection.getChatHistory.mockReturnValue([]);
    const ac = new AbortController();
    const promise = observe.execute({ timeout_seconds: 60 }, ctx, ac.signal);
    ac.abort();
    const result = parseResult(await promise);
    expect(result.trigger).toBe("superseded");
    // Advance past the original timeout — should not throw or double-resolve
    vi.advanceTimersByTime(61_000);
    vi.useRealTimers();
  });

  test("observe without signal still works normally", async () => {
    vi.useFakeTimers();
    const ctx = createMockContext();
    ctx.worldConnection.getChatHistory.mockReturnValue([]);
    const promise = observe.execute({ timeout_seconds: 1 }, ctx);
    vi.advanceTimersByTime(1100);
    const result = parseResult(await promise);
    expect(result.trigger).toBe("timeout");
    vi.useRealTimers();
  });
});

describe("click", () => {
  test("clicks node and returns result", async () => {
    const ctx = createMockContext();
    ctx.headlessScene!.clickNode.mockReturnValue({ success: true, tag: "m-cube" });
    const result = parseResult(await click.execute({ node_id: 42 }, ctx));
    expect(result.success).toBe(true);
    expect(result.tag).toBe("m-cube");
    expect(ctx.headlessScene!.clickNode).toHaveBeenCalledWith(42, { x: 0, y: 0, z: 0 });
  });

  test("passes avatar position to clickNode for range checking", async () => {
    const ctx = createMockContext();
    ctx.avatarController.getPosition.mockReturnValue({ x: 7, y: 1, z: -3 });
    ctx.headlessScene!.clickNode.mockReturnValue({ success: true, tag: "m-sphere" });
    const result = parseResult(await click.execute({ node_id: 5 }, ctx));
    expect(ctx.headlessScene!.clickNode).toHaveBeenCalledWith(5, { x: 7, y: 1, z: -3 });
    expect(result.success).toBe(true);
    expect(result.tag).toBe("m-sphere");
  });

  test("returns error when scene not loaded", async () => {
    const ctx = createMockContext({ headlessScene: undefined });
    const result = parseResult(await click.execute({ node_id: 42 }, ctx));
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Scene not loaded/);
  });
});

describe("interact", () => {
  test("triggers interaction and returns result", async () => {
    const ctx = createMockContext();
    ctx.headlessScene!.triggerInteraction.mockReturnValue({ success: true, prompt: "Press me" });
    const result = parseResult(await interact.execute({ node_id: 10 }, ctx));
    expect(result.success).toBe(true);
    expect(result.prompt).toBe("Press me");
    expect(ctx.headlessScene!.triggerInteraction).toHaveBeenCalledWith(10, { x: 0, y: 0, z: 0 });
  });

  test("passes avatar position to triggerInteraction for range checking", async () => {
    const ctx = createMockContext();
    ctx.avatarController.getPosition.mockReturnValue({ x: 4, y: 0, z: 2 });
    ctx.headlessScene!.triggerInteraction.mockReturnValue({ success: true, prompt: "Open door" });
    const result = parseResult(await interact.execute({ node_id: 7 }, ctx));
    expect(ctx.headlessScene!.triggerInteraction).toHaveBeenCalledWith(7, { x: 4, y: 0, z: 2 });
    expect(result.success).toBe(true);
    expect(result.prompt).toBe("Open door");
  });

  test("returns error when scene not loaded", async () => {
    const ctx = createMockContext({ headlessScene: undefined });
    const result = parseResult(await interact.execute({ node_id: 10 }, ctx));
    expect(result.success).toBe(false);
  });
});

describe("get_element", () => {
  test("returns element when found", async () => {
    const ctx = createMockContext();
    const element = { nodeId: 5, tag: "m-cube", position: { x: 1, y: 2, z: 3 } };
    ctx.headlessScene!.getElementByNodeId.mockReturnValue(element);
    const result = parseResult(await getElement.execute({ node_id: 5 }, ctx));
    expect(result.nodeId).toBe(5);
    expect(result.tag).toBe("m-cube");
  });

  test("returns error when element not found", async () => {
    const ctx = createMockContext();
    ctx.headlessScene!.getElementByNodeId.mockReturnValue(null);
    const result = parseResult(await getElement.execute({ node_id: 999 }, ctx));
    expect(result.error).toMatch(/No element found/);
  });

  test("returns error when scene not loaded", async () => {
    const ctx = createMockContext({ headlessScene: undefined });
    const result = parseResult(await getElement.execute({ node_id: 5 }, ctx));
    expect(result.error).toMatch(/Scene not loaded/);
  });
});

describe("search_nearby", () => {
  test("returns elements sorted by distance", async () => {
    const ctx = createMockContext();
    ctx.headlessScene!.getAllElements.mockReturnValue([
      {
        nodeId: 1,
        tag: "m-cube",
        position: { x: 3, y: 0, z: 0 },
        distance: 3,
        attributes: { color: "red" },
      },
    ]);
    const result = parseResult(await searchNearby.execute({ radius: 15 }, ctx));
    expect(result.found).toBe(1);
    expect(result.elements[0].nodeId).toBe(1);
  });

  test("returns error when scene not loaded", async () => {
    const ctx = createMockContext({ headlessScene: undefined });
    const result = parseResult(await searchNearby.execute({}, ctx));
    expect(result.error).toMatch(/Scene not loaded/);
  });
});

describe("get_scene_info", () => {
  test("returns scene overview with self, users, and elements", async () => {
    const ctx = createMockContext();
    ctx.avatarController.getPosition.mockReturnValue({ x: 1, y: 2, z: 3 });
    ctx.avatarController.getRotation.mockReturnValue({ eulerY: 1.05 });
    ctx.avatarController.isMoving.mockReturnValue(true);
    ctx.avatarController.distanceToTarget.mockReturnValue(7.5);
    ctx.worldConnection.getOtherUsers.mockReturnValue([
      { connectionId: 2, userId: "user-2", username: "Alice", position: { x: 5, y: 0, z: 5 } },
    ]);
    const result = parseResult(await getSceneInfo.execute({}, ctx));
    expect(result.sceneLoaded).toBe(true);
    expect(result.navmeshReady).toBe(true);
    // self section
    expect(result.self.position).toEqual({ x: 1, y: 2, z: 3 });
    expect(result.self.rotation).toEqual({ eulerY: 1.05 });
    expect(result.self.isMoving).toBe(true);
    expect(result.self.distanceToTarget).toBe(7.5);
    expect(result.self.username).toBe("Agent");
    // users section
    expect(result.users).toHaveLength(1);
    expect(result.users[0].username).toBe("Alice");
    // elements section
    expect(result.elements).toEqual([]);
  });

  test("distanceToTarget is null when not moving", async () => {
    const ctx = createMockContext();
    ctx.avatarController.isMoving.mockReturnValue(false);
    const result = parseResult(await getSceneInfo.execute({}, ctx));
    expect(result.self.distanceToTarget).toBeNull();
  });

  test("toggle params exclude sections", async () => {
    const ctx = createMockContext();
    const result = parseResult(
      await getSceneInfo.execute(
        { include_self: false, include_users: false, include_elements: false },
        ctx,
      ),
    );
    expect(result.sceneLoaded).toBe(true);
    expect(result.self).toBeUndefined();
    expect(result.users).toBeUndefined();
    expect(result.elements).toBeUndefined();
  });

  test("returns sceneLoaded false and empty elements when scene not loaded", async () => {
    const ctx = createMockContext({ headlessScene: undefined });
    const result = parseResult(await getSceneInfo.execute({}, ctx));
    expect(result.sceneLoaded).toBe(false);
    expect(result.elements).toEqual([]);
    expect(result.self).toBeDefined();
  });
});

describe("set_character_description", () => {
  test("updates with mesh_file_url", async () => {
    const ctx = createMockContext();
    const result = parseResult(
      await setCharacterDescription.execute(
        { mesh_file_url: "https://example.com/avatar.glb" },
        ctx,
      ),
    );
    expect(result.status).toBe("updated");
    expect(ctx.worldConnection.updateCharacterDescription).toHaveBeenCalledWith({
      meshFileUrl: "https://example.com/avatar.glb",
    });
  });

  test("returns error when no option provided", async () => {
    const ctx = createMockContext();
    const result = parseResult(await setCharacterDescription.execute({}, ctx));
    expect(result.error).toMatch(/Must provide exactly one/);
  });

  test("returns error when multiple options provided", async () => {
    const ctx = createMockContext();
    const result = parseResult(
      await setCharacterDescription.execute(
        {
          mesh_file_url: "a.glb",
          mml_character_url: "b.html",
        },
        ctx,
      ),
    );
    expect(result.error).toMatch(/Provide only one/);
  });
});
