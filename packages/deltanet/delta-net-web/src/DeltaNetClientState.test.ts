import { DeltaNetClientState } from "./DeltaNetClientState";
import {
  DeltaNetClientWebsocketInitialCheckout,
  DeltaNetClientWebsocketTick,
} from "./DeltaNetClientWebsocket";

describe("DeltaNetClientState", () => {
  let clientState: DeltaNetClientState;

  beforeEach(() => {
    clientState = new DeltaNetClientState();
  });

  describe("Initial State", () => {
    it("should initialize with empty maps and arrays", () => {
      expect(clientState.getComponentValues()).toEqual(new Map());
      expect(clientState.getAllStates()).toEqual(new Map());
      expect(clientState.getMyIndex()).toBe(-1);
      expect(clientState.getIndicesCount()).toBe(0);
      expect(clientState.getUserIds()).toEqual([]);
    });
  });

  describe("Initial Checkout", () => {
    it("should handle initial checkout correctly", () => {
      const initialCheckout: DeltaNetClientWebsocketInitialCheckout = {
        indicesCount: 2,
        initialComponents: new Map([
          [
            1,
            {
              values: new BigInt64Array([BigInt(100), BigInt(200)]),
              deltas: new BigInt64Array([BigInt(0), BigInt(0)]),
            },
          ],
        ]),
        initialStates: new Map([
          [
            1,
            [
              new Uint8Array([115, 116, 97, 116, 101, 49]),
              new Uint8Array([115, 116, 97, 116, 101, 50]),
            ],
          ],
        ]),
      };

      const { stateUpdates } = clientState.handleInitialCheckout(initialCheckout);

      expect(clientState.getIndicesCount()).toBe(2);
      expect(clientState.getUserIds().length).toBe(2);
      expect(stateUpdates.length).toBe(2);

      const componentValues = clientState.getComponentValues();
      expect(componentValues.get(1)?.values[0]).toBe(BigInt(100));
      expect(componentValues.get(1)?.values[1]).toBe(BigInt(200));

      const states = clientState.getStateById(1);
      expect(states).toEqual([
        new Uint8Array([115, 116, 97, 116, 101, 49]),
        new Uint8Array([115, 116, 97, 116, 101, 50]),
      ]);

      // Verify byUserId map after initial checkout
      const userIds = clientState.getUserIds();
      expect(clientState.byUserId.size).toBe(2);

      const user1 = clientState.byUserId.get(userIds[0]);
      expect(user1).toBeDefined();
      expect(user1?.components.get(1)).toBe(BigInt(100));
      expect(user1?.states.get(1)).toStrictEqual(new Uint8Array([115, 116, 97, 116, 101, 49]));

      const user2 = clientState.byUserId.get(userIds[1]);
      expect(user2).toBeDefined();
      expect(user2?.components.get(1)).toBe(BigInt(200));
      expect(user2?.states.get(1)).toStrictEqual(new Uint8Array([115, 116, 97, 116, 101, 50]));
    });
  });

  describe("Tick Updates", () => {
    beforeEach(() => {
      // Setup initial state
      const initialCheckout: DeltaNetClientWebsocketInitialCheckout = {
        indicesCount: 3,
        initialComponents: new Map([
          [
            1,
            {
              values: new BigInt64Array([BigInt(100), BigInt(200), BigInt(300)]),
              deltas: new BigInt64Array([BigInt(0), BigInt(0), BigInt(0)]),
            },
          ],
        ]),
        initialStates: new Map(),
      };
      clientState.handleInitialCheckout(initialCheckout);
    });

    it("should handle component updates correctly", () => {
      const tick: DeltaNetClientWebsocketTick = {
        indicesCount: 3,
        unoccupying: [],
        componentDeltaDeltas: new Map([
          [1, new BigInt64Array([BigInt(10), BigInt(20), BigInt(30)])],
        ]),
        stateChanges: new Map(),
      };

      const { stateUpdates } = clientState.handleTick(tick);
      expect(stateUpdates.length).toBe(0); // No state updates in this tick

      const componentValues = clientState.getComponentValues();
      expect(componentValues.get(1)?.values[0]).toBe(BigInt(110));
      expect(componentValues.get(1)?.values[1]).toBe(BigInt(220));
      expect(componentValues.get(1)?.values[2]).toBe(BigInt(330));

      // Verify byUserId map after component updates
      const userIds = clientState.getUserIds();
      expect(clientState.byUserId.size).toBe(3);

      const user1 = clientState.byUserId.get(userIds[0]);
      expect(user1?.components.get(1)).toBe(BigInt(110));

      const user2 = clientState.byUserId.get(userIds[1]);
      expect(user2?.components.get(1)).toBe(BigInt(220));

      const user3 = clientState.byUserId.get(userIds[2]);
      expect(user3?.components.get(1)).toBe(BigInt(330));
    });

    it("should handle state changes correctly", () => {
      const tick: DeltaNetClientWebsocketTick = {
        indicesCount: 3,
        unoccupying: [],
        componentDeltaDeltas: new Map(),
        stateChanges: new Map([
          [
            1,
            new Map([
              [0, new Uint8Array([110, 101, 119, 83, 116, 97, 116, 101, 49])],
              [1, new Uint8Array([])],
            ]),
          ],
        ]),
      };

      const { stateUpdates } = clientState.handleTick(tick);

      expect(stateUpdates.length).toBe(2);
      expect(stateUpdates[0].state).toStrictEqual(
        new Uint8Array([110, 101, 119, 83, 116, 97, 116, 101, 49]),
      );
      expect(stateUpdates[1].state).toStrictEqual(new Uint8Array([]));

      const states = clientState.getStateById(1);
      expect(states?.[0]).toStrictEqual(new Uint8Array([110, 101, 119, 83, 116, 97, 116, 101, 49]));
      expect(states?.[1]).toStrictEqual(new Uint8Array([]));

      // Verify byUserId map after state changes
      const userIds = clientState.getUserIds();
      expect(clientState.byUserId.size).toBe(3);

      const user1 = clientState.byUserId.get(userIds[0]);
      expect(user1?.states.get(1)).toStrictEqual(
        new Uint8Array([110, 101, 119, 83, 116, 97, 116, 101, 49]),
      );

      const user2 = clientState.byUserId.get(userIds[1]);
      expect(user2?.states.get(1)).toStrictEqual(new Uint8Array([]));

      const user3 = clientState.byUserId.get(userIds[2]);
      expect(user3?.states.get(1)).toBeUndefined();
    });

    it("should handle unoccupying indices correctly", () => {
      const tick: DeltaNetClientWebsocketTick = {
        indicesCount: 2,
        unoccupying: [1],
        componentDeltaDeltas: new Map(),
        stateChanges: new Map(),
      };

      clientState.handleTick(tick);

      expect(clientState.getIndicesCount()).toBe(2);
      expect(clientState.getUserIds().length).toBe(2);

      // Verify byUserId map after unoccupying
      expect(clientState.byUserId.size).toBe(2);
      const userIds = clientState.getUserIds();

      // The first user should still exist
      const user1 = clientState.byUserId.get(userIds[0]);
      expect(user1).toBeDefined();

      // The second user should be the new user (not the one that was unoccupied)
      const user2 = clientState.byUserId.get(userIds[1]);
      expect(user2).toBeDefined();
      expect(user2?.userId).toBe(userIds[1]);
    });
  });

  describe("User Index Management", () => {
    it("should set and get user index correctly", () => {
      clientState.setUserIndex(5);
      expect(clientState.getMyIndex()).toBe(5);
    });
  });

  describe("Component Value Retrieval", () => {
    beforeEach(() => {
      const initialCheckout: DeltaNetClientWebsocketInitialCheckout = {
        indicesCount: 2,
        initialComponents: new Map([
          [
            1,
            {
              values: new BigInt64Array([BigInt(100), BigInt(200)]),
              deltas: new BigInt64Array([BigInt(0), BigInt(0)]),
            },
          ],
        ]),
        initialStates: new Map(),
      };
      clientState.handleInitialCheckout(initialCheckout);
    });

    it("should get component value for user ID", () => {
      const userId = clientState.getUserIds()[0];
      const value = clientState.getComponentValueForUserId(userId, 1);
      expect(value).toBe(BigInt(100));
    });

    it("should get all components for user", () => {
      const userId = clientState.getUserIds()[0];
      const components = clientState.getComponentsForUser(userId);
      expect(components?.get(1)).toBe(BigInt(100));
    });
  });

  describe("Reset Functionality", () => {
    it("should reset all state to initial values when reset() is called", () => {
      // First, populate the state with some data
      const initialCheckout: DeltaNetClientWebsocketInitialCheckout = {
        indicesCount: 2,
        initialComponents: new Map([
          [
            1,
            {
              values: new BigInt64Array([BigInt(100), BigInt(200)]),
              deltas: new BigInt64Array([BigInt(0), BigInt(0)]),
            },
          ],
        ]),
        initialStates: new Map([
          [
            1,
            [
              new Uint8Array([115, 116, 97, 116, 101, 49]),
              new Uint8Array([115, 116, 97, 116, 101, 50]),
            ],
          ],
        ]),
      };
      clientState.handleInitialCheckout(initialCheckout);
      
      // Verify state is populated
      expect(clientState.getIndicesCount()).toBe(2);
      expect(clientState.getUserIds().length).toBe(2);
      expect(clientState.getComponentValues().size).toBe(1);
      expect(clientState.getAllStates().size).toBe(1);
      expect(clientState.byUserId.size).toBe(2);
      
      // Reset the state
      clientState.reset();
      
      // Verify everything is reset to initial values
      expect(clientState.getComponentValues()).toEqual(new Map());
      expect(clientState.getAllStates()).toEqual(new Map());
      expect(clientState.getMyIndex()).toBe(-1);
      expect(clientState.getIndicesCount()).toBe(0);
      expect(clientState.getUserIds()).toEqual([]);
      expect(clientState.byUserId.size).toBe(0);
    });

    it("should handle reconnection scenario without duplicate user IDs", () => {
      // First connection
      const initialCheckout1: DeltaNetClientWebsocketInitialCheckout = {
        indicesCount: 2,
        initialComponents: new Map(),
        initialStates: new Map(),
      };
      clientState.handleInitialCheckout(initialCheckout1);
      const userIds1 = clientState.getUserIds();
      
      // Reset for reconnection
      clientState.reset();
      
      // Second connection (simulating reconnection)
      const initialCheckout2: DeltaNetClientWebsocketInitialCheckout = {
        indicesCount: 2,
        initialComponents: new Map(),
        initialStates: new Map(),
      };
      clientState.handleInitialCheckout(initialCheckout2);
      const userIds2 = clientState.getUserIds();
      
      // User IDs should start from the same base value (1000) after reset
      expect(userIds2[0]).toBe(1000);
      expect(userIds2[1]).toBe(1001);
      expect(userIds2.length).toBe(2);
      expect(clientState.byUserId.size).toBe(2);
      
      // Should not contain any user IDs from previous connection
      expect(userIds2).not.toContain(userIds1[0]);
      expect(userIds2).not.toContain(userIds1[1]);
    });
  });
});
