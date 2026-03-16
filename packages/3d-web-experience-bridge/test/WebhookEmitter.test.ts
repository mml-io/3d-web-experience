import dns from "dns";
import { EventEmitter } from "events";

import { describe, expect, test, beforeEach, afterEach, vi } from "vitest";

import { WebhookEmitter, type WebhookConfig } from "../src/WebhookEmitter";

// Mock DNS resolution to avoid real network calls in tests.
// Returns a non-private IP so isPrivateHost() returns false for public URLs.
vi.spyOn(dns.promises, "resolve").mockResolvedValue(["93.184.216.34"] as any);

// Build minimal mock WorldConnection and AvatarController that satisfy
// the WebhookEmitter constructor.

function createMockWorldConnection() {
  const listeners: Array<(event: any) => void> = [];
  return {
    addEventListener: vi.fn((listener: (event: any) => void) => {
      listeners.push(listener);
    }),
    removeEventListener: vi.fn((listener: (event: any) => void) => {
      const idx = listeners.indexOf(listener);
      if (idx !== -1) listeners.splice(idx, 1);
    }),
    getOtherUsers: vi.fn(() => []),
    getConnectionId: vi.fn(() => 1),
    _emitEvent: (event: any) => {
      for (const l of [...listeners]) l(event);
    },
  } as any;
}

function createMockAvatarController() {
  const emitter = new EventEmitter();
  return {
    getPosition: vi.fn(() => ({ x: 0, y: 0, z: 0 })),
    isMoving: vi.fn(() => false),
    on: vi.fn((event: string, listener: (...args: any[]) => void) => {
      emitter.on(event, listener);
    }),
    off: vi.fn((event: string, listener: (...args: any[]) => void) => {
      emitter.off(event, listener);
    }),
    emit: (event: string, ...args: any[]) => emitter.emit(event, ...args),
  } as any;
}

const VALID_URL = "https://hooks.example.com/events";

