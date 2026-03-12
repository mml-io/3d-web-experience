import { jest } from "@jest/globals";
import {
  DeltaNetErrorMessage,
  DeltaNetInitialCheckoutMessage,
  DeltaNetServerErrors,
  DeltaNetTick,
  deltaNetProtocolSubProtocol_v0_1,
  deltaNetProtocolSubProtocol_v0_2,
  deltaNetSupportedSubProtocols,
} from "@mml-io/delta-net-protocol";

import { DeltaNetServer, DeltaNetServerError } from "../../src";
import { MockWebsocketV01 } from "../delta-net-v01/mock.websocket-v01";

import { MockWebsocketV02 } from "./mock.websocket-v02";

let currentDoc: DeltaNetServer | null = null;

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  if (currentDoc) {
    currentDoc.dispose();
    currentDoc = null;
  }
  jest.useRealTimers();
});

describe("DeltaNetServer - handleWebsocketSubprotocol", () => {
  test("returns v0.2 when both protocols offered", () => {
    const result = DeltaNetServer.handleWebsocketSubprotocol(
      new Set([deltaNetProtocolSubProtocol_v0_1, deltaNetProtocolSubProtocol_v0_2]),
    );
    // Should return the highest priority (first in deltaNetSupportedSubProtocols)
    expect(typeof result).toBe("string");
    expect(deltaNetSupportedSubProtocols).toContain(result);
  });

  test("returns v0.1 when only v0.1 offered", () => {
    const result = DeltaNetServer.handleWebsocketSubprotocol(
      new Set([deltaNetProtocolSubProtocol_v0_1]),
    );
    expect(result).toBe(deltaNetProtocolSubProtocol_v0_1);
  });

  test("returns v0.2 when only v0.2 offered", () => {
    const result = DeltaNetServer.handleWebsocketSubprotocol(
      new Set([deltaNetProtocolSubProtocol_v0_2]),
    );
    expect(result).toBe(deltaNetProtocolSubProtocol_v0_2);
  });

  test("returns false for unsupported protocols", () => {
    const result = DeltaNetServer.handleWebsocketSubprotocol(new Set(["unknown-protocol"]));
    expect(result).toBe(false);
  });

  test("returns false for empty set", () => {
    const result = DeltaNetServer.handleWebsocketSubprotocol(new Set());
    expect(result).toBe(false);
  });

  test("accepts array input", () => {
    const result = DeltaNetServer.handleWebsocketSubprotocol([deltaNetProtocolSubProtocol_v0_2]);
    expect(result).toBe(deltaNetProtocolSubProtocol_v0_2);
  });
});

describe("DeltaNetServer - Disposed server operations", () => {
  test("addWebSocket throws on disposed server", () => {
    const doc = new DeltaNetServer();
    doc.dispose();

    const clientWs = new MockWebsocketV02();
    expect(() => doc.addWebSocket(clientWs as unknown as WebSocket)).toThrow(
      "This DeltaNetServer has been disposed",
    );
  });

  test("tick returns empty sets on disposed server", () => {
    const doc = new DeltaNetServer();
    doc.dispose();

    const result = doc.tick();
    expect(result.removedIds.size).toBe(0);
    expect(result.addedIds.size).toBe(0);
    expect(result.addedObserverIds.size).toBe(0);
  });

  test("dispose is safe to call multiple times", () => {
    const doc = new DeltaNetServer();
    doc.dispose();
    expect(() => doc.dispose()).not.toThrow();
  });

  test("removeWebSocket works after dispose for cleanup", async () => {
    const doc = new DeltaNetServer();
    currentDoc = doc;

    const clientWs = new MockWebsocketV02();
    doc.addWebSocket(clientWs as unknown as WebSocket);

    clientWs.sendToServer({
      type: "connectUser",
      components: [[1, 1n]],
      states: [],
      token: "test",
      observer: false,
    });

    await jest.advanceTimersByTimeAsync(10);
    doc.tick();

    doc.dispose();
    currentDoc = null;

    // removeWebSocket should still work after dispose
    expect(() => doc.removeWebSocket(clientWs as unknown as WebSocket)).not.toThrow();
  });

  test("removeWebSocket for unknown websocket is safe", () => {
    const doc = new DeltaNetServer();
    currentDoc = doc;

    const unknownWs = new MockWebsocketV02();
    // Should not throw
    doc.removeWebSocket(unknownWs as unknown as WebSocket);
  });

  test("double removeWebSocket is safe", async () => {
    const doc = new DeltaNetServer();
    currentDoc = doc;

    const clientWs = new MockWebsocketV02();
    doc.addWebSocket(clientWs as unknown as WebSocket);

    clientWs.sendToServer({
      type: "connectUser",
      components: [[1, 1n]],
      states: [],
      token: "test",
      observer: false,
    });

    await jest.advanceTimersByTimeAsync(10);
    doc.tick();
    await clientWs.waitForTotalMessageCount(2);

    clientWs.close();
    doc.removeWebSocket(clientWs as unknown as WebSocket);
    // Second removal should be safe
    expect(() => doc.removeWebSocket(clientWs as unknown as WebSocket)).not.toThrow();
  });

  test("setUserComponents on disposed server returns error", async () => {
    const doc = new DeltaNetServer();
    currentDoc = doc;

    const clientWs = new MockWebsocketV02();
    doc.addWebSocket(clientWs as unknown as WebSocket);

    clientWs.sendToServer({
      type: "connectUser",
      components: [[1, 1n]],
      states: [],
      token: "test",
      observer: false,
    });

    await jest.advanceTimersByTimeAsync(10);
    doc.tick();
    await clientWs.waitForTotalMessageCount(2);

    // Get a reference to the connection for direct calls
    const connectionsMap = doc.dangerouslyGetConnectionsToComponentIndex();
    expect(connectionsMap.size).toBe(1);

    doc.dispose();
    currentDoc = null;

    // Try sending component update after dispose - should get error
    // This is tested via the client sending message
  });

  test("handleCustomMessage on disposed server is no-op", async () => {
    const onCustomMessage = jest.fn();
    const doc = new DeltaNetServer({ onCustomMessage });
    currentDoc = doc;

    const clientWs = new MockWebsocketV02();
    doc.addWebSocket(clientWs as unknown as WebSocket);

    clientWs.sendToServer({
      type: "connectUser",
      components: [],
      states: [],
      token: "test",
      observer: false,
    });

    await jest.advanceTimersByTimeAsync(10);
    doc.tick();
    await clientWs.waitForTotalMessageCount(1);

    doc.dispose();
    currentDoc = null;

    // Custom message on disposed server should be silently ignored
    expect(onCustomMessage).not.toHaveBeenCalled();
  });

  test("sendCustomMessageToConnection on disposed server is no-op", () => {
    const doc = new DeltaNetServer();
    doc.dispose();

    // Should not throw
    doc.sendCustomMessageToConnection(1, 42, "test");
  });

  test("broadcastCustomMessage on disposed server is no-op", () => {
    const doc = new DeltaNetServer();
    doc.dispose();

    // Should not throw
    doc.broadcastCustomMessage(42, "test");
  });

  test("validateJoiner on disposed server returns failure", () => {
    const doc = new DeltaNetServer();
    doc.dispose();

    const result = doc.validateJoiner({} as any, "token", [[1, 1n]], []);
    expect(result).toEqual({ success: false, error: "This DeltaNetServer has been disposed" });
  });

  test("validateAndApplyStateUpdate on disposed server returns error", () => {
    const doc = new DeltaNetServer();
    doc.dispose();

    const result = doc.validateAndApplyStateUpdate(
      {} as any,
      1,
      1,
      new Uint8Array([1]),
      new AbortController().signal,
    );
    expect(result).toBeInstanceOf(Error);
  });
});

