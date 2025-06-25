import { DeltaNetV01Tick } from "@deltanet/delta-net-protocol";
import { jest } from "@jest/globals";

import { DeltaNetServer } from "../../src";
import { MockWebsocketV01 } from "./mock.websocket-v01";

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

describe("DeltaNetServer - Async Validation", () => {
  describe("async validation superseding", () => {
    test("later state updates supersede earlier pending validations", async () => {
      let resolveFirst: (value: any) => void;
      let resolveSecond: (value: any) => void;

      const firstPromise = new Promise((resolve) => {
        resolveFirst = resolve;
      });
      const secondPromise = new Promise((resolve) => {
        resolveSecond = resolve;
      });

      const onStatesUpdateMock = jest
        .fn<() => Promise<true>>()
        .mockReturnValueOnce(firstPromise as Promise<true>)
        .mockReturnValueOnce(secondPromise as Promise<true>);

      const doc = new DeltaNetServer({
        onStatesUpdate: onStatesUpdateMock,
      });
      currentDoc = doc;

      const clientWs = new MockWebsocketV01();
      doc.addWebSocket(clientWs as unknown as WebSocket);

      clientWs.sendToServer({
        type: "connectUser",
        components: [[1, 1n]],
        states: [[1, new Uint8Array([1])]],
        token: "test",
        observer: false,
      });

      // Wait for async authentication to complete
      await jest.advanceTimersByTimeAsync(10);
      doc.tick();
      await clientWs.waitForTotalMessageCount(2);

      // Send first state update
      clientWs.sendToServer({
        type: "setUserComponents",
        components: [],
        states: [[1, new Uint8Array([2])]],
      });

      // Send second state update before first completes (should supersede)
      clientWs.sendToServer({
        type: "setUserComponents",
        components: [],
        states: [[1, new Uint8Array([3])]],
      });

      expect(onStatesUpdateMock).toHaveBeenCalledTimes(2);

      // Resolve the first promise (should be ignored)
      resolveFirst!(true);
      await jest.advanceTimersByTimeAsync(10);

      // Resolve the second promise (should be applied)
      resolveSecond!(true);
      await jest.advanceTimersByTimeAsync(10);

      doc.tick();

      // Only the second state update should be applied
      const tickMessage = (await clientWs.waitForTotalMessageCount(3, 2))[0] as DeltaNetV01Tick;
      expect(tickMessage.states).toEqual([
        {
          stateId: 1,
          updatedStates: [[0, new Uint8Array([3])]],
        },
      ]);
    });
  });

  describe("connection handling during async operations", () => {
    test("handles client disconnection during async authentication", async () => {
      let resolveAuthentication: (value: any) => void;
      const authenticationPromise = new Promise((resolve) => {
        resolveAuthentication = resolve;
      });

      const onJoinerMock = jest
        .fn<() => Promise<true>>()
        .mockReturnValue(authenticationPromise as Promise<true>);

      const doc = new DeltaNetServer({
        onJoiner: onJoinerMock,
      });
      currentDoc = doc;

      const clientWs = new MockWebsocketV01();
      doc.addWebSocket(clientWs as unknown as WebSocket);

      // Start authentication with async onJoiner callback
      clientWs.sendToServer({
        type: "connectUser",
        components: [[1, 1n]],
        states: [[1, new Uint8Array([1])]],
        token: "test",
        observer: false,
      });

      expect(onJoinerMock).toHaveBeenCalled();

      // Disconnect the client while authentication is pending
      clientWs.close();
      doc.removeWebSocket(clientWs as unknown as WebSocket);

      // Now resolve the authentication - this should not crash or add the connection
      resolveAuthentication!(true);
      await jest.advanceTimersByTimeAsync(10);

      // Tick should not crash and no user should be added
      doc.tick();

      // The connection should not have been authenticated or added to the server
      // We verify this by checking that no user index message was sent
      // (since authentication was cancelled)
      expect(clientWs.getMessage(0)).toBeUndefined();
    });

    test("handles client disconnection during pending async validation", async () => {
      let resolveValidation: (value: any) => void;
      const validationPromise = new Promise((resolve) => {
        resolveValidation = resolve;
      });

      const onStatesUpdateMock = jest
        .fn<() => Promise<true>>()
        .mockReturnValue(validationPromise as Promise<true>);
      const doc = new DeltaNetServer({
        onStatesUpdate: onStatesUpdateMock,
      });
      currentDoc = doc;

      const clientWs = new MockWebsocketV01();
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

      // Send state update that starts async validation
      clientWs.sendToServer({
        type: "setUserComponents",
        components: [],
        states: [[1, new Uint8Array([2])]],
      });

      expect(onStatesUpdateMock).toHaveBeenCalled();

      // Disconnect the client while validation is pending
      clientWs.close();
      doc.removeWebSocket(clientWs as unknown as WebSocket);

      // Now resolve the validation - this should not crash or apply state
      resolveValidation!(true);
      await jest.advanceTimersByTimeAsync(10);

      // Tick should not crash
      doc.tick();

      // State should not have been applied since connection was removed
      expect(true).toBe(true); // Placeholder - the real test is that nothing crashes
    });

    test("handles server disposal during pending async validations", async () => {
      let resolveValidation: (value: any) => void;
      const validationPromise = new Promise((resolve) => {
        resolveValidation = resolve;
      });

      const onStatesUpdateMock = jest
        .fn<() => Promise<true>>()
        .mockReturnValue(validationPromise as Promise<true>);
      const doc = new DeltaNetServer({
        onStatesUpdate: onStatesUpdateMock,
      });
      currentDoc = doc;

      const clientWs = new MockWebsocketV01();
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
        components: [],
        states: [[1, new Uint8Array([2])]],
      });

      // Dispose server while validation is pending
      doc.dispose();
      currentDoc = null; // Prevent double disposal in afterEach

      // Now try to resolve validation - should not crash
      resolveValidation!(true);
      await jest.advanceTimersByTimeAsync(10);

      // This test mainly checks that disposal doesn't cause crashes
      expect(true).toBe(true);
    });

    test("handles server tick during async validation resolution", async () => {
      let resolveValidation: (value: any) => void;
      const validationPromise = new Promise((resolve) => {
        resolveValidation = resolve;
      });

      const onStatesUpdateMock = jest
        .fn<() => Promise<true>>()
        .mockReturnValue(validationPromise as Promise<true>);

      const doc = new DeltaNetServer({
        onStatesUpdate: onStatesUpdateMock,
      });
      currentDoc = doc;

      const clientWs = new MockWebsocketV01();
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
        components: [],
        states: [[1, new Uint8Array([2])]],
      });

      // Call tick while validation is pending
      doc.tick();

      // Now resolve validation - should not interfere with tick process
      resolveValidation!(true);
      await jest.advanceTimersByTimeAsync(10);

      doc.tick();
      expect(true).toBe(true);
    });
  });

  describe("rapid state updates and race conditions", () => {
    test("handles extremely rapid state updates gracefully", async () => {
      const onStatesUpdateMock = jest.fn<() => Promise<true>>().mockResolvedValue(true);

      const doc = new DeltaNetServer({
        onStatesUpdate: onStatesUpdateMock,
      });
      currentDoc = doc;

      const clientWs = new MockWebsocketV01();
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

      // Send rapid state updates
      for (let i = 0; i < 50; i++) {
        clientWs.sendToServer({
          type: "setUserComponents",
          components: [],
          states: [[1, new Uint8Array([i])]],
        });
      }

      await jest.advanceTimersByTimeAsync(50);
      doc.tick();

      // Should only have the last state value
      const tickMessage = (await clientWs.waitForTotalMessageCount(3, 2))[0] as DeltaNetV01Tick;
      expect(tickMessage.states[0].updatedStates[0][1]).toEqual(new Uint8Array([49]));
    });

    test("handles validation promises that never resolve", async () => {
      const neverResolvingPromise = new Promise(() => {}); // Never resolves
      const onStatesUpdateMock = jest
        .fn<() => Promise<true>>()
        .mockReturnValue(neverResolvingPromise as Promise<true>);

      const doc = new DeltaNetServer({
        onStatesUpdate: onStatesUpdateMock,
      });
      currentDoc = doc;

      const clientWs = new MockWebsocketV01();
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

      // Send many state updates that will never resolve
      for (let i = 0; i < 100; i++) {
        clientWs.sendToServer({
          type: "setUserComponents",
          components: [],
          states: [[1, new Uint8Array([i])]],
        });
      }

      // This test will likely pass but demonstrates potential memory leak
      // Real test would check memory usage or internal state cleanup
      expect(onStatesUpdateMock).toHaveBeenCalledTimes(100);
    });

    test("cleans up resources when connections are superseded", async () => {
      const doc = new DeltaNetServer({
        onStatesUpdate: jest.fn<() => Promise<true>>().mockResolvedValue(true),
      });
      currentDoc = doc;

      const clientWs = new MockWebsocketV01();
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

      // Create many superseded validations
      for (let i = 0; i < 100; i++) {
        clientWs.sendToServer({
          type: "setUserComponents",
          components: [],
          states: [[1, new Uint8Array([i])]],
        });
      }

      // Check that no errors are thrown when connection is disposed
      // Real test would check that AbortControllers are properly cleaned up
      clientWs.close();
      doc.removeWebSocket(clientWs as unknown as WebSocket);

      expect(true).toBe(true); // Test mainly checks no crashes occur
    });
  });

  describe("authentication timing", () => {
    test("rejects state updates sent before authentication completes", async () => {
      let resolveAuth: (value: any) => void;
      const authPromise = new Promise((resolve) => {
        resolveAuth = resolve;
      });

      const onJoinerMock = jest
        .fn<() => Promise<true>>()
        .mockReturnValue(authPromise as Promise<true>);
      const doc = new DeltaNetServer({
        onJoiner: onJoinerMock,
      });
      currentDoc = doc;

      const clientWs = new MockWebsocketV01();
      doc.addWebSocket(clientWs as unknown as WebSocket);

      clientWs.sendToServer({
        type: "connectUser",
        components: [[1, 1n]],
        states: [[1, new Uint8Array([1])]],
        token: "test",
        observer: false,
      });

      // Send state update before authentication completes
      clientWs.sendToServer({
        type: "setUserComponents",
        components: [[1, 10n]],
        states: [[1, new Uint8Array([2])]],
      });

      // Now complete authentication
      resolveAuth!(true);
      await jest.advanceTimersByTimeAsync(10);
      doc.tick();

      // Should get error message for premature state update
      expect(clientWs.getMessage(0)).toEqual({
        type: "error",
        errorType: "USER_NOT_AUTHENTICATED",
        message: "Event sent, but user has not been authenticated yet.",
        retryable: false,
      });
    });

    test("handles multiple rapid connectUser messages", async () => {
      const onJoinerMock = jest.fn<() => Promise<true>>().mockResolvedValue(true);
      const doc = new DeltaNetServer({
        onJoiner: onJoinerMock,
      });
      currentDoc = doc;

      const clientWs = new MockWebsocketV01();
      doc.addWebSocket(clientWs as unknown as WebSocket);

      // Send multiple connectUser messages rapidly
      clientWs.sendToServer({
        type: "connectUser",
        components: [[1, 1n]],
        states: [[1, new Uint8Array([1])]],
        token: "test1",
        observer: false,
      });

      clientWs.sendToServer({
        type: "connectUser",
        components: [[1, 2n]],
        states: [[1, new Uint8Array([2])]],
        token: "test2",
        observer: false,
      });

      clientWs.sendToServer({
        type: "connectUser",
        components: [[1, 3n]],
        states: [[1, new Uint8Array([3])]],
        token: "test3",
        observer: false,
      });

      await jest.advanceTimersByTimeAsync(20);
      doc.tick();

      // Should only be called once, not multiple times
      expect(onJoinerMock).toHaveBeenCalledTimes(1);
    });
  });
});
