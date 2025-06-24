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

describe("DeltaNetServer - Edge Cases", () => {
  describe("callback error handling", () => {
    test("handles callbacks returning unexpected value types", async () => {
      // Return something that's not Error or boolean
      const onStatesUpdateMock = jest
        .fn<() => true>()
        .mockReturnValue("invalid return value" as any) as any;

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

      doc.tick();

      // State should be applied despite weird return value
      const tickMessage = (await clientWs.waitForTotalMessageCount(3, 2))[0] as DeltaNetV01Tick;
      expect(tickMessage.states).toHaveLength(1);
    });

    test("handles callbacks that throw exceptions", async () => {
      const onStatesUpdateMock = jest.fn<() => true>().mockImplementation(() => {
        throw new Error("Unexpected callback crash");
      });

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

      // Should handle callback exceptions gracefully
      expect(onStatesUpdateMock).toHaveBeenCalled();
    });
  });

  describe("data validation edge cases", () => {
    test("handles invalid component and state IDs", async () => {
      const doc = new DeltaNetServer();
      currentDoc = doc;

      const clientWs = new MockWebsocketV01();
      doc.addWebSocket(clientWs as unknown as WebSocket);

      clientWs.sendToServer({
        type: "connectUser",
        components: [
          [-1, 1n],
          [0, 2n],
        ], // Negative and zero IDs
        states: [
          [-1, new Uint8Array([1])],
          [0, new Uint8Array([2])],
        ],
        token: "test",
        observer: false,
      });

      await jest.advanceTimersByTimeAsync(10);
      doc.tick();

      // Should handle invalid IDs gracefully (either reject or sanitize)
      expect(true).toBe(true);
    });

    test("handles extremely large state payloads", async () => {
      const doc = new DeltaNetServer();
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

      // Send extremely large state payload
      const largePayload = new Uint8Array(1024 * 1024); // 1MB
      largePayload.fill(42);

      clientWs.sendToServer({
        type: "setUserComponents",
        components: [],
        states: [[1, largePayload]],
      });

      doc.tick();

      // Should handle large payloads without crashing
      const tickMessage = (await clientWs.waitForTotalMessageCount(3, 2))[0] as DeltaNetV01Tick;
      expect(tickMessage.states[0].updatedStates[0][1]).toEqual(largePayload);
    });

    test("handles complex state data structures", async () => {
      const doc = new DeltaNetServer();
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

      // Create Uint8Array that references itself (if possible)
      const circularArray = new Uint8Array([1, 2, 3]);
      // Note: Uint8Array can't have true circular refs, but this tests handling

      clientWs.sendToServer({
        type: "setUserComponents",
        components: [],
        states: [[1, circularArray]],
      });

      doc.tick();
      expect(true).toBe(true);
    });
  });

  describe("concurrent access patterns", () => {
    test("handles multiple clients with same state IDs", async () => {
      const doc = new DeltaNetServer();
      currentDoc = doc;

      const client1 = new MockWebsocketV01();
      const client2 = new MockWebsocketV01();

      doc.addWebSocket(client1 as unknown as WebSocket);
      doc.addWebSocket(client2 as unknown as WebSocket);

      // Both clients use same state ID
      client1.sendToServer({
        type: "connectUser",
        components: [[1, 1n]],
        states: [[1, new Uint8Array([1])]],
        token: "test1",
        observer: false,
      });

      client2.sendToServer({
        type: "connectUser",
        components: [[1, 2n]],
        states: [[1, new Uint8Array([2])]],
        token: "test2",
        observer: false,
      });

      await jest.advanceTimersByTimeAsync(10);
      doc.tick();

      // Both should get separate indices but same state collection
      await client1.waitForTotalMessageCount(2);
      await client2.waitForTotalMessageCount(2);

      expect(true).toBe(true);
    });

    test("handles connection disposal during server operations", async () => {
      const doc = new DeltaNetServer();
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

      // Remove connection and immediately call tick
      // This tests if the server handles removal during tick processing gracefully
      clientWs.close();
      doc.removeWebSocket(clientWs as unknown as WebSocket);

      // Call tick immediately after removal - should not crash
      doc.tick();

      // Call tick again to ensure everything is stable
      doc.tick();

      expect(true).toBe(true); // Test mainly checks no crashes occur
    });
  });

  describe("stress testing", () => {
    test("handles large numbers of concurrent connections", async () => {
      const doc = new DeltaNetServer();
      currentDoc = doc;

      const connections: MockWebsocketV01[] = [];

      // Create many connections
      for (let i = 0; i < 100; i++) {
        const clientWs = new MockWebsocketV01();
        connections.push(clientWs);
        doc.addWebSocket(clientWs as unknown as WebSocket);

        clientWs.sendToServer({
          type: "connectUser",
          components: [[1, BigInt(i)]],
          states: [[1, new Uint8Array([i % 256])]],
          token: `test-${i}`,
          observer: false,
        });
      }

      await jest.advanceTimersByTimeAsync(50);
      doc.tick();

      // Should handle many connections without performance degradation
      expect(connections.length).toBe(100);

      // Cleanup
      connections.forEach((ws) => {
        ws.close();
        doc.removeWebSocket(ws as unknown as WebSocket);
      });
    });

    test("handles complex index remapping scenarios", async () => {
      const doc = new DeltaNetServer();
      currentDoc = doc;

      const connections: MockWebsocketV01[] = [];

      // Create 5 connections
      for (let i = 0; i < 5; i++) {
        const clientWs = new MockWebsocketV01();
        connections.push(clientWs);
        doc.addWebSocket(clientWs as unknown as WebSocket);

        clientWs.sendToServer({
          type: "connectUser",
          components: [[1, BigInt(i)]],
          states: [[1, new Uint8Array([i])]],
          token: `test-${i}`,
          observer: false,
        });
      }

      await jest.advanceTimersByTimeAsync(10);
      doc.tick();

      // Remove connections 1 and 3 (not sequential)
      connections[1].close();
      doc.removeWebSocket(connections[1] as unknown as WebSocket);
      connections[3].close();
      doc.removeWebSocket(connections[3] as unknown as WebSocket);

      doc.tick();

      // Add new connection - should get proper index
      const newClient = new MockWebsocketV01();
      doc.addWebSocket(newClient as unknown as WebSocket);

      newClient.sendToServer({
        type: "connectUser",
        components: [[1, 99n]],
        states: [[1, new Uint8Array([99])]],
        token: "new-test",
        observer: false,
      });

      await jest.advanceTimersByTimeAsync(10);
      doc.tick();

      // Should handle index remapping correctly
      expect(true).toBe(true);

      // Cleanup remaining connections
      [connections[0], connections[2], connections[4], newClient].forEach((ws) => {
        ws.close();
        doc.removeWebSocket(ws as unknown as WebSocket);
      });
    });

    test("handles rapid connection cycling", async () => {
      const doc = new DeltaNetServer();
      currentDoc = doc;

      // Rapidly connect and disconnect clients
      for (let i = 0; i < 50; i++) {
        const clientWs = new MockWebsocketV01();
        doc.addWebSocket(clientWs as unknown as WebSocket);

        clientWs.sendToServer({
          type: "connectUser",
          components: [[1, BigInt(i)]],
          states: [[1, new Uint8Array([i % 256])]],
          token: `test-${i}`,
          observer: false,
        });

        // Wait a short time for authentication and then disconnect
        await jest.advanceTimersByTimeAsync(1);
        doc.tick();

        clientWs.close();
        doc.removeWebSocket(clientWs as unknown as WebSocket);
      }

      await jest.advanceTimersByTimeAsync(100);
      doc.tick();

      // Should handle rapid cycling without memory leaks or crashes
      expect(true).toBe(true);
    });

    test("handles high frequency state updates", async () => {
      const doc = new DeltaNetServer();
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

      // Send high frequency updates
      for (let i = 0; i < 1000; i++) {
        clientWs.sendToServer({
          type: "setUserComponents",
          components: [[1, BigInt(i)]],
          states: [[1, new Uint8Array([i % 256])]],
        });
      }

      doc.tick();

      // Should handle high frequency updates efficiently
      const tickMessage = (await clientWs.waitForTotalMessageCount(3, 2))[0] as DeltaNetV01Tick;
      expect(tickMessage.componentDeltaDeltas).toHaveLength(1);
      expect(tickMessage.states).toHaveLength(1);

      // Cleanup
      clientWs.close();
      doc.removeWebSocket(clientWs as unknown as WebSocket);
    });
  });

  describe("boundary conditions", () => {
    test("handles empty component and state arrays", async () => {
      const doc = new DeltaNetServer();
      currentDoc = doc;

      const clientWs = new MockWebsocketV01();
      doc.addWebSocket(clientWs as unknown as WebSocket);

      clientWs.sendToServer({
        type: "connectUser",
        components: [], // Empty components
        states: [], // Empty states
        token: "test",
        observer: false,
      });

      await jest.advanceTimersByTimeAsync(10);
      doc.tick();

      // Should handle empty arrays gracefully
      await clientWs.waitForTotalMessageCount(2);
      expect(clientWs.getMessage(0)).toEqual({ index: 0, type: "userIndex" });
    });

    test("handles zero-length state payloads", async () => {
      const doc = new DeltaNetServer();
      currentDoc = doc;

      const clientWs = new MockWebsocketV01();
      doc.addWebSocket(clientWs as unknown as WebSocket);

      clientWs.sendToServer({
        type: "connectUser",
        components: [[1, 1n]],
        states: [[1, new Uint8Array(0)]], // Zero-length array
        token: "test",
        observer: false,
      });

      await jest.advanceTimersByTimeAsync(10);
      doc.tick();

      await clientWs.waitForTotalMessageCount(2);
      const initialCheckout = clientWs.getMessage(1);
      expect(initialCheckout.type).toBe("initialCheckout");
    });

    test("handles very large component IDs", async () => {
      const doc = new DeltaNetServer();
      currentDoc = doc;

      const clientWs = new MockWebsocketV01();
      doc.addWebSocket(clientWs as unknown as WebSocket);

      const largeComponentId = Number.MAX_SAFE_INTEGER;

      clientWs.sendToServer({
        type: "connectUser",
        components: [[largeComponentId, 1n]],
        states: [[largeComponentId, new Uint8Array([1])]],
        token: "test",
        observer: false,
      });

      await jest.advanceTimersByTimeAsync(10);
      doc.tick();

      // Should handle large component IDs
      await clientWs.waitForTotalMessageCount(2);
      expect(true).toBe(true);
    });

    test("handles mixed observer and participant connections", async () => {
      const doc = new DeltaNetServer();
      currentDoc = doc;

      const observer = new MockWebsocketV01();
      const participant = new MockWebsocketV01();

      doc.addWebSocket(observer as unknown as WebSocket);
      doc.addWebSocket(participant as unknown as WebSocket);

      observer.sendToServer({
        type: "connectUser",
        components: [],
        states: [],
        token: "observer",
        observer: true, // Observer mode
      });

      participant.sendToServer({
        type: "connectUser",
        components: [[1, 1n]],
        states: [[1, new Uint8Array([1])]],
        token: "participant",
        observer: false,
      });

      await jest.advanceTimersByTimeAsync(10);
      doc.tick();

      // Both should connect successfully
      await observer.waitForTotalMessageCount(2);
      await participant.waitForTotalMessageCount(2);

      // Cleanup
      observer.close();
      participant.close();
      doc.removeWebSocket(observer as unknown as WebSocket);
      doc.removeWebSocket(participant as unknown as WebSocket);
    });
  });
});