describe("WebhookEmitter", () => {
  describe("URL validation", () => {
    test("rejects non-http/https protocols", async () => {
      await expect(
        WebhookEmitter.create(
          { url: "ftp://example.com/hook" },
          createMockWorldConnection(),
          createMockAvatarController(),
        ),
      ).rejects.toThrow(/http or https/);
    });

    test("rejects invalid URLs", async () => {
      await expect(
        WebhookEmitter.create(
          { url: "not-a-url" },
          createMockWorldConnection(),
          createMockAvatarController(),
        ),
      ).rejects.toThrow(/Invalid URL|Invalid webhook URL/);
    });

    test("rejects localhost", async () => {
      await expect(
        WebhookEmitter.create(
          { url: "http://localhost:3000/hook" },
          createMockWorldConnection(),
          createMockAvatarController(),
        ),
      ).rejects.toThrow(/private/i);
    });

    test("rejects 127.0.0.1", async () => {
      await expect(
        WebhookEmitter.create(
          { url: "http://127.0.0.1/hook" },
          createMockWorldConnection(),
          createMockAvatarController(),
        ),
      ).rejects.toThrow(/private/i);
    });

    test("rejects 10.x private range", async () => {
      await expect(
        WebhookEmitter.create(
          { url: "http://10.0.0.1/hook" },
          createMockWorldConnection(),
          createMockAvatarController(),
        ),
      ).rejects.toThrow(/private/i);
    });

    test("rejects 192.168.x.x private range", async () => {
      await expect(
        WebhookEmitter.create(
          { url: "http://192.168.1.1/hook" },
          createMockWorldConnection(),
          createMockAvatarController(),
        ),
      ).rejects.toThrow(/private/i);
    });

    test("rejects 172.16-31.x.x private range", async () => {
      await expect(
        WebhookEmitter.create(
          { url: "http://172.16.0.1/hook" },
          createMockWorldConnection(),
          createMockAvatarController(),
        ),
      ).rejects.toThrow(/private/i);
    });

    test("rejects 169.254.x.x link-local", async () => {
      await expect(
        WebhookEmitter.create(
          { url: "http://169.254.1.1/hook" },
          createMockWorldConnection(),
          createMockAvatarController(),
        ),
      ).rejects.toThrow(/private/i);
    });

    test("rejects 0.0.0.0", async () => {
      await expect(
        WebhookEmitter.create(
          { url: "http://0.0.0.0/hook" },
          createMockWorldConnection(),
          createMockAvatarController(),
        ),
      ).rejects.toThrow(/private/i);
    });

    test("rejects .local domains", async () => {
      await expect(
        WebhookEmitter.create(
          { url: "http://myhost.local/hook" },
          createMockWorldConnection(),
          createMockAvatarController(),
        ),
      ).rejects.toThrow(/private/i);
    });

    test("rejects .internal domains", async () => {
      await expect(
        WebhookEmitter.create(
          { url: "http://service.internal/hook" },
          createMockWorldConnection(),
          createMockAvatarController(),
        ),
      ).rejects.toThrow(/private/i);
    });

    test("rejects IPv6 loopback", async () => {
      await expect(
        WebhookEmitter.create(
          { url: "http://[::1]/hook" },
          createMockWorldConnection(),
          createMockAvatarController(),
        ),
      ).rejects.toThrow(/private/i);
    });

    test("rejects IPv6 link-local", async () => {
      await expect(
        WebhookEmitter.create(
          { url: "http://[fe80::1]/hook" },
          createMockWorldConnection(),
          createMockAvatarController(),
        ),
      ).rejects.toThrow(/private/i);
    });

    test("rejects IPv6 ULA (fd)", async () => {
      await expect(
        WebhookEmitter.create(
          { url: "http://[fd00::1]/hook" },
          createMockWorldConnection(),
          createMockAvatarController(),
        ),
      ).rejects.toThrow(/private/i);
    });

    test("allows 172.15.x.x (not in private range)", async () => {
      const emitter = await WebhookEmitter.create(
        { url: "http://172.15.0.1/hook" },
        createMockWorldConnection(),
        createMockAvatarController(),
      );
      await emitter.dispose();
    });

    test("accepts valid public URL", async () => {
      const emitter = await WebhookEmitter.create(
        { url: VALID_URL },
        createMockWorldConnection(),
        createMockAvatarController(),
      );
      await emitter.dispose();
    });
  });

  describe("event filtering", () => {
    test("defaults to chat, user_joined, user_left, arrival events", async () => {
      const wc = createMockWorldConnection();
      const ac = createMockAvatarController();
      const emitter = await WebhookEmitter.create({ url: VALID_URL }, wc, ac);
      // The emitter should have registered listeners
      expect(wc.addEventListener).toHaveBeenCalled();
      expect(ac.on).toHaveBeenCalledWith("arrived", expect.any(Function));
      await emitter.dispose();
    });

    test("filtered events are not queued", async () => {
      vi.useFakeTimers();
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));
      const wc = createMockWorldConnection();
      const ac = createMockAvatarController();
      // Only subscribe to "chat" events
      const emitter = await WebhookEmitter.create(
        { url: VALID_URL, events: ["chat"], batchMs: 100 },
        wc,
        ac,
      );

      // Emit a user_joined event (should be filtered out)
      wc._emitEvent({ type: "user_joined", connectionId: 5, userId: "user-5", username: "Bob" });
      await vi.advanceTimersByTimeAsync(200);

      // fetch should NOT have been called because user_joined is filtered
      expect(fetchSpy).not.toHaveBeenCalled();

      await emitter.dispose();
      fetchSpy.mockRestore();
      vi.useRealTimers();
    });

    test("custom event filter allows specified events", async () => {
      vi.useFakeTimers();
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));
      const wc = createMockWorldConnection();
      const ac = createMockAvatarController();
      const emitter = await WebhookEmitter.create(
        { url: VALID_URL, events: ["chat"], batchMs: 100 },
        wc,
        ac,
      );

      // Emit a chat event (should pass through)
      wc._emitEvent({
        type: "chat",
        message: { username: "Alice", message: "Hello" },
      });
      await vi.advanceTimersByTimeAsync(200);

      expect(fetchSpy).toHaveBeenCalledTimes(1);

      await emitter.dispose();
      fetchSpy.mockRestore();
      vi.useRealTimers();
    });
  });

  describe("batching and flush", () => {
    test("flush sends HTTP POST with correct payload structure", async () => {
      vi.useFakeTimers();
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));
      const wc = createMockWorldConnection();
      wc.getOtherUsers.mockReturnValue([
        { connectionId: 2, userId: "user-2", username: "Bob", position: { x: 1, y: 0, z: 1 } },
      ]);
      const ac = createMockAvatarController();
      ac.getPosition.mockReturnValue({ x: 5, y: 0, z: 5 });
      ac.isMoving.mockReturnValue(true);

      const emitter = await WebhookEmitter.create({ url: VALID_URL, batchMs: 100 }, wc, ac);

      wc._emitEvent({
        type: "chat",
        message: { username: "Alice", message: "Hi!" },
      });
      await vi.advanceTimersByTimeAsync(200);

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const call = fetchSpy.mock.calls[0]!;
      expect(call[0]).toBe(VALID_URL);
      const opts = call[1] as RequestInit;
      expect(opts.method).toBe("POST");
      expect(opts.headers).toEqual(expect.objectContaining({ "Content-Type": "application/json" }));

      const body = JSON.parse(opts.body as string);
      expect(body.events).toHaveLength(1);
      expect(body.events[0].type).toBe("chat");
      expect(body.events[0].username).toBe("Alice");
      expect(body.events[0].message).toBe("Hi!");
      expect(body.context.position).toEqual({ x: 5, y: 0, z: 5 });
      expect(body.context.isMoving).toBe(true);
      expect(body.context.nearbyUsers).toHaveLength(1);
      expect(body.context.nearbyUsers[0].username).toBe("Bob");
      expect(body.timestamp).toBeDefined();

      await emitter.dispose();
      fetchSpy.mockRestore();
      vi.useRealTimers();
    });

    test("batch timer groups events within batchMs window", async () => {
      vi.useFakeTimers();
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));
      const wc = createMockWorldConnection();
      const ac = createMockAvatarController();
      const emitter = await WebhookEmitter.create({ url: VALID_URL, batchMs: 500 }, wc, ac);

      // Emit multiple events rapidly
      wc._emitEvent({ type: "chat", message: { username: "A", message: "1" } });
      vi.advanceTimersByTime(100);
      wc._emitEvent({ type: "chat", message: { username: "B", message: "2" } });
      vi.advanceTimersByTime(100);
      wc._emitEvent({ type: "chat", message: { username: "C", message: "3" } });

      // Not yet flushed
      expect(fetchSpy).not.toHaveBeenCalled();

      // Advance past batchMs
      await vi.advanceTimersByTimeAsync(400);

      // All three events in one batch
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const body = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
      expect(body.events).toHaveLength(3);

      await emitter.dispose();
      fetchSpy.mockRestore();
      vi.useRealTimers();
    });

    test("auth token is included in Authorization header", async () => {
      vi.useFakeTimers();
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));
      const wc = createMockWorldConnection();
      const ac = createMockAvatarController();
      const emitter = await WebhookEmitter.create(
        { url: VALID_URL, token: "my-secret-token", batchMs: 100 },
        wc,
        ac,
      );

      wc._emitEvent({ type: "chat", message: { username: "A", message: "Hi" } });
      await vi.advanceTimersByTimeAsync(200);

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const headers = (fetchSpy.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
      expect(headers["Authorization"]).toBe("Bearer my-secret-token");

      await emitter.dispose();
      fetchSpy.mockRestore();
      vi.useRealTimers();
    });

    test("no Authorization header when token is not set", async () => {
      vi.useFakeTimers();
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));
      const wc = createMockWorldConnection();
      const ac = createMockAvatarController();
      const emitter = await WebhookEmitter.create({ url: VALID_URL, batchMs: 100 }, wc, ac);

      wc._emitEvent({ type: "chat", message: { username: "A", message: "Hi" } });
      await vi.advanceTimersByTimeAsync(200);

      const headers = (fetchSpy.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
      expect(headers["Authorization"]).toBeUndefined();

      await emitter.dispose();
      fetchSpy.mockRestore();
      vi.useRealTimers();
    });
  });

  describe("queue overflow", () => {
    test("drops newest event at MAX_PENDING_EVENTS (500)", async () => {
      vi.useFakeTimers();
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));
      const wc = createMockWorldConnection();
      const ac = createMockAvatarController();
      const emitter = await WebhookEmitter.create({ url: VALID_URL, batchMs: 60000 }, wc, ac);

      // Enqueue 500 events (the max)
      for (let i = 0; i < 500; i++) {
        wc._emitEvent({ type: "chat", message: { username: "A", message: `msg-${i}` } });
      }

      // The 501st should be dropped
      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      wc._emitEvent({ type: "chat", message: { username: "A", message: "dropped" } });
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Event queue full"));

      // Flush and verify we have exactly 500 events
      await vi.advanceTimersByTimeAsync(70000);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const body = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
      expect(body.events).toHaveLength(500);

      consoleSpy.mockRestore();
      await emitter.dispose();
      fetchSpy.mockRestore();
      vi.useRealTimers();
    });
  });

  describe("retry and backoff", () => {
    test("HTTP 5xx triggers requeue with retry", async () => {
      vi.useFakeTimers();
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(new Response("error", { status: 503 }));
      const wc = createMockWorldConnection();
      const ac = createMockAvatarController();
      const emitter = await WebhookEmitter.create({ url: VALID_URL, batchMs: 1000 }, wc, ac);

      wc._emitEvent({ type: "chat", message: { username: "A", message: "Hi" } });

      // Advance exactly to fire the batch timer
      await vi.advanceTimersByTimeAsync(1100);

      const callsAfterFirst = fetchSpy.mock.calls.length;
      expect(callsAfterFirst).toBeGreaterThanOrEqual(1);

      // Advance time for the backoff retry — requeue schedules a retry with
      // exponential backoff
      await vi.advanceTimersByTimeAsync(60000);

      // Should have retried
      expect(fetchSpy.mock.calls.length).toBeGreaterThan(callsAfterFirst);

      await emitter.dispose();
      fetchSpy.mockRestore();
      vi.useRealTimers();
    });

    test("HTTP 4xx does not trigger requeue", async () => {
      vi.useFakeTimers();
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(new Response("bad request", { status: 400 }));
      const wc = createMockWorldConnection();
      const ac = createMockAvatarController();
      const emitter = await WebhookEmitter.create({ url: VALID_URL, batchMs: 1000 }, wc, ac);

      wc._emitEvent({ type: "chat", message: { username: "A", message: "Hi" } });
      await vi.advanceTimersByTimeAsync(1100);

      const callsAfterFirst = fetchSpy.mock.calls.length;
      expect(callsAfterFirst).toBeGreaterThanOrEqual(1);

      // Advance time — should NOT retry on 4xx (no requeue for client errors)
      await vi.advanceTimersByTimeAsync(60000);
      expect(fetchSpy.mock.calls.length).toBe(callsAfterFirst);

      await emitter.dispose();
      fetchSpy.mockRestore();
      vi.useRealTimers();
    });

    test("network error triggers requeue", async () => {
      vi.useFakeTimers();
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network error"));
      const wc = createMockWorldConnection();
      const ac = createMockAvatarController();
      const emitter = await WebhookEmitter.create({ url: VALID_URL, batchMs: 100 }, wc, ac);

      wc._emitEvent({ type: "chat", message: { username: "A", message: "Hi" } });
      await vi.advanceTimersByTimeAsync(200);

      const callsAfterFirst = fetchSpy.mock.calls.length;
      expect(callsAfterFirst).toBeGreaterThanOrEqual(1);

      // Advance time for retry
      await vi.advanceTimersByTimeAsync(10000);
      expect(fetchSpy.mock.calls.length).toBeGreaterThan(callsAfterFirst);

      await emitter.dispose();
      fetchSpy.mockRestore();
      vi.useRealTimers();
    });

    test("successful flush resets consecutiveFailures", async () => {
      vi.useFakeTimers();
      let callCount = 0;
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
        callCount++;
        // First call fails, second succeeds
        if (callCount === 1) {
          return Promise.resolve(new Response("error", { status: 503 }));
        }
        return Promise.resolve(new Response("ok", { status: 200 }));
      });
      const wc = createMockWorldConnection();
      const ac = createMockAvatarController();
      const emitter = await WebhookEmitter.create({ url: VALID_URL, batchMs: 100 }, wc, ac);

      wc._emitEvent({ type: "chat", message: { username: "A", message: "Hi" } });
      await vi.advanceTimersByTimeAsync(200);

      // Advance for retry
      await vi.advanceTimersByTimeAsync(10000);

      // Now send another event — should succeed without issue (failures were reset)
      wc._emitEvent({ type: "chat", message: { username: "B", message: "Hey" } });
      await vi.advanceTimersByTimeAsync(200);

      await emitter.dispose();
      fetchSpy.mockRestore();
      vi.useRealTimers();
    });
  });

  describe("world events", () => {
    test("chat event from worldConnection is enqueued", async () => {
      vi.useFakeTimers();
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));
      const wc = createMockWorldConnection();
      const ac = createMockAvatarController();
      const emitter = await WebhookEmitter.create({ url: VALID_URL, batchMs: 100 }, wc, ac);

      wc._emitEvent({
        type: "chat",
        message: { username: "Alice", message: "Hello world" },
      });
      await vi.advanceTimersByTimeAsync(200);

      const body = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
      expect(body.events[0].type).toBe("chat");
      expect(body.events[0].username).toBe("Alice");
      expect(body.events[0].message).toBe("Hello world");

      await emitter.dispose();
      fetchSpy.mockRestore();
      vi.useRealTimers();
    });

    test("user_joined event is enqueued", async () => {
      vi.useFakeTimers();
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));
      const wc = createMockWorldConnection();
      const ac = createMockAvatarController();
      const emitter = await WebhookEmitter.create({ url: VALID_URL, batchMs: 100 }, wc, ac);

      wc._emitEvent({ type: "user_joined", connectionId: 5, userId: "user-5", username: "Bob" });
      await vi.advanceTimersByTimeAsync(200);

      const body = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
      expect(body.events[0].type).toBe("user_joined");
      expect(body.events[0].userId).toBe("user-5");
      expect(body.events[0].username).toBe("Bob");

      await emitter.dispose();
      fetchSpy.mockRestore();
      vi.useRealTimers();
    });

    test("user_left event is enqueued", async () => {
      vi.useFakeTimers();
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));
      const wc = createMockWorldConnection();
      const ac = createMockAvatarController();
      const emitter = await WebhookEmitter.create({ url: VALID_URL, batchMs: 100 }, wc, ac);

      wc._emitEvent({ type: "user_left", connectionId: 5, userId: "user-5", username: "Bob" });
      await vi.advanceTimersByTimeAsync(200);

      const body = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
      expect(body.events[0].type).toBe("user_left");
      expect(body.events[0].userId).toBe("user-5");
      expect(body.events[0].username).toBe("Bob");

      await emitter.dispose();
      fetchSpy.mockRestore();
      vi.useRealTimers();
    });

    test("arrival event from avatarController is enqueued", async () => {
      vi.useFakeTimers();
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));
      const wc = createMockWorldConnection();
      const ac = createMockAvatarController();
      const emitter = await WebhookEmitter.create({ url: VALID_URL, batchMs: 100 }, wc, ac);

      ac.emit("arrived");
      await vi.advanceTimersByTimeAsync(200);

      const body = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
      expect(body.events[0].type).toBe("arrival");
      expect(body.events[0].timestamp).toBeDefined();

      await emitter.dispose();
      fetchSpy.mockRestore();
      vi.useRealTimers();
    });

    test("unrecognized world event types are ignored", async () => {
      vi.useFakeTimers();
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));
      const wc = createMockWorldConnection();
      const ac = createMockAvatarController();
      const emitter = await WebhookEmitter.create({ url: VALID_URL, batchMs: 100 }, wc, ac);

      // Emit an event type the worldEventListener doesn't handle
      wc._emitEvent({ type: "world_config", config: {} });
      await vi.advanceTimersByTimeAsync(200);

      // Should NOT have triggered a fetch
      expect(fetchSpy).not.toHaveBeenCalled();

      await emitter.dispose();
      fetchSpy.mockRestore();
      vi.useRealTimers();
    });
  });

  describe("dispose", () => {
    test("removes event listeners", async () => {
      const wc = createMockWorldConnection();
      const ac = createMockAvatarController();
      const emitter = await WebhookEmitter.create({ url: VALID_URL }, wc, ac);
      await emitter.dispose();
      expect(wc.removeEventListener).toHaveBeenCalled();
      expect(ac.off).toHaveBeenCalledWith("arrived", expect.any(Function));
    });

    test("dispose flushes remaining events", async () => {
      vi.useFakeTimers();
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));
      const wc = createMockWorldConnection();
      const ac = createMockAvatarController();
      const emitter = await WebhookEmitter.create({ url: VALID_URL, batchMs: 60000 }, wc, ac);

      // Enqueue an event but don't wait for batch timer
      wc._emitEvent({ type: "chat", message: { username: "A", message: "final" } });

      // Dispose should flush (now awaitable)
      await emitter.dispose();

      expect(fetchSpy).toHaveBeenCalledTimes(1);

      fetchSpy.mockRestore();
      vi.useRealTimers();
    });

    test("dispose clears batch timer", async () => {
      vi.useFakeTimers();
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));
      const wc = createMockWorldConnection();
      const ac = createMockAvatarController();
      const emitter = await WebhookEmitter.create({ url: VALID_URL, batchMs: 5000 }, wc, ac);

      wc._emitEvent({ type: "chat", message: { username: "A", message: "test" } });
      await emitter.dispose();

      // Advance past original batch timer — should not double-flush
      await vi.advanceTimersByTimeAsync(10000);

      // Only one flush from dispose
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      fetchSpy.mockRestore();
      vi.useRealTimers();
    });
  });
});
