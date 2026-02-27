import { jest } from "@jest/globals";
import {
  DeltaNetErrorMessage,
  DeltaNetInitialCheckoutMessage,
  DeltaNetTick,
  DeltaNetUserIndexMessage,
} from "@mml-io/delta-net-protocol";

import { DeltaNetServer } from "../../src";
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

describe("DeltaNetServer - v0.2 Core Functionality", () => {
  test("handles initial client connection and checkout with v0.2", async () => {
    const doc = new DeltaNetServer();
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

    // Wait for async authentication to complete
    await jest.advanceTimersByTimeAsync(10);
    doc.tick();

    expect(await clientWs.waitForTotalMessageCount(2)).toEqual([
      {
        index: 0,
        type: "userIndex",
      } satisfies DeltaNetUserIndexMessage,
      {
        components: [
          {
            componentId: 1,
            values: new BigInt64Array([1n]),
            deltas: new BigInt64Array([1n]),
          },
        ],
        indicesCount: 1,
        serverTime: expect.any(Number),
        states: [
          {
            stateId: 1,
            values: [new Uint8Array([1, 2, 3])],
          },
        ],
        type: "initialCheckout",
      } satisfies DeltaNetInitialCheckoutMessage,
    ]);
  });

  test("processes basic component and state updates with v0.2", async () => {
    const doc = new DeltaNetServer();
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
    await clientWs.waitForTotalMessageCount(2);

    clientWs.sendToServer({
      type: "setUserComponents",
      components: [[1, 10n]],
      states: [[1, new Uint8Array([4, 5, 6])]],
    });

    doc.tick();

    expect(await clientWs.waitForTotalMessageCount(3, 2)).toEqual([
      {
        componentDeltaDeltas: [
          {
            componentId: 1,
            deltaDeltas: new BigInt64Array([8n]),
          },
        ],
        indicesCount: 1,
        removedIndices: [],
        serverTime: expect.any(Number),
        states: [
          {
            stateId: 1,
            updatedStates: [[0, new Uint8Array([4, 5, 6])]],
          },
        ],
        type: "tick",
      } satisfies DeltaNetTick,
    ]);
  });

  test("coordinates multiple v0.2 clients sharing state", async () => {
    const doc = new DeltaNetServer();
    currentDoc = doc;

    const client1 = new MockWebsocketV02();
    const client2 = new MockWebsocketV02();

    doc.addWebSocket(client1 as unknown as WebSocket);
    doc.addWebSocket(client2 as unknown as WebSocket);

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
      states: [[2, new Uint8Array([2])]],
      token: "test2",
      observer: false,
    });

    await jest.advanceTimersByTimeAsync(10);
    doc.tick();

    await client1.waitForTotalMessageCount(2);
    await client2.waitForTotalMessageCount(2);

    expect(client1.getMessage(0)).toEqual({ index: 0, type: "userIndex" });
    expect(client2.getMessage(0)).toEqual({ index: 1, type: "userIndex" });
  });

  test("cleans up resources when v0.2 clients disconnect", async () => {
    const doc = new DeltaNetServer();
    currentDoc = doc;

    const client1 = new MockWebsocketV02();
    const client2 = new MockWebsocketV02();

    doc.addWebSocket(client1 as unknown as WebSocket);
    doc.addWebSocket(client2 as unknown as WebSocket);

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
      states: [[2, new Uint8Array([2])]],
      token: "test2",
      observer: false,
    });

    await jest.advanceTimersByTimeAsync(10);
    doc.tick();
    await client1.waitForTotalMessageCount(2);
    await client2.waitForTotalMessageCount(2);

    // Disconnect first client
    client1.close();
    doc.removeWebSocket(client1 as unknown as WebSocket);
    doc.tick();

    // Second client should still work normally
    client2.sendToServer({
      type: "setUserComponents",
      components: [[1, 10n]],
      states: [[2, new Uint8Array([3])]],
    });

    doc.tick();

    const messages = await client2.waitForTotalMessageCount(3, 2);
    expect(messages).toHaveLength(1);

    const tickMessage = messages[0] as DeltaNetTick;
    expect(tickMessage.type).toBe("tick");
    expect(tickMessage.componentDeltaDeltas).toHaveLength(1);
    expect(tickMessage).toMatchObject({
      type: "tick",
      componentDeltaDeltas: expect.arrayContaining([
        expect.objectContaining({
          componentId: 1,
          deltaDeltas: expect.any(BigInt64Array),
        }),
      ]),
      indicesCount: 1,
      removedIndices: [0],
      serverTime: expect.any(Number),
    });

    // Cleanup
    client2.close();
    doc.removeWebSocket(client2 as unknown as WebSocket);
  });
});