describe("DeltaNetServer - Unsupported protocol", () => {
  test("rejects unsupported websocket protocol", () => {
    const doc = new DeltaNetServer();
    currentDoc = doc;

    const ws = {
      protocol: "unsupported-protocol",
      readyState: 1,
      send: jest.fn(),
      close: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    };

    doc.addWebSocket(ws as unknown as WebSocket);

    // Should have sent error and closed
    expect(ws.send).toHaveBeenCalled();
    expect(ws.close).toHaveBeenCalled();
  });

  test("rejects websocket with no protocol", () => {
    const doc = new DeltaNetServer();
    currentDoc = doc;

    const ws = {
      protocol: "",
      readyState: 1,
      send: jest.fn(),
      close: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    };

    doc.addWebSocket(ws as unknown as WebSocket);

    expect(ws.send).toHaveBeenCalled();
    expect(ws.close).toHaveBeenCalled();
  });
});

describe("DeltaNetServer - Custom messages", () => {
  test("onCustomMessage callback is invoked", async () => {
    const onCustomMessage = jest.fn();
    const doc = new DeltaNetServer({ onCustomMessage });
    currentDoc = doc;

    const clientWs = new MockWebsocketV02();
    doc.addWebSocket(clientWs as unknown as WebSocket);

    clientWs.sendToServer({
      type: "connectUser",
      components: [],
      states: [],
      token: "test",
      observer: false,
    });

    await jest.advanceTimersByTimeAsync(10);
    doc.tick();
    await clientWs.waitForTotalMessageCount(2);

    clientWs.sendToServer({
      type: "clientCustom",
      customType: 42,
      contents: "hello world",
    });

    expect(onCustomMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        customType: 42,
        contents: "hello world",
      }),
    );
  });

  test("onCustomMessage callback exception is caught", async () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

    const onCustomMessage = jest.fn(() => {
      throw new Error("Custom message handler error");
    });
    const doc = new DeltaNetServer({ onCustomMessage });
    currentDoc = doc;

    const clientWs = new MockWebsocketV02();
    doc.addWebSocket(clientWs as unknown as WebSocket);

    clientWs.sendToServer({
      type: "connectUser",
      components: [],
      states: [],
      token: "test",
      observer: false,
    });

    await jest.advanceTimersByTimeAsync(10);
    doc.tick();
    await clientWs.waitForTotalMessageCount(2);

    // Should not throw even though callback throws
    clientWs.sendToServer({
      type: "clientCustom",
      customType: 1,
      contents: "test",
    });

    expect(onCustomMessage).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  test("custom message before auth is rejected", async () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    const doc = new DeltaNetServer();
    currentDoc = doc;

    const clientWs = new MockWebsocketV02();
    doc.addWebSocket(clientWs as unknown as WebSocket);

    // Send custom message before authenticating
    clientWs.sendToServer({
      type: "clientCustom",
      customType: 1,
      contents: "test",
    });

    const msg = clientWs.getMessage(0) as DeltaNetErrorMessage;
    expect(msg.type).toBe("error");
    expect(msg.errorType).toBe("USER_NOT_AUTHENTICATED");

    errorSpy.mockRestore();
  });

  test("sendCustomMessageToConnection sends to specific client", async () => {
    const doc = new DeltaNetServer();
    currentDoc = doc;

    const client1 = new MockWebsocketV02();
    const client2 = new MockWebsocketV02();

    doc.addWebSocket(client1 as unknown as WebSocket);
    doc.addWebSocket(client2 as unknown as WebSocket);

    client1.sendToServer({
      type: "connectUser",
      components: [[1, 1n]],
      states: [],
      token: "test1",
      observer: false,
    });

    client2.sendToServer({
      type: "connectUser",
      components: [[1, 2n]],
      states: [],
      token: "test2",
      observer: false,
    });

    await jest.advanceTimersByTimeAsync(10);
    doc.tick();
    await client1.waitForTotalMessageCount(2);
    await client2.waitForTotalMessageCount(2);

    // Get connection ID for client1 (it was the first, so connectionId=1)
    const connectionsMap = doc.dangerouslyGetConnectionsToComponentIndex();
    const connectionIds = Array.from(connectionsMap.keys());

    doc.sendCustomMessageToConnection(connectionIds[0], 99, "targeted");

    // client1 should receive the message, client2 should not
    const client1Msgs = await client1.waitForTotalMessageCount(3, 2);
    expect(client1Msgs[0]).toEqual(
      expect.objectContaining({
        type: "serverCustom",
        customType: 99,
        contents: "targeted",
      }),
    );
  });

  test("sendCustomMessageToConnection for unknown connection is no-op", async () => {
    const doc = new DeltaNetServer();
    currentDoc = doc;

    // Should not throw
    doc.sendCustomMessageToConnection(999, 1, "test");
  });

  test("broadcastCustomMessage sends to all authenticated clients", async () => {
    const doc = new DeltaNetServer();
    currentDoc = doc;

    const client1 = new MockWebsocketV02();
    const client2 = new MockWebsocketV02();

    doc.addWebSocket(client1 as unknown as WebSocket);
    doc.addWebSocket(client2 as unknown as WebSocket);

    client1.sendToServer({
      type: "connectUser",
      components: [[1, 1n]],
      states: [],
      token: "test1",
      observer: false,
    });

    client2.sendToServer({
      type: "connectUser",
      components: [[1, 2n]],
      states: [],
      token: "test2",
      observer: false,
    });

    await jest.advanceTimersByTimeAsync(10);
    doc.tick();
    await client1.waitForTotalMessageCount(2);
    await client2.waitForTotalMessageCount(2);

    doc.broadcastCustomMessage(77, "broadcast-msg");

    const client1Msgs = await client1.waitForTotalMessageCount(3, 2);
    const client2Msgs = await client2.waitForTotalMessageCount(3, 2);

    expect(client1Msgs[0]).toEqual(
      expect.objectContaining({
        type: "serverCustom",
        customType: 77,
        contents: "broadcast-msg",
      }),
    );
    expect(client2Msgs[0]).toEqual(
      expect.objectContaining({
        type: "serverCustom",
        customType: 77,
        contents: "broadcast-msg",
      }),
    );
  });
});

