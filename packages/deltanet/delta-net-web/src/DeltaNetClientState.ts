import {
  DeltaNetClientWebsocketInitialCheckout,
  DeltaNetClientWebsocketTick,
} from "./DeltaNetClientWebsocket";

export type UserStateUpdate = { userId: number; stateId: number; state: Uint8Array | null };

export type UserInfo = {
  userId: number;
  components: Map<number, bigint>;
  states: Map<number, Uint8Array | null>;
};

export type DeltaNetClientComponent = {
  values: BigInt64Array;
  deltas: BigInt64Array;
  deltaDeltas: BigInt64Array;
};

export class DeltaNetClientState {
  private componentValues = new Map<number, DeltaNetClientComponent>();
  private allStates = new Map<number, Array<Uint8Array | null>>();

  public byUserId: Map<number, UserInfo> = new Map();

  private myIndex: number = -1;

  private indicesCount: number = 0;

  private userIdToIndex = new Map<number, number>();
  private userIds: Array<number> = [];
  private userIdCounter = 1000; // Start at 1000 to avoid confusion with indices

  constructor() {}

  /**
   * Reset all state to initial values. This should be called when reconnecting
   * to ensure that stale data from previous connections doesn't interfere.
   */
  public reset() {
    this.componentValues.clear();
    this.allStates.clear();
    this.byUserId.clear();
    this.myIndex = -1;
    this.indicesCount = 0;
    this.userIdToIndex.clear();
    this.userIds.length = 0;
    this.userIdCounter = 1000;
  }

  public getComponentValues(): Map<number, DeltaNetClientComponent> {
    return this.componentValues;
  }

  public getStateById(stateId: number): Array<Uint8Array | null> | null {
    return this.allStates.get(stateId) ?? null;
  }

  public getAllStates(): Map<number, Array<Uint8Array | null>> {
    return this.allStates;
  }

  public getMyIndex(): number {
    return this.myIndex;
  }

  public getIndicesCount(): number {
    return this.indicesCount;
  }

  public getUserIds(): Array<number> {
    return this.userIds;
  }

  public getComponentValueForUserId(userId: number, componentId: number): bigint | null {
    const index = this.userIdToIndex.get(userId);
    if (index === undefined) {
      return null;
    }
    const componentValue = this.componentValues.get(componentId);
    if (!componentValue) {
      return null;
    }
    return componentValue.values[index] ?? null;
  }

  public getComponentsForUser(userId: number): Map<number, bigint> | null {
    const index = this.userIdToIndex.get(userId);
    if (index === undefined) {
      return null;
    }
    const componentMap = new Map<number, bigint>();
    for (const [key, componentValue] of this.componentValues) {
      if (componentValue === undefined) {
        throw new Error(`Component value for key ${key} is undefined`);
      }
      componentMap.set(key, componentValue.values[index]);
    }
    return componentMap;
  }

  public handleInitialCheckout(initialCheckout: DeltaNetClientWebsocketInitialCheckout) {
    const { indicesCount, initialComponents, initialStates } = initialCheckout;
    for (let i = 0; i < indicesCount; i++) {
      const userId = this.userIdCounter++;
      this.userIds.push(userId);
      this.userIdToIndex.set(userId, i);
      const userInfo: UserInfo = {
        userId,
        components: new Map(),
        states: new Map(),
      };
      this.byUserId.set(userId, userInfo);
    }
    this.indicesCount = indicesCount;

    const deltaDeltas = new BigInt64Array(indicesCount);
    for (let i = 0; i < deltaDeltas.length; i++) {
      deltaDeltas[i] = BigInt(0);
    }

    for (const [key, value] of initialComponents) {
      this.componentValues.set(key, {
        values: value.values,
        deltas: value.deltas,
        deltaDeltas,
      });

      for (let i = 0; i < this.userIds.length; i++) {
        const userId = this.userIds[i];
        const userInfo = this.byUserId.get(userId);
        if (userInfo) {
          userInfo.components.set(key, value.values[i]);
        }
      }
    }

    const stateUpdates: Array<UserStateUpdate> = [];

    for (const [stateId, values] of initialStates) {
      this.allStates.set(stateId, values);

      for (let i = 0; i < this.userIds.length; i++) {
        const userId = this.userIds[i];
        const userInfo = this.byUserId.get(userId);
        const stateValue = values[i];
        if (userInfo) {
          userInfo.states.set(stateId, stateValue);
        }

        stateUpdates.push({
          userId,
          stateId,
          state: stateValue,
        });
      }
    }

    return { stateUpdates, removedUserIds: [] };
  }