describe("DeltaNetServer - Mixed v0.1/v0.2 Clients", () => {
  test("serves mixed v0.1 and v0.2 clients correctly", async () => {
    const doc = new DeltaNetServer();
    currentDoc = doc;

    const v01Client = new MockWebsocketV01();
    const v02Client = new MockWebsocketV02();

    doc.addWebSocket(v01Client as unknown as WebSocket);
    doc.addWebSocket(v02Client as unknown as WebSocket);

    v01Client.sendToServer({
      type: "connectUser",
      components: [[1, 1n]],
      states: [[1, new Uint8Array([10])]],
      token: "test-v01",
      observer: false,
    });

    v02Client.sendToServer({
      type: "connectUser",
      components: [[1, 2n]],
      states: [[1, new Uint8Array([20])]],
      token: "test-v02",
      observer: false,
    });

    await jest.advanceTimersByTimeAsync(10);
    doc.tick();

    // Both should get userIndex + initialCheckout
    const v01Messages = await v01Client.waitForTotalMessageCount(2);
    const v02Messages = await v02Client.waitForTotalMessageCount(2);

    // Both should get userIndex
    expect(v01Messages[0]).toEqual({ index: 0, type: "userIndex" });
    expect(v02Messages[0]).toEqual({ index: 1, type: "userIndex" });

    // Both should get initialCheckout with same logical data
    const v01Checkout = v01Messages[1] as DeltaNetInitialCheckoutMessage;
    const v02Checkout = v02Messages[1] as DeltaNetInitialCheckoutMessage;

    expect(v01Checkout.type).toBe("initialCheckout");
    expect(v02Checkout.type).toBe("initialCheckout");
    expect(v01Checkout.indicesCount).toBe(v02Checkout.indicesCount);
    expect(v01Checkout.components.length).toBe(v02Checkout.components.length);

    // Both should see the same component data
    for (let i = 0; i < v01Checkout.components.length; i++) {
      expect(v01Checkout.components[i].componentId).toBe(v02Checkout.components[i].componentId);
      expect(v01Checkout.components[i].values).toEqual(v02Checkout.components[i].values);
      expect(v01Checkout.components[i].deltas).toEqual(v02Checkout.components[i].deltas);
    }

    // Now send a component update from v01 client
    v01Client.sendToServer({
      type: "setUserComponents",
      components: [[1, 100n]],
      states: [],
    });

    doc.tick();

    // Both should receive the tick with updated data
    const v01TickMessages = await v01Client.waitForTotalMessageCount(3, 2);
    const v02TickMessages = await v02Client.waitForTotalMessageCount(3, 2);

    const v01Tick = v01TickMessages[0] as DeltaNetTick;
    const v02Tick = v02TickMessages[0] as DeltaNetTick;

    expect(v01Tick.type).toBe("tick");
    expect(v02Tick.type).toBe("tick");
    expect(v01Tick.indicesCount).toBe(v02Tick.indicesCount);
    expect(v01Tick.componentDeltaDeltas.length).toBe(v02Tick.componentDeltaDeltas.length);

    // Both should see the same decoded delta-deltas
    for (let i = 0; i < v01Tick.componentDeltaDeltas.length; i++) {
      expect(v01Tick.componentDeltaDeltas[i].componentId).toBe(
        v02Tick.componentDeltaDeltas[i].componentId,
      );
      expect(v01Tick.componentDeltaDeltas[i].deltaDeltas).toEqual(
        v02Tick.componentDeltaDeltas[i].deltaDeltas,
      );
    }

    // Cleanup
    v01Client.close();
    v02Client.close();
    doc.removeWebSocket(v01Client as unknown as WebSocket);
    doc.removeWebSocket(v02Client as unknown as WebSocket);
  });

  test("mixed v0.1/v0.2 clients receive cross-protocol state updates", async () => {
    const doc = new DeltaNetServer();
    currentDoc = doc;

    const v01Client = new MockWebsocketV01();
    const v02Client = new MockWebsocketV02();

    doc.addWebSocket(v01Client as unknown as WebSocket);
    doc.addWebSocket(v02Client as unknown as WebSocket);

    v01Client.sendToServer({
      type: "connectUser",
      components: [[1, 1n]],
      states: [[1, new Uint8Array([10])]],
      token: "test-v01",
      observer: false,
    });

    v02Client.sendToServer({
      type: "connectUser",
      components: [[1, 2n]],
      states: [[1, new Uint8Array([20])]],
      token: "test-v02",
      observer: false,
    });

    await jest.advanceTimersByTimeAsync(10);
    doc.tick();

    await v01Client.waitForTotalMessageCount(2);
    await v02Client.waitForTotalMessageCount(2);

    // v0.1 client sends a state update
    v01Client.sendToServer({
      type: "setUserComponents",
      components: [[1, 1n]],
      states: [[1, new Uint8Array([42, 43, 44])]],
    });

    doc.tick();

    // Both clients should receive the state update in the tick
    const v01TickMessages = await v01Client.waitForTotalMessageCount(3, 2);
    const v02TickMessages = await v02Client.waitForTotalMessageCount(3, 2);

    const v01Tick = v01TickMessages[0] as DeltaNetTick;
    const v02Tick = v02TickMessages[0] as DeltaNetTick;

    expect(v01Tick.type).toBe("tick");
    expect(v02Tick.type).toBe("tick");

    // Both should see the same state update
    expect(v01Tick.states).toHaveLength(1);
    expect(v02Tick.states).toHaveLength(1);
    expect(v01Tick.states[0].stateId).toBe(v02Tick.states[0].stateId);
    expect(v01Tick.states[0].updatedStates).toEqual(v02Tick.states[0].updatedStates);
    expect(v01Tick.states[0].updatedStates[0][1]).toEqual(new Uint8Array([42, 43, 44]));

    // Now v0.2 client sends a state update
    v02Client.sendToServer({
      type: "setUserComponents",
      components: [[1, 2n]],
      states: [[1, new Uint8Array([99, 100])]],
    });

    doc.tick();

    const v01TickMessages2 = await v01Client.waitForTotalMessageCount(4, 3);
    const v02TickMessages2 = await v02Client.waitForTotalMessageCount(4, 3);

    const v01Tick2 = v01TickMessages2[0] as DeltaNetTick;
    const v02Tick2 = v02TickMessages2[0] as DeltaNetTick;

    expect(v01Tick2.states).toHaveLength(1);
    expect(v02Tick2.states).toHaveLength(1);
    expect(v01Tick2.states[0].updatedStates).toEqual(v02Tick2.states[0].updatedStates);
    expect(v01Tick2.states[0].updatedStates[0][1]).toEqual(new Uint8Array([99, 100]));

    // Cleanup
    v01Client.close();
    v02Client.close();
    doc.removeWebSocket(v01Client as unknown as WebSocket);
    doc.removeWebSocket(v02Client as unknown as WebSocket);
  });
});