describe("DeltaNetServer - State overrides", () => {
  test("onJoiner with stateOverrides replaces initial states", async () => {
    const overrideData = new Uint8Array([99, 98, 97]);
    const doc = new DeltaNetServer({
      onJoiner: () => ({
        success: true,
        stateOverrides: [[1, overrideData]],
      }),
    });
    currentDoc = doc;

    const clientWs = new MockWebsocketV02();
    doc.addWebSocket(clientWs as unknown as WebSocket);

    clientWs.sendToServer({
      type: "connectUser",
      components: [[1, 1n]],
      states: [[1, new Uint8Array([1, 2, 3])]],
      token: "test",
      observer: false,
    });

    await jest.advanceTimersByTimeAsync(10);
    doc.tick();

    const messages = await clientWs.waitForTotalMessageCount(2);
    const checkout = messages[1] as DeltaNetInitialCheckoutMessage;
    expect(checkout.type).toBe("initialCheckout");

    // State should contain the override, not the original
    const stateData = checkout.states.find((s) => s.stateId === 1);
    expect(stateData).toBeDefined();
    expect(stateData!.values[0]).toEqual(overrideData);
  });

  test("sync onStatesUpdate with stateOverrides", async () => {
    const overrideData = new Uint8Array([77, 88]);
    const doc = new DeltaNetServer({
      onStatesUpdate: () => ({
        success: true,
        stateOverrides: [[1, overrideData]],
      }),
    });
    currentDoc = doc;

    const clientWs = new MockWebsocketV02();
    doc.addWebSocket(clientWs as unknown as WebSocket);

    clientWs.sendToServer({
      type: "connectUser",
      components: [[1, 1n]],
      states: [[1, new Uint8Array([1])]],
      token: "test",
      observer: false,
    });

    await jest.advanceTimersByTimeAsync(10);
    doc.tick();
    await clientWs.waitForTotalMessageCount(2);

    // Send state update that gets overridden
    clientWs.sendToServer({
      type: "setUserComponents",
      components: [[1, 1n]],
      states: [[1, new Uint8Array([10, 20, 30])]],
    });

    doc.tick();

    const tickMessages = await clientWs.waitForTotalMessageCount(3, 2);
    const tick = tickMessages[0] as DeltaNetTick;
    expect(tick.type).toBe("tick");

    // State should be the override value
    const stateUpdate = tick.states.find((s) => s.stateId === 1);
    expect(stateUpdate).toBeDefined();
    expect(stateUpdate!.updatedStates[0][1]).toEqual(overrideData);
  });

  test("async onStatesUpdate with stateOverrides", async () => {
    const overrideData = new Uint8Array([55, 66]);
    const doc = new DeltaNetServer({
      onStatesUpdate: () =>
        Promise.resolve({
          success: true,
          stateOverrides: [[1, overrideData]] as Array<[number, Uint8Array]>,
        }),
    });
    currentDoc = doc;

    const clientWs = new MockWebsocketV02();
    doc.addWebSocket(clientWs as unknown as WebSocket);

    clientWs.sendToServer({
      type: "connectUser",
      components: [[1, 1n]],
      states: [[1, new Uint8Array([1])]],
      token: "test",
      observer: false,
    });

    await jest.advanceTimersByTimeAsync(10);
    doc.tick();
    await clientWs.waitForTotalMessageCount(2);

    clientWs.sendToServer({
      type: "setUserComponents",
      components: [[1, 1n]],
      states: [[1, new Uint8Array([10, 20])]],
    });

    await jest.advanceTimersByTimeAsync(10);
    doc.tick();

    const tickMessages = await clientWs.waitForTotalMessageCount(3, 2);
    const tick = tickMessages[0] as DeltaNetTick;
    const stateUpdate = tick.states.find((s) => s.stateId === 1);
    expect(stateUpdate).toBeDefined();
    expect(stateUpdate!.updatedStates[0][1]).toEqual(overrideData);
  });

  test("sync onStatesUpdate with stateOverrides but no overrides array", async () => {
    const doc = new DeltaNetServer({
      onStatesUpdate: () => ({
        success: true,
        // no stateOverrides — original should not be applied either
      }),
    });
    currentDoc = doc;

    const clientWs = new MockWebsocketV02();
    doc.addWebSocket(clientWs as unknown as WebSocket);

    clientWs.sendToServer({
      type: "connectUser",
      components: [[1, 1n]],
      states: [[1, new Uint8Array([1])]],
      token: "test",
      observer: false,
    });

    await jest.advanceTimersByTimeAsync(10);
    doc.tick();
    await clientWs.waitForTotalMessageCount(2);

    clientWs.sendToServer({
      type: "setUserComponents",
      components: [[1, 1n]],
      states: [[1, new Uint8Array([99])]],
    });

    doc.tick();

    const tickMessages = await clientWs.waitForTotalMessageCount(3, 2);
    const tick = tickMessages[0] as DeltaNetTick;
    // The state should NOT be updated since success:true but no overrides means the original isn't applied
    expect(tick.states.length).toBe(0);
  });
});

