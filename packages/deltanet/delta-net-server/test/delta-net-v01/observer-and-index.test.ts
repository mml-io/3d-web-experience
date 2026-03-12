import { jest } from "@jest/globals";
import { DeltaNetInitialCheckoutMessage, DeltaNetTick } from "@mml-io/delta-net-protocol";

import { DeltaNetServer, onLeaveOptions } from "../../src";

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

describe("DeltaNetServer - Observer and Index Edge Cases", () => {
  describe("observer receives tick updates after joining", () => {
    test("observer receives state updates sent by a participant after initial checkout", async () => {
      const doc = new DeltaNetServer();
      currentDoc = doc;

      const participant = new MockWebsocketV01();
      doc.addWebSocket(participant as unknown as WebSocket);

      // Participant joins first
      participant.sendToServer({
        type: "connectUser",
        components: [[1, 10n]],
        states: [[1, new Uint8Array([1, 2, 3])]],
        token: "participant",
        observer: false,
      });

      await jest.advanceTimersByTimeAsync(10);
      doc.tick();
      await participant.waitForTotalMessageCount(2);

      // Observer joins after participant is established
      const observer = new MockWebsocketV01();
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

      // Observer should get initial checkout with existing participant data
      const observerMessages = await observer.waitForTotalMessageCount(1);
      const observerCheckout = observerMessages[0] as DeltaNetInitialCheckoutMessage;
      expect(observerCheckout.type).toBe("initialCheckout");
      expect(observerCheckout.indicesCount).toBe(1);
      expect(observerCheckout.states).toHaveLength(1);
      expect(observerCheckout.states[0].values[0]).toEqual(new Uint8Array([1, 2, 3]));

      // Now participant sends a state update AFTER observer has connected
      participant.sendToServer({
        type: "setUserComponents",
        components: [[1, 20n]],
        states: [[1, new Uint8Array([4, 5, 6])]],
      });

      doc.tick();

      // Observer should receive a tick with the state update
      const observerTick = (await observer.waitForTotalMessageCount(2, 1))[0] as DeltaNetTick;
      expect(observerTick.type).toBe("tick");
      expect(observerTick.states).toHaveLength(1);
      expect(observerTick.states[0].updatedStates[0][0]).toBe(0); // Index 0 (participant)
      expect(observerTick.states[0].updatedStates[0][1]).toEqual(new Uint8Array([4, 5, 6]));

      // Observer should also see component delta-deltas
      expect(observerTick.componentDeltaDeltas).toHaveLength(1);

      // Cleanup
      observer.close();
      participant.close();
      doc.removeWebSocket(observer as unknown as WebSocket);
      doc.removeWebSocket(participant as unknown as WebSocket);
    });

    test("observer receives tick updates from multiple participants", async () => {
      const doc = new DeltaNetServer();
      currentDoc = doc;

      const participant1 = new MockWebsocketV01();
      const participant2 = new MockWebsocketV01();
      const observer = new MockWebsocketV01();

      doc.addWebSocket(participant1 as unknown as WebSocket);
      doc.addWebSocket(participant2 as unknown as WebSocket);

      // Both participants join
      participant1.sendToServer({
        type: "connectUser",
        components: [[1, 10n]],
        states: [[1, new Uint8Array([10])]],
        token: "p1",
        observer: false,
      });

      participant2.sendToServer({
        type: "connectUser",
        components: [[1, 20n]],
        states: [[1, new Uint8Array([20])]],
        token: "p2",
        observer: false,
      });

      await jest.advanceTimersByTimeAsync(10);
      doc.tick();
      await participant1.waitForTotalMessageCount(2);
      await participant2.waitForTotalMessageCount(2);

      // Observer joins
      doc.addWebSocket(observer as unknown as WebSocket);
      observer.sendToServer({
        type: "connectUser",
        components: [],
        states: [],
        token: "obs",
        observer: true,
      });

      await jest.advanceTimersByTimeAsync(10);
      doc.tick();
      await observer.waitForTotalMessageCount(1);

      // Both participants send updates in the same tick
      participant1.sendToServer({
        type: "setUserComponents",
        components: [],
        states: [[1, new Uint8Array([11])]],
      });

      participant2.sendToServer({
        type: "setUserComponents",
        components: [],
        states: [[1, new Uint8Array([21])]],
      });

      doc.tick();

      // Observer should receive a tick with both participants' updates
      const observerTick = (await observer.waitForTotalMessageCount(2, 1))[0] as DeltaNetTick;
      expect(observerTick.type).toBe("tick");
      expect(observerTick.states).toHaveLength(1);
      expect(observerTick.states[0].updatedStates).toHaveLength(2);

      // Both indices should be present
      const updateIndices = observerTick.states[0].updatedStates.map((u) => u[0]).sort();
      expect(updateIndices).toEqual([0, 1]);

      // Cleanup
      observer.close();
      participant1.close();
      participant2.close();
      doc.removeWebSocket(observer as unknown as WebSocket);
      doc.removeWebSocket(participant1 as unknown as WebSocket);
      doc.removeWebSocket(participant2 as unknown as WebSocket);
    });

    test("observer receives removal tick when participant disconnects", async () => {
      const doc = new DeltaNetServer();
      currentDoc = doc;

      const participant1 = new MockWebsocketV01();
      const participant2 = new MockWebsocketV01();
      const observer = new MockWebsocketV01();

      doc.addWebSocket(participant1 as unknown as WebSocket);
      doc.addWebSocket(participant2 as unknown as WebSocket);

      participant1.sendToServer({
        type: "connectUser",
        components: [[1, 10n]],
        states: [[1, new Uint8Array([10])]],
        token: "p1",
        observer: false,
      });

      participant2.sendToServer({
        type: "connectUser",
        components: [[1, 20n]],
        states: [[1, new Uint8Array([20])]],
        token: "p2",
        observer: false,
      });

      await jest.advanceTimersByTimeAsync(10);
      doc.tick();
      await participant1.waitForTotalMessageCount(2);
      await participant2.waitForTotalMessageCount(2);

      // Observer joins
      doc.addWebSocket(observer as unknown as WebSocket);
      observer.sendToServer({
        type: "connectUser",
        components: [],
        states: [],
        token: "obs",
        observer: true,
      });

      await jest.advanceTimersByTimeAsync(10);
      doc.tick();

      const observerCheckout = (
        await observer.waitForTotalMessageCount(1)
      )[0] as DeltaNetInitialCheckoutMessage;
      expect(observerCheckout.indicesCount).toBe(2);

      // Remove participant1
      participant1.close();
      doc.removeWebSocket(participant1 as unknown as WebSocket);

      doc.tick();

      // Observer should get a tick showing the removal
      const observerTick = (await observer.waitForTotalMessageCount(2, 1))[0] as DeltaNetTick;
      expect(observerTick.type).toBe("tick");
      expect(observerTick.removedIndices).toEqual([0]); // participant1 was at index 0
      expect(observerTick.indicesCount).toBe(1); // Only participant2 remains

      // Cleanup
      observer.close();
      participant2.close();
      doc.removeWebSocket(observer as unknown as WebSocket);
      doc.removeWebSocket(participant2 as unknown as WebSocket);
    });
  });

  describe("observer onLeave fires on disconnect", () => {
    test("onLeave is called with correct connection ID and empty data when observer disconnects", async () => {
      const onLeaveMock = jest.fn();

      const doc = new DeltaNetServer({
        onLeave: onLeaveMock,
      });
      currentDoc = doc;

      const observer = new MockWebsocketV01();
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
      await observer.waitForTotalMessageCount(1); // Initial checkout

      // Disconnect the observer
      observer.close();
      doc.removeWebSocket(observer as unknown as WebSocket);

      // onLeave should have been called for the observer
      expect(onLeaveMock).toHaveBeenCalledTimes(1);
      const leaveCall = onLeaveMock.mock.calls[0][0] as onLeaveOptions;
      expect(leaveCall.components).toEqual([]);
      expect(leaveCall.states).toEqual([]);
      expect(leaveCall.internalConnectionId).toBeDefined();
    });

    test("onLeave fires for both observer and participant when both disconnect", async () => {
      const onLeaveMock = jest.fn();

      const doc = new DeltaNetServer({
        onLeave: onLeaveMock,
      });
      currentDoc = doc;

      const participant = new MockWebsocketV01();
      const observer = new MockWebsocketV01();

      doc.addWebSocket(participant as unknown as WebSocket);
      doc.addWebSocket(observer as unknown as WebSocket);

      participant.sendToServer({
        type: "connectUser",
        components: [[1, 10n]],
        states: [[1, new Uint8Array([5])]],
        token: "participant",
        observer: false,
      });

      observer.sendToServer({
        type: "connectUser",
        components: [],
        states: [],
        token: "observer",
        observer: true,
      });

      await jest.advanceTimersByTimeAsync(10);
      doc.tick();
      await participant.waitForTotalMessageCount(2);
      await observer.waitForTotalMessageCount(1);

      // Disconnect the observer first
      observer.close();
      doc.removeWebSocket(observer as unknown as WebSocket);

      expect(onLeaveMock).toHaveBeenCalledTimes(1);
      const observerLeave = onLeaveMock.mock.calls[0][0] as onLeaveOptions;
      expect(observerLeave.components).toEqual([]);
      expect(observerLeave.states).toEqual([]);

      // Disconnect the participant
      participant.close();
      doc.removeWebSocket(participant as unknown as WebSocket);

      expect(onLeaveMock).toHaveBeenCalledTimes(2);
      const participantLeave = onLeaveMock.mock.calls[1][0] as onLeaveOptions;
      // Participant should have actual component and state data
      expect(participantLeave.components.length).toBeGreaterThan(0);
      expect(participantLeave.states.length).toBeGreaterThan(0);
    });
  });

  describe("removing index 0 shifts all subsequent indices", () => {
    test("removing the first user shifts indices correctly for state updates", async () => {
      const doc = new DeltaNetServer();
      currentDoc = doc;

      const user0 = new MockWebsocketV01();
      const user1 = new MockWebsocketV01();
      const user2 = new MockWebsocketV01();

      doc.addWebSocket(user0 as unknown as WebSocket);
      doc.addWebSocket(user1 as unknown as WebSocket);
      doc.addWebSocket(user2 as unknown as WebSocket);

      user0.sendToServer({
        type: "connectUser",
        components: [[1, 100n]],
        states: [[1, new Uint8Array([0])]],
        token: "user0",
        observer: false,
      });

      user1.sendToServer({
        type: "connectUser",
        components: [[1, 200n]],
        states: [[1, new Uint8Array([1])]],
        token: "user1",
        observer: false,
      });

      user2.sendToServer({
        type: "connectUser",
        components: [[1, 300n]],
        states: [[1, new Uint8Array([2])]],
        token: "user2",
        observer: false,
      });

      await jest.advanceTimersByTimeAsync(10);
      doc.tick();

      await user0.waitForTotalMessageCount(2);
      await user1.waitForTotalMessageCount(2);
      await user2.waitForTotalMessageCount(2);

      // Verify initial indices
      expect(user0.getMessage(0)).toEqual({ index: 0, type: "userIndex" });
      expect(user1.getMessage(0)).toEqual({ index: 1, type: "userIndex" });
      expect(user2.getMessage(0)).toEqual({ index: 2, type: "userIndex" });

      // Remove user0 (index 0)
      user0.close();
      doc.removeWebSocket(user0 as unknown as WebSocket);

      doc.tick();

      // user1 and user2 should receive a tick with user0 removed
      const user1Tick = (await user1.waitForTotalMessageCount(3, 2))[0] as DeltaNetTick;
      expect(user1Tick.removedIndices).toEqual([0]);
      expect(user1Tick.indicesCount).toBe(2);

      // Now user1 is shifted to index 0, user2 is shifted to index 1
      // Send a state update from user1 (formerly index 1, now index 0)
      user1.sendToServer({
        type: "setUserComponents",
        components: [[1, 201n]],
        states: [[1, new Uint8Array([11])]],
      });

      doc.tick();

      // user2 should see the update at the SHIFTED index 0 (user1's new index)
      const user2Tick = (await user2.waitForTotalMessageCount(4, 3))[0] as DeltaNetTick;
      expect(user2Tick.type).toBe("tick");
      expect(user2Tick.states).toHaveLength(1);
      expect(user2Tick.states[0].updatedStates[0][0]).toBe(0); // user1 is now at index 0
      expect(user2Tick.states[0].updatedStates[0][1]).toEqual(new Uint8Array([11]));

      // user1 should also see its own update at index 0
      const user1UpdateTick = (await user1.waitForTotalMessageCount(4, 3))[0] as DeltaNetTick;
      expect(user1UpdateTick.states[0].updatedStates[0][0]).toBe(0);
      expect(user1UpdateTick.states[0].updatedStates[0][1]).toEqual(new Uint8Array([11]));

      // Cleanup
      user1.close();
      user2.close();
      doc.removeWebSocket(user1 as unknown as WebSocket);
      doc.removeWebSocket(user2 as unknown as WebSocket);
    });

    test("removing index 0 and adding a new user assigns correct index", async () => {
      const doc = new DeltaNetServer();
      currentDoc = doc;

      const user0 = new MockWebsocketV01();
      const user1 = new MockWebsocketV01();

      doc.addWebSocket(user0 as unknown as WebSocket);
      doc.addWebSocket(user1 as unknown as WebSocket);

      user0.sendToServer({
        type: "connectUser",
        components: [[1, 100n]],
        states: [[1, new Uint8Array([0])]],
        token: "user0",
        observer: false,
      });

      user1.sendToServer({
        type: "connectUser",
        components: [[1, 200n]],
        states: [[1, new Uint8Array([1])]],
        token: "user1",
        observer: false,
      });

      await jest.advanceTimersByTimeAsync(10);
      doc.tick();
      await user0.waitForTotalMessageCount(2);
      await user1.waitForTotalMessageCount(2);

      // Remove user0 (index 0) and add a new user in the same tick
      user0.close();
      doc.removeWebSocket(user0 as unknown as WebSocket);

      const newUser = new MockWebsocketV01();
      doc.addWebSocket(newUser as unknown as WebSocket);
      newUser.sendToServer({
        type: "connectUser",
        components: [[1, 500n]],
        states: [[1, new Uint8Array([5])]],
        token: "newUser",
        observer: false,
      });

      await jest.advanceTimersByTimeAsync(10);
      doc.tick();

      await newUser.waitForTotalMessageCount(2);

      // user1 was at index 1, shifts to 0 after removal. newUser gets index 1.
      expect(newUser.getMessage(0)).toEqual({ index: 1, type: "userIndex" });

      // Verify newUser's checkout has correct data
      const newUserCheckout = newUser.getMessage(1) as DeltaNetInitialCheckoutMessage;
      expect(newUserCheckout.type).toBe("initialCheckout");
      expect(newUserCheckout.indicesCount).toBe(2);
      // Index 0 should be user1's data (shifted), index 1 should be newUser's data
      expect(newUserCheckout.states[0].values[0]).toEqual(new Uint8Array([1])); // user1
      expect(newUserCheckout.states[0].values[1]).toEqual(new Uint8Array([5])); // newUser

      // Verify user1 received the removal tick
      const user1Tick = (await user1.waitForTotalMessageCount(3, 2))[0] as DeltaNetTick;
      expect(user1Tick.removedIndices).toEqual([0]);
      expect(user1Tick.indicesCount).toBe(2); // user1 + newUser

      // Cleanup
      user1.close();
      newUser.close();
      doc.removeWebSocket(user1 as unknown as WebSocket);
      doc.removeWebSocket(newUser as unknown as WebSocket);
    });

    test("removing index 0 then sending update from last remaining user works", async () => {
      const doc = new DeltaNetServer();
      currentDoc = doc;

      const user0 = new MockWebsocketV01();
      const user1 = new MockWebsocketV01();

      doc.addWebSocket(user0 as unknown as WebSocket);
      doc.addWebSocket(user1 as unknown as WebSocket);

      user0.sendToServer({
        type: "connectUser",
        components: [[1, 100n]],
        states: [[1, new Uint8Array([0])]],
        token: "user0",
        observer: false,
      });

      user1.sendToServer({
        type: "connectUser",
        components: [[1, 200n]],
        states: [[1, new Uint8Array([1])]],
        token: "user1",
        observer: false,
      });

      await jest.advanceTimersByTimeAsync(10);
      doc.tick();
      await user0.waitForTotalMessageCount(2);
      await user1.waitForTotalMessageCount(2);

      // Remove user0
      user0.close();
      doc.removeWebSocket(user0 as unknown as WebSocket);
      doc.tick();

      // user1 receives removal tick
      const user1RemovalTick = (await user1.waitForTotalMessageCount(3, 2))[0] as DeltaNetTick;
      expect(user1RemovalTick.removedIndices).toEqual([0]);
      expect(user1RemovalTick.indicesCount).toBe(1);

      // user1 is now the only user at index 0. Send an update.
      user1.sendToServer({
        type: "setUserComponents",
        components: [[1, 999n]],
        states: [[1, new Uint8Array([99])]],
      });

      doc.tick();

      // user1 should see its own update at index 0
      const user1UpdateTick = (await user1.waitForTotalMessageCount(4, 3))[0] as DeltaNetTick;
      expect(user1UpdateTick.type).toBe("tick");
      expect(user1UpdateTick.states[0].updatedStates[0][0]).toBe(0); // Now at index 0
      expect(user1UpdateTick.states[0].updatedStates[0][1]).toEqual(new Uint8Array([99]));
      expect(user1UpdateTick.indicesCount).toBe(1);

      // Cleanup
      user1.close();
      doc.removeWebSocket(user1 as unknown as WebSocket);
    });
  });

  describe("async auth abort", () => {
    test("closing connection during pending async onJoiner does not crash or add user", async () => {
      let resolveAuth: (value: any) => void;
      const authPromise = new Promise((resolve) => {
        resolveAuth = resolve;
      });

      const onJoinerMock = jest
        .fn<() => Promise<true>>()
        .mockReturnValue(authPromise as Promise<true>);

      const onLeaveMock = jest.fn();

      const doc = new DeltaNetServer({
        onJoiner: onJoinerMock,
        onLeave: onLeaveMock,
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

      // Verify auth started
      expect(onJoinerMock).toHaveBeenCalledTimes(1);

      // Close the connection BEFORE auth resolves
      clientWs.close();
      doc.removeWebSocket(clientWs as unknown as WebSocket);

      // Now resolve authentication - should not crash or add the user
      resolveAuth!(true);
      await jest.advanceTimersByTimeAsync(10);

      // Tick should not crash
      expect(() => doc.tick()).not.toThrow();

      // No messages should have been sent to the closed connection
      expect(clientWs.getMessage(0)).toBeUndefined();

      // A new user should be able to join cleanly
      const newClient = new MockWebsocketV01();
      doc.addWebSocket(newClient as unknown as WebSocket);

      newClient.sendToServer({
        type: "connectUser",
        components: [[1, 2n]],
        states: [[1, new Uint8Array([2])]],
        token: "test2",
        observer: false,
      });

      await jest.advanceTimersByTimeAsync(10);
      doc.tick();

      await newClient.waitForTotalMessageCount(2);
      expect(newClient.getMessage(0)).toEqual({ index: 0, type: "userIndex" });
      expect(newClient.getMessage(1).type).toBe("initialCheckout");

      // Cleanup
      newClient.close();
      doc.removeWebSocket(newClient as unknown as WebSocket);
    });

    test("closing observer connection during pending async onJoiner is handled cleanly", async () => {
      let resolveObserverAuth: (value: any) => void;
      const observerAuthPromise = new Promise((resolve) => {
        resolveObserverAuth = resolve;
      });

      // First call (participant) resolves immediately, second call (observer) is delayed
      const onJoinerMock = jest
        .fn<() => Promise<true> | true>()
        .mockReturnValueOnce(true as any) // participant auth resolves synchronously
        .mockReturnValueOnce(observerAuthPromise as Promise<true>); // observer auth is delayed

      const doc = new DeltaNetServer({
        onJoiner: onJoinerMock,
      });
      currentDoc = doc;

      // Add a participant first so there is state to observe
      const participant = new MockWebsocketV01();
      doc.addWebSocket(participant as unknown as WebSocket);
      participant.sendToServer({
        type: "connectUser",
        components: [[1, 10n]],
        states: [[1, new Uint8Array([10])]],
        token: "participant",
        observer: false,
      });

      await jest.advanceTimersByTimeAsync(10);
      doc.tick();
      await participant.waitForTotalMessageCount(2);

      // Now add an observer with delayed auth
      const observer = new MockWebsocketV01();
      doc.addWebSocket(observer as unknown as WebSocket);
      observer.sendToServer({
        type: "connectUser",
        components: [],
        states: [],
        token: "observer",
        observer: true,
      });

      // Auth should be pending for observer
      expect(onJoinerMock).toHaveBeenCalledTimes(2);

      // Close observer before auth resolves
      observer.close();
      doc.removeWebSocket(observer as unknown as WebSocket);

      // Resolve observer auth after connection is closed
      resolveObserverAuth!(true);
      await jest.advanceTimersByTimeAsync(10);

      // Should not crash
      doc.tick();

      // Observer should not have received any messages
      expect(observer.getMessage(0)).toBeUndefined();

      // Count how many messages the participant has received so far
      // (2 initial + possible ticks from observer join/leave processing)
      const msgCountBefore = participant.getMessage(2) ? (participant.getMessage(3) ? 4 : 3) : 2;

      // Participant should still work normally
      participant.sendToServer({
        type: "setUserComponents",
        components: [[1, 11n]],
        states: [[1, new Uint8Array([11])]],
      });

      doc.tick();

      const participantTick = (
        await participant.waitForTotalMessageCount(msgCountBefore + 1, msgCountBefore)
      )[0] as DeltaNetTick;
      expect(participantTick.type).toBe("tick");
      expect(participantTick.states[0].updatedStates[0][1]).toEqual(new Uint8Array([11]));

      // Cleanup
      participant.close();
      doc.removeWebSocket(participant as unknown as WebSocket);
    });

    test("multiple connections closed during pending async auth are all handled", async () => {
      const resolvers: Array<(value: any) => void> = [];

      const onJoinerMock = jest.fn<() => Promise<true>>().mockImplementation(() => {
        return new Promise((resolve) => {
          resolvers.push(resolve);
        });
      });

      const doc = new DeltaNetServer({
        onJoiner: onJoinerMock,
      });
      currentDoc = doc;

      const clients: MockWebsocketV01[] = [];
      for (let i = 0; i < 5; i++) {
        const client = new MockWebsocketV01();
        clients.push(client);
        doc.addWebSocket(client as unknown as WebSocket);

        client.sendToServer({
          type: "connectUser",
          components: [[1, BigInt(i)]],
          states: [[1, new Uint8Array([i])]],
          token: `test-${i}`,
          observer: false,
        });
      }

      expect(onJoinerMock).toHaveBeenCalledTimes(5);

      // Close all connections before auth resolves
      for (const client of clients) {
        client.close();
        doc.removeWebSocket(client as unknown as WebSocket);
      }

      // Resolve all auth promises
      for (const resolve of resolvers) {
        resolve(true);
      }
      await jest.advanceTimersByTimeAsync(10);

      // Should not crash
      expect(() => doc.tick()).not.toThrow();

      // No messages should have been sent to any closed connection
      for (const client of clients) {
        expect(client.getMessage(0)).toBeUndefined();
      }

      // Switch to synchronous auth for the fresh client to verify server is clean
      onJoinerMock.mockReturnValue(true as any);

      // Server should be clean - a new client should get index 0
      const freshClient = new MockWebsocketV01();
      doc.addWebSocket(freshClient as unknown as WebSocket);

      freshClient.sendToServer({
        type: "connectUser",
        components: [[1, 99n]],
        states: [[1, new Uint8Array([99])]],
        token: "fresh",
        observer: false,
      });

      await jest.advanceTimersByTimeAsync(10);
      doc.tick();

      await freshClient.waitForTotalMessageCount(2);
      expect(freshClient.getMessage(0)).toEqual({ index: 0, type: "userIndex" });

      // Cleanup
      freshClient.close();
      doc.removeWebSocket(freshClient as unknown as WebSocket);
    });

    test("auth abort signal is triggered when connection closes during async auth", async () => {
      let resolveAuth: (value: any) => void;
      const authPromise = new Promise((resolve) => {
        resolveAuth = resolve;
      });

      // We verify the behavioral outcome of auth abort: the connection
      // should not be added after the abort controller fires.
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

      expect(onJoinerMock).toHaveBeenCalledTimes(1);

      // Close the connection - this should trigger the abort controller
      clientWs.close();
      doc.removeWebSocket(clientWs as unknown as WebSocket);

      // Resolve auth after close
      resolveAuth!(true);
      await jest.advanceTimersByTimeAsync(10);

      // The connection should not have been added to the authenticated set
      // We verify this by adding a new connection and checking the server state is clean
      const verifyClient = new MockWebsocketV01();
      doc.addWebSocket(verifyClient as unknown as WebSocket);
      verifyClient.sendToServer({
        type: "connectUser",
        components: [[1, 2n]],
        states: [[1, new Uint8Array([2])]],
        token: "verify",
        observer: false,
      });

      await jest.advanceTimersByTimeAsync(10);
      doc.tick();

      await verifyClient.waitForTotalMessageCount(2);

      // Should get index 0, meaning the aborted connection was never added
      expect(verifyClient.getMessage(0)).toEqual({ index: 0, type: "userIndex" });

      // Initial checkout should only have 1 user (the verify client)
      const checkout = verifyClient.getMessage(1) as DeltaNetInitialCheckoutMessage;
      expect(checkout.indicesCount).toBe(1);

      // Cleanup
      verifyClient.close();
      doc.removeWebSocket(verifyClient as unknown as WebSocket);
    });
  });
});
