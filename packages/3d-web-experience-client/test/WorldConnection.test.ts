import { jest } from "@jest/globals";
import type { NetworkUpdate } from "@mml-io/3d-web-user-networking";

import type { WorldConnectionConfig, WorldEvent } from "../src/WorldConnection";

// Enum values matching @mml-io/3d-web-user-networking WebsocketStatus
const WebsocketStatus = {
  Connecting: 0,
  Connected: 1,
  Reconnecting: 2,
  Disconnected: 3,
} as const;

// Capture the callbacks passed to UserNetworkingClient constructor
let capturedConfig: {
  statusUpdateCallback: (status: number) => void;
  assignedIdentity: (connectionId: number) => void;
  onServerError: (error: { message: string; errorType: string }) => void;
  onCustomMessage: (customType: number, contents: string) => void;
  onUpdate: (update: NetworkUpdate) => void;
};

const mockSendUpdate = jest.fn();
const mockSendCustomMessage = jest.fn();
const mockUpdateUsername = jest.fn();
const mockUpdateCharacterDescription = jest.fn();
const mockUpdateColors = jest.fn();
const mockStop = jest.fn();

jest.unstable_mockModule("@mml-io/3d-web-user-networking", () => ({
  UserNetworkingClient: jest.fn().mockImplementation((config: any) => {
    capturedConfig = config;
    return {
      sendUpdate: mockSendUpdate,
      sendCustomMessage: mockSendCustomMessage,
      updateUsername: mockUpdateUsername,
      updateCharacterDescription: mockUpdateCharacterDescription,
      updateColors: mockUpdateColors,
      stop: mockStop,
    };
  }),
  WebsocketStatus,
  DeltaNetServerErrors: {
    USER_AUTHENTICATION_FAILED_ERROR_TYPE: "USER_AUTHENTICATION_FAILED",
    USER_NETWORKING_CONNECTION_LIMIT_REACHED_ERROR_TYPE: "CONNECTION_LIMIT_REACHED",
    USER_NETWORKING_SERVER_SHUTDOWN_ERROR_TYPE: "SERVER_SHUTDOWN",
  },
}));

const { WorldConnection } = await import("../src/WorldConnection");

function createConnection(
  overrides?: Partial<WorldConnectionConfig>,
): InstanceType<typeof WorldConnection> {
  return new WorldConnection({
    url: "ws://localhost:8080/ws",
    sessionToken: "test-token",
    websocketFactory: jest.fn() as any,
    ...overrides,
  });
}