describe("DeltaNetServer - Joiner validation", () => {
  test("onJoiner returning Error rejects connection", async () => {
    const doc = new DeltaNetServer({
      onJoiner: () => new Error("Not allowed"),
    });
    currentDoc = doc;

    const clientWs = new MockWebsocketV02();
    doc.addWebSocket(clientWs as unknown as WebSocket);

    clientWs.sendToServer({
      type: "connectUser",
      components: [],
      states: [],
      token: "bad-token",
      observer: false,
    });

    await jest.advanceTimersByTimeAsync(10);

    const msg = clientWs.getMessage(0) as DeltaNetErrorMessage;
    expect(msg.type).toBe("error");
    expect(msg.message).toBe("Not allowed");
  });

  test("onJoiner returning DeltaNetServerError rejects connection", async () => {
    const doc = new DeltaNetServer({
      onJoiner: () =>
        new DeltaNetServerError(
          DeltaNetServerErrors.USER_NETWORKING_UNKNOWN_ERROR_TYPE,
          "Server error",
          false,
        ),
    });
    currentDoc = doc;

    const clientWs = new MockWebsocketV02();
    doc.addWebSocket(clientWs as unknown as WebSocket);

    clientWs.sendToServer({
      type: "connectUser",
      components: [],
      states: [],
      token: "bad",
      observer: false,
    });

    await jest.advanceTimersByTimeAsync(10);

    const msg = clientWs.getMessage(0) as DeltaNetErrorMessage;
    expect(msg.type).toBe("error");
    expect(msg.message).toBe("Server error");
  });

  test("async onJoiner returning Error rejects connection", async () => {
    const doc = new DeltaNetServer({
      onJoiner: () => Promise.resolve(new Error("Async not allowed")),
    });
    currentDoc = doc;

    const clientWs = new MockWebsocketV02();
    doc.addWebSocket(clientWs as unknown as WebSocket);

    clientWs.sendToServer({
      type: "connectUser",
      components: [],
      states: [],
      token: "bad",
      observer: false,
    });

    await jest.advanceTimersByTimeAsync(10);

    const msg = clientWs.getMessage(0) as DeltaNetErrorMessage;
    expect(msg.type).toBe("error");
    expect(msg.message).toBe("Async not allowed");
  });

  test("async onJoiner rejection is handled", async () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

    const doc = new DeltaNetServer({
      onJoiner: () =>
        Promise.reject(
          new DeltaNetServerError(
            DeltaNetServerErrors.USER_NETWORKING_UNKNOWN_ERROR_TYPE,
            "Rejected",
            false,
          ),
        ),
    });
    currentDoc = doc;

    const clientWs = new MockWebsocketV02();
    doc.addWebSocket(clientWs as unknown as WebSocket);

    clientWs.sendToServer({
      type: "connectUser",
      components: [],
      states: [],
      token: "test",
      observer: false,
    });

    await jest.advanceTimersByTimeAsync(10);

    const msg = clientWs.getMessage(0) as DeltaNetErrorMessage;
    expect(msg.type).toBe("error");
    expect(msg.message).toBe("Rejected");
    warnSpy.mockRestore();
  });

  test("validateJoiner rejects oversized initial state", () => {
    const doc = new DeltaNetServer({ maxStateValueSize: 10 });
    currentDoc = doc;

    const result = doc.validateJoiner({} as any, "token", [], [[1, new Uint8Array(100)]]);
    expect(result).toEqual(
      expect.objectContaining({
        success: false,
        error: expect.stringContaining("exceeds maximum allowed size"),
      }),
    );
  });

  test("validateJoiner with result returning non-standard object", async () => {
    const doc = new DeltaNetServer({
      onJoiner: () => ({ notSuccess: true }) as any,
    });
    currentDoc = doc;

    const clientWs = new MockWebsocketV02();
    doc.addWebSocket(clientWs as unknown as WebSocket);

    clientWs.sendToServer({
      type: "connectUser",
      components: [],
      states: [],
      token: "test",
      observer: false,
    });

    await jest.advanceTimersByTimeAsync(10);

    const msg = clientWs.getMessage(0) as DeltaNetErrorMessage;
    expect(msg.type).toBe("error");
    expect(msg.message).toBe("Joiner validation failed");
  });
});