describe("DeltaNetServer - v0.2 Observer Mode", () => {
  test("handles observer connection with v0.2", async () => {
    const doc = new DeltaNetServer();
    currentDoc = doc;

    const observer = new MockWebsocketV02();
    const participant = new MockWebsocketV02();

    doc.addWebSocket(observer as unknown as WebSocket);
    doc.addWebSocket(participant as unknown as WebSocket);

    observer.sendToServer({
      type: "connectUser",
      components: [],
      states: [],
      token: "observer",
      observer: true,
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

    // Observer should only get initial checkout (no userIndex)
    const observerMessages = await observer.waitForTotalMessageCount(1);
    expect(observerMessages[0].type).toBe("initialCheckout");

    // Participant should get userIndex + initialCheckout
    const participantMessages = await participant.waitForTotalMessageCount(2);
    expect(participantMessages[0]).toEqual({ index: 0, type: "userIndex" });
    expect(participantMessages[1].type).toBe("initialCheckout");

    // Observer should see participant's data
    const observerCheckout = observerMessages[0] as DeltaNetInitialCheckoutMessage;
    expect(observerCheckout.components).toHaveLength(1);
    expect(observerCheckout.states).toHaveLength(1);

    // Cleanup
    observer.close();
    participant.close();
    doc.removeWebSocket(observer as unknown as WebSocket);
    doc.removeWebSocket(participant as unknown as WebSocket);
  });

  test("observer receives ticks from participant updates via v0.2", async () => {
    const doc = new DeltaNetServer();
    currentDoc = doc;

    const observer = new MockWebsocketV02();
    const participant = new MockWebsocketV02();

    doc.addWebSocket(observer as unknown as WebSocket);
    doc.addWebSocket(participant as unknown as WebSocket);

    observer.sendToServer({
      type: "connectUser",
      components: [],
      states: [],
      token: "observer",
      observer: true,
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

    await observer.waitForTotalMessageCount(1);
    await participant.waitForTotalMessageCount(2);

    // Participant sends an update
    participant.sendToServer({
      type: "setUserComponents",
      components: [[1, 5n]],
      states: [[1, new Uint8Array([2, 3])]],
    });

    doc.tick();

    // Observer should receive the tick
    const observerTick = await observer.waitForTotalMessageCount(2, 1);
    expect(observerTick).toHaveLength(1);
    const tick = observerTick[0] as DeltaNetTick;
    expect(tick.type).toBe("tick");
    expect(tick.componentDeltaDeltas).toHaveLength(1);
    expect(tick.states).toHaveLength(1);

    // Cleanup
    observer.close();
    participant.close();
    doc.removeWebSocket(observer as unknown as WebSocket);
    doc.removeWebSocket(participant as unknown as WebSocket);
  });

  test("observer cannot send state updates via v0.2", async () => {
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

    // Observer tries to send component/state updates
    observer.sendToServer({
      type: "setUserComponents",
      components: [[1, 2n]],
      states: [[1, new Uint8Array([2])]],
    });

    // Should get an error message
    const errorMessage = observer.getMessage(1) as DeltaNetErrorMessage;
    expect(errorMessage.type).toBe("error");
    expect(errorMessage.errorType).toBe("USER_NETWORKING_UNKNOWN_ERROR");

    // Cleanup
    observer.close();
    doc.removeWebSocket(observer as unknown as WebSocket);
  });
});

describe("DeltaNetServer - v0.2 Error Handling", () => {
  test("rejects duplicate authentication on v0.2", async () => {
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

    // Try to authenticate again
    clientWs.sendToServer({
      type: "connectUser",
      components: [[1, 2n]],
      states: [],
      token: "test",
      observer: false,
    });

    const errorMessage = clientWs.getMessage(2) as DeltaNetErrorMessage;
    expect(errorMessage.type).toBe("error");
    expect(errorMessage.errorType).toBe("USER_ALREADY_AUTHENTICATED");
  });

  test("rejects unauthenticated state updates on v0.2", async () => {
    const doc = new DeltaNetServer();
    currentDoc = doc;

    const clientWs = new MockWebsocketV02();
    doc.addWebSocket(clientWs as unknown as WebSocket);

    // Try to send state update before authenticating
    clientWs.sendToServer({
      type: "setUserComponents",
      components: [[1, 1n]],
      states: [[1, new Uint8Array([1])]],
    });

    const errorMessage = clientWs.getMessage(0) as DeltaNetErrorMessage;
    expect(errorMessage.type).toBe("error");
    expect(errorMessage.errorType).toBe("USER_NOT_AUTHENTICATED");
  });

  test("handles disconnect during v0.2 authentication gracefully", async () => {
    const onJoinerMock = jest.fn(
      () =>
        new Promise<true>((resolve) => {
          setTimeout(() => resolve(true), 100);
        }),
    );

    const doc = new DeltaNetServer({ onJoiner: onJoinerMock });
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

    // Disconnect before authentication completes
    clientWs.close();
    doc.removeWebSocket(clientWs as unknown as WebSocket);

    // Advance past the authentication timeout — should not throw
    await jest.advanceTimersByTimeAsync(200);
    doc.tick();

    expect(onJoinerMock).toHaveBeenCalledTimes(1);
  });
});