  public handleTick(tick: DeltaNetClientWebsocketTick): { 
    stateUpdates: Array<UserStateUpdate>; 
    removedUserIds: Array<number>;
  } {
    const { unoccupying, indicesCount, componentDeltaDeltas, stateChanges } = tick;
    let removedUserIds: Array<number> = [];
    
    if (unoccupying.length > 0) {
      // Remove unoccupying indices from component values
      for (const [, component] of this.componentValues) {
        this.removeIndicesFromBigInt64Array(unoccupying, component.values);
        this.removeIndicesFromBigInt64Array(unoccupying, component.deltas);
      }

      // Remove unoccupying indices from states
      for (const [, state] of this.allStates) {
        this.removeIndicesFromState(unoccupying, state);
      }

      // Update myIndex
      let decrementIndex = 0;
      for (const index of unoccupying) {
        if (index <= this.myIndex) {
          decrementIndex++;
        }
      }
      this.myIndex -= decrementIndex;

      // Update indices count
      this.indicesCount -= unoccupying.length;

      // Collect userIds to remove before mutating userIds
      const userIdsToRemove = unoccupying.map((index) => this.userIds[index]);
      removedUserIds = userIdsToRemove.filter(userId => userId !== undefined);

      // Update user indices and userIds array
      this.removeUserIndices(unoccupying);
      this.userIds.length = indicesCount;

      // Remove unoccupied users from byUserId
      for (const userId of userIdsToRemove) {
        if (userId !== undefined) {
          this.byUserId.delete(userId);
        }
      }
    }

    if (indicesCount > this.indicesCount) {
      const addedIndices = indicesCount - this.indicesCount;
      for (let i = 0; i < addedIndices; i++) {
        const userId = this.userIdCounter++;
        this.userIds.push(userId);
        this.userIdToIndex.set(userId, this.userIds.length - 1);
        const userInfo: UserInfo = {
          userId,
          components: new Map(),
          states: new Map(),
        };
        this.byUserId.set(userId, userInfo);
      }
    }

    this.indicesCount = indicesCount;

    // Update component values
    for (const [key, deltaDeltas] of componentDeltaDeltas) {
      if (deltaDeltas.length !== indicesCount) {
        throw new Error(
          `DeltaDeltas length (${deltaDeltas.length}) does not match indices count (${indicesCount})`,
        );
      }
      const existingComponent = this.componentValues.get(key);
      if (!existingComponent) {
        const values = new BigInt64Array(deltaDeltas);
        const deltas = new BigInt64Array(deltaDeltas);
        this.componentValues.set(key, { values, deltas, deltaDeltas });
      } else {
        if (existingComponent.values.length < deltaDeltas.length) {
          // Resize the arrays
          const newValues = new BigInt64Array(deltaDeltas.length);
          newValues.set(existingComponent.values);
          const newDeltas = new BigInt64Array(deltaDeltas.length);
          newDeltas.set(existingComponent.deltas);
          const newDeltaDelta = new BigInt64Array(deltaDeltas.length);
          newDeltaDelta.set(existingComponent.deltaDeltas);
          for (let i = existingComponent.values.length; i < deltaDeltas.length; i++) {
            newValues[i] = BigInt(0);
            newDeltas[i] = BigInt(0);
            newDeltaDelta[i] = BigInt(0);
          }
          existingComponent.values = newValues;
          existingComponent.deltas = newDeltas;
          existingComponent.deltaDeltas = newDeltaDelta;
        }
        for (let i = 0; i < deltaDeltas.length; i++) {
          const deltaDelta = deltaDeltas[i];
          existingComponent.deltaDeltas[i] = deltaDelta;
          existingComponent.deltas[i] += deltaDelta;
          existingComponent.values[i] += existingComponent.deltas[i];

          // Update byUserId map with new component values
          const userId = this.userIds[i];
          const userInfo = this.byUserId.get(userId);
          if (userInfo) {
            userInfo.components.set(key, existingComponent.values[i]);
          }
        }
      }
    }

    const stateUpdates: Array<UserStateUpdate> = [];

    // Update states
    for (const [stateId, states] of stateChanges) {
      let state = this.allStates.get(stateId);
      if (!state) {
        state = [];
        this.allStates.set(stateId, state);
      }
      for (const [index, value] of states) {
        const userId = this.userIds[index];
        stateUpdates.push({
          userId,
          stateId,
          state: value,
        });
        if (value !== null) {
          state[index] = value;
        } else {
          state[index] = null;
        }

        // Update byUserId map with new state values
        const userInfo = this.byUserId.get(userId);
        if (userInfo) {
          userInfo.states.set(stateId, value);
        }
      }
    }

    return { stateUpdates, removedUserIds };
  }

  public setUserIndex(index: number) {
    this.myIndex = index;
  }

  private removeUserIndices(removing: Array<number>) {
    if (removing.length === 0) {
      return;
    }

    let writeIndex = 0;
    let skipIndex = 0;

    for (let readIndex = 0; readIndex < this.userIds.length; readIndex++) {
      if (skipIndex < removing.length && readIndex === removing[skipIndex]) {
        skipIndex++;
        continue;
      }

      if (writeIndex !== readIndex) {
        const userId = this.userIds[readIndex];
        this.userIdToIndex.set(userId, writeIndex);
        this.userIds[writeIndex] = this.userIds[readIndex];
      }

      writeIndex++;
    }
  }

  private removeIndicesFromBigInt64Array(removing: Array<number>, array: BigInt64Array) {
    if (removing.length === 0) {
      return;
    }

    let writeIndex = 0;
    let skipIndex = 0;

    for (let readIndex = 0; readIndex < array.length; readIndex++) {
      if (skipIndex < removing.length && readIndex === removing[skipIndex]) {
        skipIndex++;
        continue;
      }

      if (writeIndex !== readIndex) {
        array[writeIndex] = array[readIndex];
      }

      writeIndex++;
    }
    for (let i = writeIndex; i < array.length; i++) {
      array[i] = BigInt(0);
    }
  }

  private removeIndicesFromState(removing: Array<number>, state: Array<Uint8Array | null>) {
    if (removing.length === 0) {
      return;
    }

    let writeIndex = 0;
    let skipIndex = 0;

    for (let readIndex = 0; readIndex < state.length; readIndex++) {
      if (skipIndex < removing.length && readIndex === removing[skipIndex]) {
        skipIndex++;
        continue;
      }

      if (writeIndex !== readIndex) {
        state[writeIndex] = state[readIndex];
      }

      writeIndex++;
    }
  }
}