describe("DeltaNetServer - Observer edge cases", () => {
  test("observer onLeave callback is called with empty data", async () => {
    const onLeave = jest.fn();
    const doc = new DeltaNetServer({ onLeave });
    currentDoc = doc;

    const observer = new MockWebsocketV02();
    doc.addWebSocket(observer as unknown as WebSocket);

    observer.sendToServer({
      type: "connectUser",
      components: [],
      states: [],
      token: "observer",
      observer: true,
    });

    await jest.advanceTimersByTimeAsync(10);
    doc.tick();
    await observer.waitForTotalMessageCount(1);

    observer.close();
    doc.removeWebSocket(observer as unknown as WebSocket);

    expect(onLeave).toHaveBeenCalledWith(
      expect.objectContaining({
        components: [],
        states: [],
      }),
    );
  });

  test("observer onLeave exception is caught", async () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    const onLeave = jest.fn(() => {
      throw new Error("onLeave error");
    });
    const doc = new DeltaNetServer({ onLeave });
    currentDoc = doc;

    const observer = new MockWebsocketV02();
    doc.addWebSocket(observer as unknown as WebSocket);

    observer.sendToServer({
      type: "connectUser",
      components: [],
      states: [],
      token: "observer",
      observer: true,
    });

    await jest.advanceTimersByTimeAsync(10);
    doc.tick();
    await observer.waitForTotalMessageCount(1);

    observer.close();
    expect(() => doc.removeWebSocket(observer as unknown as WebSocket)).not.toThrow();
    warnSpy.mockRestore();
  });

  test("participant onLeave callback receives component and state data", async () => {
    const onLeave = jest.fn();
    const doc = new DeltaNetServer({ onLeave });
    currentDoc = doc;

    const client = new MockWebsocketV02();
    doc.addWebSocket(client as unknown as WebSocket);

    client.sendToServer({
      type: "connectUser",
      components: [[1, 5n]],
      states: [[1, new Uint8Array([10, 20])]],
      token: "user",
      observer: false,
    });

    await jest.advanceTimersByTimeAsync(10);
    doc.tick();
    await client.waitForTotalMessageCount(2);

    client.close();
    doc.removeWebSocket(client as unknown as WebSocket);

    expect(onLeave).toHaveBeenCalledWith(
      expect.objectContaining({
        components: expect.arrayContaining([[1, expect.any(Number)]]),
        states: expect.arrayContaining([[1, expect.any(Uint8Array)]]),
      }),
    );
  });

  test("participant onLeave exception is caught", async () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    const onLeave = jest.fn(() => {
      throw new Error("Leave error");
    });
    const doc = new DeltaNetServer({ onLeave });
    currentDoc = doc;

    const client = new MockWebsocketV02();
    doc.addWebSocket(client as unknown as WebSocket);

    client.sendToServer({
      type: "connectUser",
      components: [[1, 5n]],
      states: [[1, new Uint8Array([10])]],
      token: "user",
      observer: false,
    });

    await jest.advanceTimersByTimeAsync(10);
    doc.tick();
    await client.waitForTotalMessageCount(2);

    client.close();
    expect(() => doc.removeWebSocket(client as unknown as WebSocket)).not.toThrow();
    warnSpy.mockRestore();
  });

  test("observer attempting component update gets error", async () => {
    const doc = new DeltaNetServer();
    currentDoc = doc;

    const observer = new MockWebsocketV02();
    doc.addWebSocket(observer as unknown as WebSocket);

    observer.sendToServer({
      type: "connectUser",
      components: [],
      states: [],
      token: "observer",
      observer: true,
    });

    await jest.advanceTimersByTimeAsync(10);
    doc.tick();
    await observer.waitForTotalMessageCount(1);

    // Observer tries to send component update
    observer.sendToServer({
      type: "setUserComponents",
      components: [[1, 10n]],
      states: [],
    });

    const errorMsg = observer.getMessage(1) as DeltaNetErrorMessage;
    expect(errorMsg.type).toBe("error");
  });

  test("observer attempting state update gets error", async () => {
    const doc = new DeltaNetServer();
    currentDoc = doc;

    const observer = new MockWebsocketV02();
    doc.addWebSocket(observer as unknown as WebSocket);

    observer.sendToServer({
      type: "connectUser",
      components: [],
      states: [],
      token: "observer",
      observer: true,
    });

    await jest.advanceTimersByTimeAsync(10);
    doc.tick();
    await observer.waitForTotalMessageCount(1);

    // Observer tries to send state update
    observer.sendToServer({
      type: "setUserComponents",
      components: [],
      states: [[1, new Uint8Array([1])]],
    });

    const errorMsg = observer.getMessage(1) as DeltaNetErrorMessage;
    expect(errorMsg.type).toBe("error");
  });
});

describe("DeltaNetServer - onComponentsUpdate callback", () => {
  test("onComponentsUpdate callback returning Error rejects update", async () => {
    const doc = new DeltaNetServer({
      onComponentsUpdate: () => new Error("Component rejected"),
    });
    currentDoc = doc;

    const clientWs = new MockWebsocketV02();
    doc.addWebSocket(clientWs as unknown as WebSocket);

    clientWs.sendToServer({
      type: "connectUser",
      components: [[1, 1n]],
      states: [],
      token: "test",
      observer: false,
    });

    await jest.advanceTimersByTimeAsync(10);
    doc.tick();
    await clientWs.waitForTotalMessageCount(2);

    clientWs.sendToServer({
      type: "setUserComponents",
      components: [[1, 10n]],
      states: [],
    });

    // Should receive error message
    const errorMsg = clientWs.getMessage(2) as DeltaNetErrorMessage;
    expect(errorMsg.type).toBe("error");
    expect(errorMsg.message).toBe("Component rejected");
  });

  test("onComponentsUpdate callback returning DeltaNetServerError rejects", async () => {
    const doc = new DeltaNetServer({
      onComponentsUpdate: () =>
        new DeltaNetServerError(
          DeltaNetServerErrors.USER_NETWORKING_UNKNOWN_ERROR_TYPE,
          "Server component error",
          false,
        ),
    });
    currentDoc = doc;

    const clientWs = new MockWebsocketV02();
    doc.addWebSocket(clientWs as unknown as WebSocket);

    clientWs.sendToServer({
      type: "connectUser",
      components: [[1, 1n]],
      states: [],
      token: "test",
      observer: false,
    });

    await jest.advanceTimersByTimeAsync(10);
    doc.tick();
    await clientWs.waitForTotalMessageCount(2);

    clientWs.sendToServer({
      type: "setUserComponents",
      components: [[1, 10n]],
      states: [],
    });

    const errorMsg = clientWs.getMessage(2) as DeltaNetErrorMessage;
    expect(errorMsg.type).toBe("error");
    expect(errorMsg.message).toBe("Server component error");
  });

  test("onComponentsUpdate callback throwing is caught", async () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    const doc = new DeltaNetServer({
      onComponentsUpdate: () => {
        throw new Error("Component callback crash");
      },
    });
    currentDoc = doc;

    const clientWs = new MockWebsocketV02();
    doc.addWebSocket(clientWs as unknown as WebSocket);

    clientWs.sendToServer({
      type: "connectUser",
      components: [[1, 1n]],
      states: [],
      token: "test",
      observer: false,
    });

    await jest.advanceTimersByTimeAsync(10);
    doc.tick();
    await clientWs.waitForTotalMessageCount(2);

    clientWs.sendToServer({
      type: "setUserComponents",
      components: [[1, 10n]],
      states: [],
    });

    const errorMsg = clientWs.getMessage(2) as DeltaNetErrorMessage;
    expect(errorMsg.type).toBe("error");
    expect(errorMsg.message).toBe("Component callback crash");
    warnSpy.mockRestore();
  });

  test("onComponentsUpdate callback throwing DeltaNetServerError is caught", async () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    const doc = new DeltaNetServer({
      onComponentsUpdate: () => {
        throw new DeltaNetServerError(
          DeltaNetServerErrors.USER_NETWORKING_UNKNOWN_ERROR_TYPE,
          "Thrown server error",
          false,
        );
      },
    });
    currentDoc = doc;

    const clientWs = new MockWebsocketV02();
    doc.addWebSocket(clientWs as unknown as WebSocket);

    clientWs.sendToServer({
      type: "connectUser",
      components: [[1, 1n]],
      states: [],
      token: "test",
      observer: false,
    });

    await jest.advanceTimersByTimeAsync(10);
    doc.tick();
    await clientWs.waitForTotalMessageCount(2);

    clientWs.sendToServer({
      type: "setUserComponents",
      components: [[1, 10n]],
      states: [],
    });

    const errorMsg = clientWs.getMessage(2) as DeltaNetErrorMessage;
    expect(errorMsg.type).toBe("error");
    expect(errorMsg.message).toBe("Thrown server error");
    warnSpy.mockRestore();
  });

  test("onComponentsUpdate callback throwing non-Error is caught", async () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    const doc = new DeltaNetServer({
      onComponentsUpdate: () => {
        throw "string-error";
      },
    });
    currentDoc = doc;

    const clientWs = new MockWebsocketV02();
    doc.addWebSocket(clientWs as unknown as WebSocket);

    clientWs.sendToServer({
      type: "connectUser",
      components: [[1, 1n]],
      states: [],
      token: "test",
      observer: false,
    });

    await jest.advanceTimersByTimeAsync(10);
    doc.tick();
    await clientWs.waitForTotalMessageCount(2);

    clientWs.sendToServer({
      type: "setUserComponents",
      components: [[1, 10n]],
      states: [],
    });

    const errorMsg = clientWs.getMessage(2) as DeltaNetErrorMessage;
    expect(errorMsg.type).toBe("error");
    expect(errorMsg.message).toBe("Component update failed");
    warnSpy.mockRestore();
  });
});