describe("WorldConnection", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("waitForConnection resolves on Connected status", async () => {
    const conn = createConnection();
    capturedConfig.statusUpdateCallback(WebsocketStatus.Connected);
    await expect(conn.waitForConnection()).resolves.toBeUndefined();
  });

  it("waitForConnection rejects on Disconnected before connect", async () => {
    const conn = createConnection();
    capturedConfig.statusUpdateCallback(WebsocketStatus.Disconnected);
    await expect(conn.waitForConnection()).rejects.toThrow(
      "WebSocket disconnected before connection was established",
    );
  });

  it("isConnected tracks connection state", () => {
    const conn = createConnection();
    expect(conn.isConnected()).toBe(false);
    capturedConfig.statusUpdateCallback(WebsocketStatus.Connected);
    expect(conn.isConnected()).toBe(true);
    capturedConfig.statusUpdateCallback(WebsocketStatus.Disconnected);
    expect(conn.isConnected()).toBe(false);
  });

  it("getConnectionId tracks assigned identity", () => {
    const conn = createConnection();
    expect(conn.getConnectionId()).toBeNull();
    capturedConfig.assignedIdentity(42);
    expect(conn.getConnectionId()).toBe(42);
  });

  it("sendChatMessage when connected", () => {
    const conn = createConnection();
    capturedConfig.statusUpdateCallback(WebsocketStatus.Connected);
    conn.sendChatMessage("hello");
    expect(mockSendCustomMessage).toHaveBeenCalledWith(
      expect.any(Number),
      JSON.stringify({ message: "hello" }),
    );
  });

  it("sendChatMessage when disconnected does nothing", () => {
    const conn = createConnection();
    conn.sendChatMessage("hello");
    expect(mockSendCustomMessage).not.toHaveBeenCalled();
  });

  it("sendUpdate when connected", () => {
    const conn = createConnection();
    capturedConfig.statusUpdateCallback(WebsocketStatus.Connected);
    const update = {
      position: { x: 1, y: 2, z: 3 },
      rotation: { eulerY: 0 },
      state: 0,
    };
    conn.sendUpdate(update);
    expect(mockSendUpdate).toHaveBeenCalledWith(update);
  });

  it("sendUpdate when disconnected does nothing", () => {
    const conn = createConnection();
    const update = {
      position: { x: 1, y: 2, z: 3 },
      rotation: { eulerY: 0 },
      state: 0,
    };
    conn.sendUpdate(update);
    expect(mockSendUpdate).not.toHaveBeenCalled();
  });

  it("user join/leave tracking via onUpdate", () => {
    const conn = createConnection();
    capturedConfig.statusUpdateCallback(WebsocketStatus.Connected);
    capturedConfig.assignedIdentity(1);

    // Add another user
    capturedConfig.onUpdate({
      removedConnectionIds: new Set(),
      addedConnectionIds: new Map([
        [
          2,
          {
            userState: {
              userId: "user-2",
              username: "Bob",
              characterDescription: null,
              colors: null,
            },
            components: {
              position: { x: 0, y: 0, z: 0 },
              rotation: { eulerY: 0 },
              state: 0,
            },
          },
        ],
      ]),
      updatedUsers: new Map(),
    });

    const others = conn.getOtherUsers();
    expect(others).toHaveLength(1);
    expect(others[0].connectionId).toBe(2);
    expect(others[0].username).toBe("Bob");

    // Remove the user
    capturedConfig.onUpdate({
      removedConnectionIds: new Set([2]),
      addedConnectionIds: new Map(),
      updatedUsers: new Map(),
    });

    expect(conn.getOtherUsers()).toHaveLength(0);
  });

  it("does not track self in otherUsers", () => {
    const conn = createConnection();
    capturedConfig.statusUpdateCallback(WebsocketStatus.Connected);
    capturedConfig.assignedIdentity(1);

    capturedConfig.onUpdate({
      removedConnectionIds: new Set(),
      addedConnectionIds: new Map([
        [
          1,
          {
            userState: {
              userId: "user-1",
              username: "Me",
              characterDescription: null,
              colors: null,
            },
            components: {
              position: { x: 0, y: 0, z: 0 },
              rotation: { eulerY: 0 },
              state: 0,
            },
          },
        ],
      ]),
      updatedUsers: new Map(),
    });

    expect(conn.getOtherUsers()).toHaveLength(0);
  });

  it("chat history management", () => {
    const conn = createConnection();
    capturedConfig.statusUpdateCallback(WebsocketStatus.Connected);
    capturedConfig.assignedIdentity(1);

    // Receive a chat message from another user
    // FROM_SERVER_CHAT_MESSAGE_TYPE = 3
    const chatPayload = JSON.stringify({
      fromConnectionId: 2,
      userId: "user-2",
      message: "hi there",
    });
    capturedConfig.onCustomMessage(3, chatPayload);

    const history = conn.getChatHistory();
    expect(history).toHaveLength(1);
    expect(history[0].message).toBe("hi there");
    expect(history[0].fromConnectionId).toBe(2);
    expect(history[0].userId).toBe("user-2");
  });

  it("getChatHistory with since filter", () => {
    const conn = createConnection();
    capturedConfig.statusUpdateCallback(WebsocketStatus.Connected);
    capturedConfig.assignedIdentity(1);

    const now = Date.now();
    capturedConfig.onCustomMessage(
      3,
      JSON.stringify({ fromConnectionId: 2, userId: "user-2", message: "old" }),
    );

    const future = now + 100000;
    const history = conn.getChatHistory(future);
    expect(history).toHaveLength(0);

    const allHistory = conn.getChatHistory(0);
    expect(allHistory).toHaveLength(1);
  });

  it("event listener add/remove", () => {
    const conn = createConnection();
    const listener = jest.fn();
    conn.addEventListener(listener);

    capturedConfig.statusUpdateCallback(WebsocketStatus.Connected);
    expect(listener).toHaveBeenCalledWith({ type: "connected" });

    conn.removeEventListener(listener);
    listener.mockClear();

    capturedConfig.statusUpdateCallback(WebsocketStatus.Disconnected);
    expect(listener).not.toHaveBeenCalled();
  });

  it("removeEventListener for non-existent listener is safe", () => {
    const conn = createConnection();
    const listener = jest.fn();
    expect(() => conn.removeEventListener(listener)).not.toThrow();
  });

  it("server error handling — auth failed", async () => {
    const conn = createConnection();
    capturedConfig.onServerError({
      errorType: "USER_AUTHENTICATION_FAILED",
      message: "bad token",
    });
    await expect(conn.waitForConnection()).rejects.toThrow("Authentication failed");
  });

  it("server error handling — connection limit", async () => {
    const conn = createConnection();
    capturedConfig.onServerError({
      errorType: "CONNECTION_LIMIT_REACHED",
      message: "too many",
    });
    await expect(conn.waitForConnection()).rejects.toThrow("Connection limit reached");
  });

  it("server error handling — shutdown", async () => {
    const conn = createConnection();
    capturedConfig.onServerError({
      errorType: "SERVER_SHUTDOWN",
      message: "shutting down",
    });
    await expect(conn.waitForConnection()).rejects.toThrow("Server shutting down");
  });

  it("server error emits event", () => {
    const conn = createConnection();
    // Prevent unhandled promise rejection from rejectConnect
    conn.waitForConnection().catch(() => {});
    const listener = jest.fn();
    conn.addEventListener(listener);

    capturedConfig.onServerError({
      errorType: "UNKNOWN",
      message: "something",
    });

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "server_error",
        errorType: "UNKNOWN",
        message: "something",
      }),
    );
  });

  it("updateUsername delegates to client", () => {
    const conn = createConnection();
    conn.updateUsername("NewName");
    expect(mockUpdateUsername).toHaveBeenCalledWith("NewName");
  });

  it("updateCharacterDescription delegates to client", () => {
    const conn = createConnection();
    const desc = { meshFileUrl: "test.glb" };
    conn.updateCharacterDescription(desc);
    expect(mockUpdateCharacterDescription).toHaveBeenCalledWith(desc);
  });

  it("updateColors delegates to client", () => {
    const conn = createConnection();
    const colors: Array<[number, number, number]> = [[1, 0, 0]];
    conn.updateColors(colors);
    expect(mockUpdateColors).toHaveBeenCalledWith(colors);
  });

  it("stop delegates to client", () => {
    const conn = createConnection();
    conn.stop();
    expect(mockStop).toHaveBeenCalled();
  });

  it("reconnecting emits event", () => {
    const conn = createConnection();
    capturedConfig.statusUpdateCallback(WebsocketStatus.Connected);
    const listener = jest.fn();
    conn.addEventListener(listener);

    capturedConfig.statusUpdateCallback(WebsocketStatus.Reconnecting);

    const events = listener.mock.calls.map((c) => (c[0] as WorldEvent).type);
    expect(events).toContain("reconnecting");
    expect(events).toContain("disconnected");
  });

  it("world config receipt and waitForWorldConfig", async () => {
    const conn = createConnection();
    capturedConfig.statusUpdateCallback(WebsocketStatus.Connected);

    const configPromise = conn.waitForWorldConfig(5000);

    // FROM_SERVER_WORLD_CONFIG_MESSAGE_TYPE = 4
    capturedConfig.onCustomMessage(4, JSON.stringify({ enableChat: false }));

    const result = await configPromise;
    expect(result).toEqual({ enableChat: false });
    expect(conn.getWorldConfig()).toEqual({ enableChat: false });
  });

  it("waitForWorldConfig returns cached config immediately", async () => {
    const conn = createConnection();
    capturedConfig.statusUpdateCallback(WebsocketStatus.Connected);

    // Receive config first
    // FROM_SERVER_WORLD_CONFIG_MESSAGE_TYPE = 4
    capturedConfig.onCustomMessage(4, JSON.stringify({ enableChat: true }));

    // Then wait — should resolve immediately
    const result = await conn.waitForWorldConfig(1000);
    expect(result).toEqual({ enableChat: true });
  });

  it("waitForWorldConfig timeout returns null", async () => {
    jest.useFakeTimers();
    const conn = createConnection();
    capturedConfig.statusUpdateCallback(WebsocketStatus.Connected);

    const configPromise = conn.waitForWorldConfig(100);
    jest.advanceTimersByTime(200);

    const result = await configPromise;
    expect(result).toBeNull();

    jest.useRealTimers();
  });

  it("sendCustomMessage when connected", () => {
    const conn = createConnection();
    capturedConfig.statusUpdateCallback(WebsocketStatus.Connected);
    conn.sendCustomMessage(99, "custom data");
    expect(mockSendCustomMessage).toHaveBeenCalledWith(99, "custom data");
  });

  it("sendCustomMessage when disconnected does nothing", () => {
    const conn = createConnection();
    conn.sendCustomMessage(99, "custom data");
    expect(mockSendCustomMessage).not.toHaveBeenCalled();
  });

  it("server broadcast message handling", () => {
    const conn = createConnection();
    capturedConfig.statusUpdateCallback(WebsocketStatus.Connected);
    const listener = jest.fn();
    conn.addEventListener(listener);

    // FROM_SERVER_BROADCAST_MESSAGE_TYPE = 1
    capturedConfig.onCustomMessage(
      1,
      JSON.stringify({ broadcastType: "test_broadcast", payload: { key: "value" } }),
    );

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "server_broadcast",
        broadcastType: "test_broadcast",
        payload: { key: "value" },
      }),
    );
  });

  it("unrecognised custom message type warns", () => {
    const conn = createConnection();
    capturedConfig.statusUpdateCallback(WebsocketStatus.Connected);
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

    capturedConfig.onCustomMessage(999, "unknown");
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("999"));
    warnSpy.mockRestore();
  });

  it("identity_assigned event emitted", () => {
    const conn = createConnection();
    const listener = jest.fn();
    conn.addEventListener(listener);
    capturedConfig.assignedIdentity(42);

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ type: "identity_assigned", connectionId: 42 }),
    );
  });

  it("chat history capped at MAX_CHAT_HISTORY", () => {
    const conn = createConnection();
    capturedConfig.statusUpdateCallback(WebsocketStatus.Connected);
    capturedConfig.assignedIdentity(1);

    // Push 110 messages (over the 100 cap)
    for (let i = 0; i < 110; i++) {
      capturedConfig.onCustomMessage(
        3,
        JSON.stringify({ fromConnectionId: 2, userId: "user-2", message: `msg-${i}` }),
      );
    }

    const history = conn.getChatHistory();
    expect(history.length).toBeLessThanOrEqual(100);
    // The first messages should have been shifted out
    expect(history[0].message).toBe("msg-10");
  });

  it("chat message from self uses own username", () => {
    const conn = createConnection({
      url: "ws://localhost:8080/ws",
      sessionToken: "test-token",
      websocketFactory: jest.fn() as any,
      initialUserState: {
        userId: "my-user-id",
        username: "MyName",
        characterDescription: null,
        colors: null,
      },
    });
    capturedConfig.statusUpdateCallback(WebsocketStatus.Connected);
    capturedConfig.assignedIdentity(1);

    capturedConfig.onCustomMessage(
      3,
      JSON.stringify({ fromConnectionId: 1, userId: "my-user-id", message: "self msg" }),
    );

    const history = conn.getChatHistory();
    expect(history[0].username).toBe("MyName");
  });

  it("user_joined event emitted", () => {
    const conn = createConnection();
    capturedConfig.statusUpdateCallback(WebsocketStatus.Connected);
    capturedConfig.assignedIdentity(1);
    const listener = jest.fn();
    conn.addEventListener(listener);

    capturedConfig.onUpdate({
      removedConnectionIds: new Set(),
      addedConnectionIds: new Map([
        [
          3,
          {
            userState: {
              userId: "user-3",
              username: "Carol",
              characterDescription: null,
              colors: null,
            },
            components: {
              position: { x: 5, y: 0, z: 5 },
              rotation: { eulerY: 0 },
              state: 0,
            },
          },
        ],
      ]),
      updatedUsers: new Map(),
    });

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "user_joined",
        connectionId: 3,
        userId: "user-3",
        username: "Carol",
      }),
    );
  });

  it("user_left event emitted", () => {
    const conn = createConnection();
    capturedConfig.statusUpdateCallback(WebsocketStatus.Connected);
    capturedConfig.assignedIdentity(1);

    // Add user first
    capturedConfig.onUpdate({
      removedConnectionIds: new Set(),
      addedConnectionIds: new Map([
        [
          2,
          {
            userState: {
              userId: "user-2",
              username: "Bob",
              characterDescription: null,
              colors: null,
            },
            components: {
              position: { x: 0, y: 0, z: 0 },
              rotation: { eulerY: 0 },
              state: 0,
            },
          },
        ],
      ]),
      updatedUsers: new Map(),
    });

    const listener = jest.fn();
    conn.addEventListener(listener);

    capturedConfig.onUpdate({
      removedConnectionIds: new Set([2]),
      addedConnectionIds: new Map(),
      updatedUsers: new Map(),
    });

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "user_left",
        connectionId: 2,
        userId: "user-2",
        username: "Bob",
      }),
    );
  });

  it("updated user without existing entry creates new entry", () => {
    const conn = createConnection();
    capturedConfig.statusUpdateCallback(WebsocketStatus.Connected);
    capturedConfig.assignedIdentity(1);

    capturedConfig.onUpdate({
      removedConnectionIds: new Set(),
      addedConnectionIds: new Map(),
      updatedUsers: new Map([
        [
          7,
          {
            userState: { username: "New" },
            components: {
              position: { x: 5, y: 5, z: 5 },
              rotation: { eulerY: 0 },
              state: 0,
            },
          },
        ],
      ]),
    });

    const others = conn.getOtherUsers();
    expect(others).toHaveLength(1);
    expect(others[0].connectionId).toBe(7);
    expect(others[0].username).toBe("New");
  });

  it("server shutdown error after connected emits event without rejecting", () => {
    const conn = createConnection();
    capturedConfig.statusUpdateCallback(WebsocketStatus.Connected);
    const listener = jest.fn();
    conn.addEventListener(listener);

    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    capturedConfig.onServerError({
      errorType: "SERVER_SHUTDOWN",
      message: "going down",
    });

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ type: "server_error", errorType: "SERVER_SHUTDOWN" }),
    );
    errorSpy.mockRestore();
  });

  it("network_update event emitted", () => {
    const conn = createConnection();
    capturedConfig.statusUpdateCallback(WebsocketStatus.Connected);
    capturedConfig.assignedIdentity(1);
    const listener = jest.fn();
    conn.addEventListener(listener);

    const update = {
      removedConnectionIds: new Set<number>(),
      addedConnectionIds: new Map(),
      updatedUsers: new Map(),
    };
    capturedConfig.onUpdate(update);

    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ type: "network_update" }));
  });

  it("getWorldConfig returns null when no config received", () => {
    const conn = createConnection();
    expect(conn.getWorldConfig()).toBeNull();
  });

  it("updateUsername stores new username for chat attribution", () => {
    const conn = createConnection();
    capturedConfig.statusUpdateCallback(WebsocketStatus.Connected);
    capturedConfig.assignedIdentity(1);

    conn.updateUsername("NewName");

    // Self chat should use the new name
    capturedConfig.onCustomMessage(
      3,
      JSON.stringify({ fromConnectionId: 1, userId: "", message: "test" }),
    );
    const history = conn.getChatHistory();
    expect(history[0].username).toBe("NewName");
  });

  it("user state updates are tracked", () => {
    const conn = createConnection();
    capturedConfig.statusUpdateCallback(WebsocketStatus.Connected);
    capturedConfig.assignedIdentity(1);

    // Add user
    capturedConfig.onUpdate({
      removedConnectionIds: new Set(),
      addedConnectionIds: new Map([
        [
          5,
          {
            userState: {
              userId: "user-5",
              username: "Alice",
              characterDescription: null,
              colors: null,
            },
            components: {
              position: { x: 0, y: 0, z: 0 },
              rotation: { eulerY: 0 },
              state: 0,
            },
          },
        ],
      ]),
      updatedUsers: new Map(),
    });

    // Update user
    capturedConfig.onUpdate({
      removedConnectionIds: new Set(),
      addedConnectionIds: new Map(),
      updatedUsers: new Map([
        [
          5,
          {
            userState: { username: "Alice Updated" },
            components: {
              position: { x: 10, y: 0, z: 0 },
              rotation: { eulerY: 0 },
              state: 0,
            },
          },
        ],
      ]),
    });

    const others = conn.getOtherUsers();
    expect(others[0].username).toBe("Alice Updated");
    expect(others[0].position.x).toBe(10);
  });
});