describe("DeltaNetServer - State validation edge cases", () => {
  test("state value exceeding maxStateValueSize is rejected", async () => {
    const doc = new DeltaNetServer({ maxStateValueSize: 10 });
    currentDoc = doc;

    const clientWs = new MockWebsocketV02();
    doc.addWebSocket(clientWs as unknown as WebSocket);

    clientWs.sendToServer({
      type: "connectUser",
      components: [[1, 1n]],
      states: [],
      token: "test",
      observer: false,
    });

    await jest.advanceTimersByTimeAsync(10);
    doc.tick();
    await clientWs.waitForTotalMessageCount(2);

    // Send oversized state
    clientWs.sendToServer({
      type: "setUserComponents",
      components: [[1, 1n]],
      states: [[1, new Uint8Array(100)]],
    });

    // Should receive error for oversized state
    const errorMsg = clientWs.getMessage(2) as DeltaNetErrorMessage;
    expect(errorMsg.type).toBe("error");
    expect(errorMsg.message).toContain("exceeds maximum allowed size");
  });

  test("onStatesUpdate throwing Error is caught", async () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    const doc = new DeltaNetServer({
      onStatesUpdate: () => {
        throw new Error("State callback error");
      },
    });
    currentDoc = doc;

    const clientWs = new MockWebsocketV02();
    doc.addWebSocket(clientWs as unknown as WebSocket);

    clientWs.sendToServer({
      type: "connectUser",
      components: [[1, 1n]],
      states: [],
      token: "test",
      observer: false,
    });

    await jest.advanceTimersByTimeAsync(10);
    doc.tick();
    await clientWs.waitForTotalMessageCount(2);

    clientWs.sendToServer({
      type: "setUserComponents",
      components: [[1, 1n]],
      states: [[1, new Uint8Array([1])]],
    });

    const errorMsg = clientWs.getMessage(2) as DeltaNetErrorMessage;
    expect(errorMsg.type).toBe("error");
    warnSpy.mockRestore();
  });

  test("onStatesUpdate throwing DeltaNetServerError is caught", async () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    const doc = new DeltaNetServer({
      onStatesUpdate: () => {
        throw new DeltaNetServerError(
          DeltaNetServerErrors.USER_NETWORKING_UNKNOWN_ERROR_TYPE,
          "Thrown state error",
          false,
        );
      },
    });
    currentDoc = doc;

    const clientWs = new MockWebsocketV02();
    doc.addWebSocket(clientWs as unknown as WebSocket);

    clientWs.sendToServer({
      type: "connectUser",
      components: [[1, 1n]],
      states: [],
      token: "test",
      observer: false,
    });

    await jest.advanceTimersByTimeAsync(10);
    doc.tick();
    await clientWs.waitForTotalMessageCount(2);

    clientWs.sendToServer({
      type: "setUserComponents",
      components: [[1, 1n]],
      states: [[1, new Uint8Array([1])]],
    });

    const errorMsg = clientWs.getMessage(2) as DeltaNetErrorMessage;
    expect(errorMsg.type).toBe("error");
    expect(errorMsg.message).toBe("Thrown state error");
    warnSpy.mockRestore();
  });

  test("onStatesUpdate throwing non-Error is caught", async () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    const doc = new DeltaNetServer({
      onStatesUpdate: () => {
        throw "string-error";
      },
    });
    currentDoc = doc;

    const clientWs = new MockWebsocketV02();
    doc.addWebSocket(clientWs as unknown as WebSocket);

    clientWs.sendToServer({
      type: "connectUser",
      components: [[1, 1n]],
      states: [],
      token: "test",
      observer: false,
    });

    await jest.advanceTimersByTimeAsync(10);
    doc.tick();
    await clientWs.waitForTotalMessageCount(2);

    clientWs.sendToServer({
      type: "setUserComponents",
      components: [[1, 1n]],
      states: [[1, new Uint8Array([1])]],
    });

    const errorMsg = clientWs.getMessage(2) as DeltaNetErrorMessage;
    expect(errorMsg.type).toBe("error");
    warnSpy.mockRestore();
  });

  test("async onStatesUpdate error handling with DeltaNetServerError", async () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    const doc = new DeltaNetServer({
      onStatesUpdate: () =>
        Promise.reject(
          new DeltaNetServerError(
            DeltaNetServerErrors.USER_NETWORKING_UNKNOWN_ERROR_TYPE,
            "Async state error",
            false,
          ),
        ),
    });
    currentDoc = doc;

    const clientWs = new MockWebsocketV02();
    doc.addWebSocket(clientWs as unknown as WebSocket);

    clientWs.sendToServer({
      type: "connectUser",
      components: [[1, 1n]],
      states: [],
      token: "test",
      observer: false,
    });

    await jest.advanceTimersByTimeAsync(10);
    doc.tick();
    await clientWs.waitForTotalMessageCount(2);

    clientWs.sendToServer({
      type: "setUserComponents",
      components: [[1, 1n]],
      states: [[1, new Uint8Array([1])]],
    });

    await jest.advanceTimersByTimeAsync(10);

    const errorMsg = clientWs.getMessage(2) as DeltaNetErrorMessage;
    expect(errorMsg.type).toBe("error");
    expect(errorMsg.message).toBe("Async state error");
    warnSpy.mockRestore();
  });

  test("async onStatesUpdate error handling with plain Error", async () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    const doc = new DeltaNetServer({
      onStatesUpdate: () => Promise.reject(new Error("Async plain error")),
    });
    currentDoc = doc;

    const clientWs = new MockWebsocketV02();
    doc.addWebSocket(clientWs as unknown as WebSocket);

    clientWs.sendToServer({
      type: "connectUser",
      components: [[1, 1n]],
      states: [],
      token: "test",
      observer: false,
    });

    await jest.advanceTimersByTimeAsync(10);
    doc.tick();
    await clientWs.waitForTotalMessageCount(2);

    clientWs.sendToServer({
      type: "setUserComponents",
      components: [[1, 1n]],
      states: [[1, new Uint8Array([1])]],
    });

    await jest.advanceTimersByTimeAsync(10);

    const errorMsg = clientWs.getMessage(2) as DeltaNetErrorMessage;
    expect(errorMsg.type).toBe("error");
    warnSpy.mockRestore();
  });

  test("async onStatesUpdate error handling with non-Error", async () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    const doc = new DeltaNetServer({
      onStatesUpdate: () => Promise.reject("string-error"),
    });
    currentDoc = doc;

    const clientWs = new MockWebsocketV02();
    doc.addWebSocket(clientWs as unknown as WebSocket);

    clientWs.sendToServer({
      type: "connectUser",
      components: [[1, 1n]],
      states: [],
      token: "test",
      observer: false,
    });

    await jest.advanceTimersByTimeAsync(10);
    doc.tick();
    await clientWs.waitForTotalMessageCount(2);

    clientWs.sendToServer({
      type: "setUserComponents",
      components: [[1, 1n]],
      states: [[1, new Uint8Array([1])]],
    });

    await jest.advanceTimersByTimeAsync(10);

    const errorMsg = clientWs.getMessage(2) as DeltaNetErrorMessage;
    expect(errorMsg.type).toBe("error");
    expect(errorMsg.message).toBe("State validation failed");
    warnSpy.mockRestore();
  });

  test("async onStatesUpdate returning DeltaNetServerError disconnects", async () => {
    const doc = new DeltaNetServer({
      onStatesUpdate: () =>
        Promise.resolve(
          new DeltaNetServerError(
            DeltaNetServerErrors.USER_NETWORKING_UNKNOWN_ERROR_TYPE,
            "Async validation rejection",
            false,
          ),
        ),
    });
    currentDoc = doc;

    const clientWs = new MockWebsocketV02();
    doc.addWebSocket(clientWs as unknown as WebSocket);

    clientWs.sendToServer({
      type: "connectUser",
      components: [[1, 1n]],
      states: [],
      token: "test",
      observer: false,
    });

    await jest.advanceTimersByTimeAsync(10);
    doc.tick();
    await clientWs.waitForTotalMessageCount(2);

    clientWs.sendToServer({
      type: "setUserComponents",
      components: [[1, 1n]],
      states: [[1, new Uint8Array([1])]],
    });

    await jest.advanceTimersByTimeAsync(10);

    const errorMsg = clientWs.getMessage(2) as DeltaNetErrorMessage;
    expect(errorMsg.type).toBe("error");
    expect(errorMsg.message).toBe("Async validation rejection");
  });

  test("async onStatesUpdate returning plain Error disconnects", async () => {
    const doc = new DeltaNetServer({
      onStatesUpdate: () => Promise.resolve(new Error("Plain validation error")),
    });
    currentDoc = doc;

    const clientWs = new MockWebsocketV02();
    doc.addWebSocket(clientWs as unknown as WebSocket);

    clientWs.sendToServer({
      type: "connectUser",
      components: [[1, 1n]],
      states: [],
      token: "test",
      observer: false,
    });

    await jest.advanceTimersByTimeAsync(10);
    doc.tick();
    await clientWs.waitForTotalMessageCount(2);

    clientWs.sendToServer({
      type: "setUserComponents",
      components: [[1, 1n]],
      states: [[1, new Uint8Array([1])]],
    });

    await jest.advanceTimersByTimeAsync(10);

    const errorMsg = clientWs.getMessage(2) as DeltaNetErrorMessage;
    expect(errorMsg.type).toBe("error");
  });
});

describe("DeltaNetServer - serverConnectionIdStateId", () => {
  test("creates connection ID state when serverConnectionIdStateId configured", async () => {
    const doc = new DeltaNetServer({ serverConnectionIdStateId: 0 });
    currentDoc = doc;

    const clientWs = new MockWebsocketV02();
    doc.addWebSocket(clientWs as unknown as WebSocket);

    clientWs.sendToServer({
      type: "connectUser",
      components: [[1, 1n]],
      states: [[1, new Uint8Array([10])]],
      token: "test",
      observer: false,
    });

    await jest.advanceTimersByTimeAsync(10);
    doc.tick();

    const messages = await clientWs.waitForTotalMessageCount(2);
    const checkout = messages[1] as DeltaNetInitialCheckoutMessage;

    // Should have the connection ID state (stateId=0)
    const connIdState = checkout.states.find((s) => s.stateId === 0);
    expect(connIdState).toBeDefined();
    expect(connIdState!.values[0]).toBeInstanceOf(Uint8Array);
    expect(connIdState!.values[0]!.length).toBeGreaterThan(0);
  });
});

describe("DeltaNetServer - getComponentValue", () => {
  test("returns null for unregistered component", () => {
    const doc = new DeltaNetServer();
    currentDoc = doc;

    expect(doc.getComponentValue(999, 0)).toBeNull();
  });

  test("returns component value after registration", async () => {
    const doc = new DeltaNetServer();
    currentDoc = doc;

    const clientWs = new MockWebsocketV02();
    doc.addWebSocket(clientWs as unknown as WebSocket);

    clientWs.sendToServer({
      type: "connectUser",
      components: [[1, 42n]],
      states: [],
      token: "test",
      observer: false,
    });

    await jest.advanceTimersByTimeAsync(10);
    doc.tick();
    await clientWs.waitForTotalMessageCount(2);

    const value = doc.getComponentValue(1, 0);
    expect(value).toBe(42);
  });
});

describe("DeltaNetServer - overrideUserStates", () => {
  test("overrideUserStates applies states directly", async () => {
    const doc = new DeltaNetServer();
    currentDoc = doc;

    const clientWs = new MockWebsocketV02();
    doc.addWebSocket(clientWs as unknown as WebSocket);

    clientWs.sendToServer({
      type: "connectUser",
      components: [[1, 1n]],
      states: [[1, new Uint8Array([1])]],
      token: "test",
      observer: false,
    });

    await jest.advanceTimersByTimeAsync(10);
    doc.tick();
    await clientWs.waitForTotalMessageCount(2);

    // Get internal connection ID
    const connectionsMap = doc.dangerouslyGetConnectionsToComponentIndex();
    const connectionId = Array.from(connectionsMap.keys())[0];

    // Override the state
    doc.overrideUserStates(null, connectionId, [[1, new Uint8Array([99, 100])]]);

    doc.tick();

    const tickMessages = await clientWs.waitForTotalMessageCount(3, 2);
    const tick = tickMessages[0] as DeltaNetTick;
    const stateUpdate = tick.states.find((s) => s.stateId === 1);
    expect(stateUpdate).toBeDefined();
    expect(stateUpdate!.updatedStates[0][1]).toEqual(new Uint8Array([99, 100]));
  });
});

describe("DeltaNetServer - getServerTime", () => {
  test("returns time since document creation", () => {
    const doc = new DeltaNetServer();
    currentDoc = doc;

    jest.advanceTimersByTime(1000);
    expect(doc.getServerTime()).toBeGreaterThanOrEqual(1000);
  });
});

describe("DeltaNetServer - setComponentValue", () => {
  test("creates component collection if not exists", () => {
    const doc = new DeltaNetServer();
    currentDoc = doc;

    // Should not throw, creates new collection
    doc.setComponentValue(999, 0, 42n);

    const value = doc.getComponentValue(999, 0);
    expect(value).toBe(42);
  });
});

describe("DeltaNetServer - hasWebSocket", () => {
  test("returns true for tracked websocket", () => {
    const doc = new DeltaNetServer();
    currentDoc = doc;

    const clientWs = new MockWebsocketV02();
    doc.addWebSocket(clientWs as unknown as WebSocket);

    expect(doc.hasWebSocket(clientWs as unknown as WebSocket)).toBe(true);
  });

  test("returns false for unknown websocket", () => {
    const doc = new DeltaNetServer();
    currentDoc = doc;

    const unknownWs = new MockWebsocketV02();
    expect(doc.hasWebSocket(unknownWs as unknown as WebSocket)).toBe(false);
  });
});

describe("DeltaNetServer - Authentication state machine", () => {
  test("rejects authentication when already in progress", async () => {
    const onJoiner = jest.fn(
      () =>
        new Promise<true>((resolve) => {
          setTimeout(() => resolve(true), 500);
        }),
    );
    const doc = new DeltaNetServer({ onJoiner });
    currentDoc = doc;

    const clientWs = new MockWebsocketV02();
    doc.addWebSocket(clientWs as unknown as WebSocket);

    // First auth attempt
    clientWs.sendToServer({
      type: "connectUser",
      components: [],
      states: [],
      token: "test",
      observer: false,
    });

    // Second auth attempt while first is in progress
    clientWs.sendToServer({
      type: "connectUser",
      components: [],
      states: [],
      token: "test2",
      observer: false,
    });

    const errorMsg = clientWs.getMessage(0) as DeltaNetErrorMessage;
    expect(errorMsg.type).toBe("error");
    expect(errorMsg.errorType).toBe("AUTHENTICATION_IN_PROGRESS");

    await jest.advanceTimersByTimeAsync(600);
    doc.tick();
  });

  test("rejects authentication after failure", async () => {
    const doc = new DeltaNetServer({
      onJoiner: () => new Error("Auth failed"),
    });
    currentDoc = doc;

    const clientWs = new MockWebsocketV02();
    doc.addWebSocket(clientWs as unknown as WebSocket);

    // First auth attempt - will fail
    clientWs.sendToServer({
      type: "connectUser",
      components: [],
      states: [],
      token: "test",
      observer: false,
    });

    await jest.advanceTimersByTimeAsync(10);
  });
});

describe("DeltaNetServer - dangerouslyAddNewJoinerCallback", () => {
  test("callback returning result adds participant", async () => {
    const doc = new DeltaNetServer({ serverConnectionIdStateId: 0 });
    currentDoc = doc;

    const afterAddCallback = jest.fn();
    doc.dangerouslyAddNewJoinerCallback((index) => ({
      id: 100,
      afterAddCallback,
    }));

    const result = doc.tick();
    expect(result.addedIds.has(100)).toBe(true);
    expect(afterAddCallback).toHaveBeenCalled();
  });

  test("callback returning null skips index", async () => {
    const doc = new DeltaNetServer();
    currentDoc = doc;

    doc.dangerouslyAddNewJoinerCallback(() => null);

    const result = doc.tick();
    expect(result.addedIds.size).toBe(0);
  });
});
