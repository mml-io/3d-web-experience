import {
  BufferWriter,
  DeltaNetComponentTick,
  DeltaNetInitialCheckoutComponent,
  DeltaNetInitialCheckoutMessage,
  DeltaNetInitialCheckoutState,
  DeltaNetServerErrors,
  DeltaNetServerErrorType,
  DeltaNetStateUpdates,
  DeltaNetTick,
  deltaNetSupportedSubProtocols,
  deltaNetProtocolSubProtocol_v0_1,
  deltaNetProtocolSubProtocol_v0_2,
  encodeInitialCheckout,
  encodeInitialCheckoutV02,
  encodeServerCustom,
  encodeTick,
  encodeTickV02,
} from "@mml-io/delta-net-protocol";

import { ComponentCollection } from "./ComponentCollection";
import { createDeltaNetServerConnectionForWebsocket } from "./createDeltaNetServerConnectionForWebsocket";
import { DeltaNetConnection } from "./DeltaNetConnection";
import { StateCollection } from "./StateCollection";

export type onJoinerOptions = {
  connection: DeltaNetConnection;
  components: Array<[number, bigint]>;
  states: Array<[number, Uint8Array]>;
  token: string;
  internalConnectionId: number;
};

export type onComponentsUpdateOptions = {
  connection: DeltaNetConnection;
  internalConnectionId: number;
  components: Array<[number, bigint]>;
};

export type onStatesUpdateOptions = {
  connection: DeltaNetConnection;
  internalConnectionId: number;
  states: Array<[number, Uint8Array]>;
  abortSignal: AbortSignal;
};

export type onLeaveOptions = {
  connection: DeltaNetConnection;
  internalConnectionId: number;
  components: Array<[number, number]>;
  states: Array<[number, Uint8Array]>;
};

export type onCustomMessageOptions = {
  connection: DeltaNetConnection;
  internalConnectionId: number;
  customType: number;
  contents: string;
};

export class DeltaNetServerError extends Error {
  constructor(
    public errorType: DeltaNetServerErrorType,
    message: string,
    public retryable: boolean,
  ) {
    super(message);
  }
}

export type DeltaNetServerOptions = {
  onJoiner?: (
    opts: onJoinerOptions,
  ) =>
    | true
    | void
    | Error
    | DeltaNetServerError
    | { success: true; stateOverrides?: Array<[number, Uint8Array]> }
    | Promise<
        | true
        | void
        | Error
        | DeltaNetServerError
        | { success: true; stateOverrides?: Array<[number, Uint8Array]> }
      >;
  onComponentsUpdate?: (
    opts: onComponentsUpdateOptions,
  ) => true | void | Error | DeltaNetServerError;
  onStatesUpdate?: (
    opts: onStatesUpdateOptions,
  ) =>
    | true
    | void
    | Error
    | DeltaNetServerError
    | { success: true; stateOverrides?: Array<[number, Uint8Array]> }
    | Promise<
        | true
        | void
        | Error
        | DeltaNetServerError
        | { success: true; stateOverrides?: Array<[number, Uint8Array]> }
      >;
  onLeave?: (opts: onLeaveOptions) => void;
  onCustomMessage?: (opts: onCustomMessageOptions) => void;
  // If provided, the server will create a state for each user that contains their connection id
  serverConnectionIdStateId?: number;
  // Maximum size in bytes for individual state values (default: 1MB)
  maxStateValueSize?: number;
  // Maximum total size in bytes for a single message (default: 10MB)
  maxMessageSize?: number;
};

export class DeltaNetServer {
  private currentConnectionId = 1;

  private nextIndex = 0;

  private preTickData = {
    // This is state that will be flushed to clients in the next tick, but messages handled before the tick could change it
    unoccupyingIndices: new Set<number>(),
    newJoinerConnections: new Set<DeltaNetConnection>(),
    // Allows for arbitrary processes to be run that can imitate a new joiner connection (currently used for legacy adapter)
    newJoinerCallbacks: new Set<
      (index: number) => { id: number; afterAddCallback?: () => void } | null
    >(),
    componentsUpdated: 0,
  };

  private connectionIdToComponentIndex = new Map<number, number>();
  private componentIndexToConnectionId = new Map<number, number>();
  private connectionIdToConnection = new Map<number, DeltaNetConnection>();

  private allConnections = new Set<DeltaNetConnection>();
  private authenticatedConnections = new Set<DeltaNetConnection>();
  private authenticatedV01Connections = new Set<DeltaNetConnection>();
  private authenticatedV02Connections = new Set<DeltaNetConnection>();
  private observerConnections = new Set<DeltaNetConnection>(); // Track observer connections separately
  private webSocketToConnection = new Map<WebSocket, DeltaNetConnection>();

  private components = new Map<number, ComponentCollection>();
  private states = new Map<number, StateCollection>();

  private documentEffectiveStartTime = Date.now();

  private disposed = false;

  private maxStateValueSize: number;
  private maxMessageSize: number;

  constructor(private opts: DeltaNetServerOptions = {}) {
    if (opts.serverConnectionIdStateId !== undefined) {
      this.states.set(opts.serverConnectionIdStateId, new StateCollection());
    }

    // Set default limits
    this.maxStateValueSize = opts.maxStateValueSize ?? 1024 * 1024; // 1MB default
    this.maxMessageSize = opts.maxMessageSize ?? 10 * 1024 * 1024; // 10MB default
  }

  public static handleWebsocketSubprotocol(protocols: Set<string> | Array<string>): string | false {
    const protocolsSet = new Set(protocols);
    // Find highest priority (first in the array) protocol that is supported
    for (const protocol of deltaNetSupportedSubProtocols) {
      if (protocolsSet.has(protocol)) {
        return protocol;
      }
    }
    return false;
  }

  /**
   * @param webSocket  The upgraded WebSocket.
   * @param deltaNetSubProtocol  Optional explicit delta-net sub-protocol
   *   version. When provided, `webSocket.protocol` is ignored for version
   *   selection. This allows a higher-level protocol to be negotiated at the
   *   WebSocket level while the delta-net version is supplied by the caller.
   */
  public addWebSocket(webSocket: WebSocket, deltaNetSubProtocol?: string) {
    if (this.disposed) {
      throw new Error("This DeltaNetServer has been disposed");
    }

    const connection = createDeltaNetServerConnectionForWebsocket(
      webSocket,
      this,
      deltaNetSubProtocol,
    );
    if (connection === null) {
      // Error is handled in createDeltaNetServerConnectionForWebsocket
      return;
    }

    this.allConnections.add(connection);
    this.webSocketToConnection.set(connection.webSocket, connection);
  }

  public removeWebSocket(webSocket: WebSocket) {
    // Allow removal even when disposed to ensure cleanup
    const connection = this.webSocketToConnection.get(webSocket);
    if (connection === undefined) {
      // Connection might have already been removed, which is fine
      return;
    }
    if (!this.allConnections.has(connection)) {
      // Connection might have already been cleaned up, which is fine
      return;
    }

    // Dispose the connection (this will cancel any pending validations)
    connection.dispose();

    // Call onLeave callback if provided and connection has an ID (but not if disposed)
    if (!this.disposed && this.opts.onLeave) {
      const internalConnectionId = connection.internalConnectionId;
      const index = this.connectionIdToComponentIndex.get(internalConnectionId);

      if (index !== undefined) {
        // Gather current component and state data for the leaving user
        const components: Array<[number, number]> = [];
        for (const [componentId, collection] of this.components) {
          const value = collection.getTargetValue(index);
          if (value !== 0n) {
            components.push([componentId, Number(value)]);
          }
        }

        const states: Array<[number, Uint8Array]> = [];
        for (const [stateId, collection] of this.states) {
          const value = collection.values[index];
          if (value !== undefined && value.length > 0) {
            states.push([stateId, value]);
          }
        }

        try {
          this.opts.onLeave({
            connection,
            internalConnectionId,
            components,
            states,
          });
        } catch (error) {
          console.warn("Error in onLeave callback:", error);
        }
      } else if (connection.isObserver) {
        // Observers don't have indices but still need onLeave for cleanup
        try {
          this.opts.onLeave({
            connection,
            internalConnectionId,
            components: [],
            states: [],
          });
        } catch (error) {
          console.warn("Error in onLeave callback for observer:", error);
        }
      }
    }

    const internalConnectionId = connection.internalConnectionId;
    this.connectionIdToConnection.delete(internalConnectionId);
    if (this.preTickData.newJoinerConnections.has(connection)) {
      // This connection is still pending, so we need to remove it from the pending joiner list
      this.preTickData.newJoinerConnections.delete(connection);
    } else {
      // This connection is already authenticated (has an index assigned), so we need to clear data for it
      const index = this.connectionIdToComponentIndex.get(internalConnectionId);
      if (index !== undefined) {
        this.clearInternalConnectionId(internalConnectionId);
      }
      // If index is undefined, this connection was never fully authenticated and has no data to clear
    }
    this.removeFromAuthenticatedSets(connection);
    this.observerConnections.delete(connection); // Remove from observers if present
    this.allConnections.delete(connection);
    this.webSocketToConnection.delete(connection.webSocket);
  }

  public hasWebSocket(webSocket: WebSocket): boolean {
    return this.webSocketToConnection.has(webSocket);
  }

  private addToAuthenticatedSets(connection: DeltaNetConnection): void {
    this.authenticatedConnections.add(connection);
    switch (connection.protocolVersion) {
      case deltaNetProtocolSubProtocol_v0_1:
        this.authenticatedV01Connections.add(connection);
        break;
      case deltaNetProtocolSubProtocol_v0_2:
        this.authenticatedV02Connections.add(connection);
        break;
      default: {
        const _exhaustive: never = connection.protocolVersion;
        throw new Error(`Unknown protocol version: ${_exhaustive}`);
      }
    }
  }

  private removeFromAuthenticatedSets(connection: DeltaNetConnection): void {
    this.authenticatedConnections.delete(connection);
    switch (connection.protocolVersion) {
      case deltaNetProtocolSubProtocol_v0_1:
        this.authenticatedV01Connections.delete(connection);
        break;
      case deltaNetProtocolSubProtocol_v0_2:
        this.authenticatedV02Connections.delete(connection);
        break;
      default: {
        const _exhaustive: never = connection.protocolVersion;
        throw new Error(`Unknown protocol version: ${_exhaustive}`);
      }
    }
  }

  public dangerouslyGetConnectionsToComponentIndex(): Map<number, number> {
    return this.connectionIdToComponentIndex;
  }

  public dangerouslyAddNewJoinerCallback(
    callback: (index: number) => { id: number; afterAddCallback?: () => void } | null,
  ): void {
    this.preTickData.newJoinerCallbacks.add(callback);
  }

  public getComponentValue(componentId: number, componentIndex: number): number | null {
    const componentCollection = this.components.get(componentId);
    if (componentCollection === undefined) {
      return null;
    }
    return Number(componentCollection.getTargetValue(componentIndex));
  }

  public getNextConnectionId(): number {
    return this.currentConnectionId++;
  }

  public getMaxMessageSize(): number {
    return this.maxMessageSize;
  }

  public validateJoiner(
    connection: DeltaNetConnection,
    token: string,
    components: Array<[number, bigint]>,
    states: Array<[number, Uint8Array]>,
  ):
    | Promise<
        | { success: true; stateOverrides?: Array<[number, Uint8Array]> }
        | { success: false; error: string }
      >
    | { success: true; stateOverrides?: Array<[number, Uint8Array]> }
    | { success: false; error: string } {
    if (this.disposed) {
      return { success: false, error: "This DeltaNetServer has been disposed" };
    }

    // Check individual state value sizes
    for (const [stateId, stateValue] of states) {
      if (stateValue.length > this.maxStateValueSize) {
        return {
          success: false,
          error: `State value for state ${stateId} has size ${stateValue.length} bytes which exceeds maximum allowed size of ${this.maxStateValueSize} bytes`,
        };
      }
    }

    function resultToReturn(
      result:
        | true
        | void
        | Error
        | DeltaNetServerError
        | { success: true; stateOverrides?: Array<[number, Uint8Array]> },
    ):
      | { success: true; stateOverrides?: Array<[number, Uint8Array]> }
      | { success: false; error: string } {
      if (result instanceof DeltaNetServerError) {
        return { success: false, error: result.message };
      }
      if (result instanceof Error) {
        return { success: false, error: result.message };
      }
      if (result === true || result === undefined) {
        // If the callback returns true or undefined, treat it as success
        return { success: true };
      }
      if (typeof result === "object" && result.success === true) {
        // Return the object with potential state overrides
        return result;
      }
      return { success: false, error: "Joiner validation failed" };
    }

    // Call onJoiner callback if provided (now potentially async)
    if (this.opts.onJoiner) {
      const rawResult = this.opts.onJoiner({
        connection,
        components,
        states,
        token,
        internalConnectionId: connection.internalConnectionId,
      });
      if (rawResult instanceof Promise) {
        return rawResult
          .then(
            (
              resolvedResult,
            ):
              | { success: true; stateOverrides?: Array<[number, Uint8Array]> }
              | { success: false; error: string } => {
              return resultToReturn(resolvedResult);
            },
          )
          .catch((error) => {
            console.warn("Error in async onJoiner callback:", error);
            return resultToReturn(error);
          });
      } else {
        return resultToReturn(rawResult);
      }
    }

    return { success: true };
  }

  public addAuthenticatedConnection(connection: DeltaNetConnection): void {
    this.connectionIdToConnection.set(connection.internalConnectionId, connection);

    if (connection.isObserver) {
      // Observers don't get indices but still need to go through the newJoiner flow to receive initialCheckout
      this.observerConnections.add(connection);
      this.preTickData.newJoinerConnections.add(connection);
    } else {
      // Regular users get added to new joiner queue for index assignment
      this.preTickData.newJoinerConnections.add(connection);
    }
  }

  public validateAndApplyStateUpdate(
    connection: DeltaNetConnection,
    internalConnectionId: number,
    stateId: number,
    stateValue: Uint8Array,
    abortSignal: AbortSignal,
  ):
    | Promise<true | void | Error | DeltaNetServerError>
    | true
    | void
    | Error
    | DeltaNetServerError {
    if (this.disposed) {
      return new Error("This DeltaNetServer has been disposed");
    }

    // Check state value size limit
    if (stateValue.length > this.maxStateValueSize) {
      return new DeltaNetServerError(
        DeltaNetServerErrors.USER_NETWORKING_UNKNOWN_ERROR_TYPE,
        `State value for state ${stateId} has size ${stateValue.length} bytes which exceeds maximum allowed size of ${this.maxStateValueSize} bytes`,
        false,
      );
    }

    // Observers cannot send state updates
    if (connection.isObserver) {
      return new DeltaNetServerError(
        DeltaNetServerErrors.OBSERVER_CANNOT_SEND_STATE_UPDATES_ERROR_TYPE,
        "Observers cannot send state updates",
        false,
      );
    }

    // Call onStatesUpdate callback if provided
    if (this.opts.onStatesUpdate) {
      try {
        const result = this.opts.onStatesUpdate({
          connection,
          internalConnectionId,
          states: [[stateId, stateValue]],
          abortSignal,
        });

        // If it's a Promise, return it for the connection to handle
        if (result instanceof Promise) {
          return result
            .then((asyncResult) => {
              // Check if connection still exists before applying state update
              if (!this.connectionIdToConnection.has(internalConnectionId)) {
                // Connection was removed while validation was pending - ignore the result
                return;
              }
              if (asyncResult instanceof DeltaNetServerError || asyncResult instanceof Error) {
                return asyncResult;
              }

              if (asyncResult === true || asyncResult === undefined) {
                this.applyStateUpdates(connection, internalConnectionId, [[stateId, stateValue]]);
                return true;
              }

              // If asyncResult is an object with success: true, apply the state overrides
              if (asyncResult.success) {
                if (asyncResult.stateOverrides) {
                  this.applyStateUpdates(
                    connection,
                    internalConnectionId,
                    asyncResult.stateOverrides,
                  );
                }
                return true;
              } else {
                return new DeltaNetServerError(
                  DeltaNetServerErrors.USER_NETWORKING_UNKNOWN_ERROR_TYPE,
                  "State validation failed",
                  false,
                );
              }
            })
            .catch((error) => {
              // Handle async callback errors
              console.warn("Error in async onStatesUpdate callback:", error);
              if (error instanceof DeltaNetServerError) {
                return error;
              }
              if (error instanceof Error) {
                return error;
              }
              return new Error("State validation failed");
            });
        } else {
          // Synchronous validation
          if (result instanceof DeltaNetServerError || result instanceof Error) {
            return result;
          }

          if (result === true || result === undefined) {
            this.applyStateUpdates(connection, internalConnectionId, [[stateId, stateValue]]);
            return true;
          }

          // If result is an object with success: true, apply the state overrides
          if (result.success) {
            if (result.stateOverrides) {
              this.applyStateUpdates(connection, internalConnectionId, result.stateOverrides);
            }
            return true;
          } else {
            return new DeltaNetServerError(
              DeltaNetServerErrors.USER_NETWORKING_UNKNOWN_ERROR_TYPE,
              "State validation failed",
              false,
            );
          }
        }
      } catch (error) {
        console.warn("Error in onStatesUpdate callback:", error);
        if (error instanceof DeltaNetServerError) {
          return error;
        }
        if (error instanceof Error) {
          return error;
        }
        return new Error("State validation failed");
      }
    } else {
      // No validation callback, apply immediately
      this.applyStateUpdates(connection, internalConnectionId, [[stateId, stateValue]]);
      return true;
    }
  }

  public clearInternalConnectionId(internalConnectionId: number) {
    const index = this.connectionIdToComponentIndex.get(internalConnectionId);
    if (index === undefined) {
      throw new Error("Index for removing user is undefined");
    }
    // Clear all the component values for this index
    for (const [, collection] of this.components) {
      collection.setValue(index, 0n);
    }
    for (const [, collection] of this.states) {
      collection.setValue(index, null);
    }

    this.preTickData.unoccupyingIndices.add(index);
  }

  public tick(): {
    removedIds: Set<number>;
    addedIds: Set<number>;
    addedObserverIds: Set<number>;
  } {
    if (this.disposed) {
      return { removedIds: new Set(), addedIds: new Set(), addedObserverIds: new Set() };
    }

    this.preTickData.componentsUpdated = 0;

    const removedIds: Set<number> = new Set();
    const addedIds: Set<number> = new Set();
    const addedObserverIds: Set<number> = new Set();

    // Determine the indices of the removed connections. Send the original indices to the clients so they can be removed.
    const sortedUnoccupyingIndices = Array.from(this.preTickData.unoccupyingIndices);
    sortedUnoccupyingIndices.sort((a, b) => a - b);

    // Apply the unoccupying indices to the component and state collections
    for (const componentCollection of this.components.values()) {
      componentCollection.removeIndices(sortedUnoccupyingIndices);
    }
    for (const stateCollection of this.states.values()) {
      stateCollection.removeIndices(sortedUnoccupyingIndices);
    }

    for (const index of sortedUnoccupyingIndices) {
      const connectionId = this.componentIndexToConnectionId.get(index);
      if (connectionId === undefined) {
        throw new Error("Connection id not found for index " + index);
      }
      removedIds.add(connectionId);
      this.connectionIdToComponentIndex.delete(connectionId);
      this.componentIndexToConnectionId.delete(index);
    }

    let writeIndex = 0;
    let skipIndex = 0;
    for (let i = 0; i < this.nextIndex; i++) {
      // Fix the indices of the maps to connectionId
      const connectionId = this.componentIndexToConnectionId.get(i);

      // Skip indices that should be removed
      if (
        skipIndex < sortedUnoccupyingIndices.length &&
        i === sortedUnoccupyingIndices[skipIndex]
      ) {
        skipIndex++;
        continue;
      }

      // Shift values to the left (in-place)
      if (writeIndex !== i) {
        if (connectionId === undefined) {
          throw new Error("Connection id not found for index " + i);
        }
        this.componentIndexToConnectionId.set(writeIndex, connectionId);
        this.connectionIdToComponentIndex.set(connectionId, writeIndex);
      }
      writeIndex++;
    }

    // Clean up stale entries left behind by the shift
    for (let i = writeIndex; i < this.nextIndex; i++) {
      this.componentIndexToConnectionId.delete(i);
    }

    // Now decrement the nextIndex to reflect the removed indices
    this.nextIndex -= sortedUnoccupyingIndices.length;

    // Track connections that fail to send so they can be cleaned up at the end
    const failedConnections = new Set<DeltaNetConnection>();

    // handle new joiners
    for (const connection of this.preTickData.newJoinerConnections) {
      const internalConnectionId = connection.internalConnectionId;

      if (connection.isObserver) {
        // Observers don't get indices assigned
        addedObserverIds.add(internalConnectionId);
      } else {
        // Regular participants get indices assigned
        const index = this.nextIndex++;

        this.connectionIdToComponentIndex.set(internalConnectionId, index);
        this.componentIndexToConnectionId.set(index, internalConnectionId);
        addedIds.add(internalConnectionId);

        // Create new collections for any components or states that are not already present
        for (const [componentId] of connection.components) {
          if (!this.components.has(componentId)) {
            this.components.set(componentId, new ComponentCollection());
          }
        }
        for (const [stateId] of connection.states) {
          if (!this.states.has(stateId)) {
            this.states.set(stateId, new StateCollection());
          }
        }

        for (const [componentId, collection] of this.components) {
          const value = connection.components.get(componentId);
          if (value === undefined) {
            collection.setValue(index, 0n);
          } else {
            collection.setValue(index, BigInt(value));
          }
        }

        for (const [stateId, collection] of this.states) {
          const value = connection.states.get(stateId);
          if (
            this.opts.serverConnectionIdStateId !== undefined &&
            stateId === this.opts.serverConnectionIdStateId
          ) {
            const writer = new BufferWriter(8);
            writer.writeUVarint(internalConnectionId);
            const buffer = writer.getBuffer();
            collection.setValue(index, buffer);
          } else {
            if (value === undefined) {
              collection.setValue(index, null);
            } else {
              collection.setValue(index, value);
            }
          }
        }

        if (!connection.sendMessage({ type: "userIndex", index })) {
          failedConnections.add(connection);
        }
      }
    }

    for (const callback of this.preTickData.newJoinerCallbacks) {
      const index = this.nextIndex++;
      const result = callback(index);
      if (result === null) {
        // If the callback returns false, the index is not used and should be decremented
        this.nextIndex--;
      } else {
        const { id, afterAddCallback } = result;
        this.connectionIdToComponentIndex.set(id, index);
        this.componentIndexToConnectionId.set(index, id);
        addedIds.add(id);

        if (this.opts.serverConnectionIdStateId !== undefined) {
          const writer = new BufferWriter(8);
          writer.writeUVarint(id);
          const buffer = writer.getBuffer();
          this.setUserState(index, this.opts.serverConnectionIdStateId, buffer);
        }
        if (afterAddCallback) {
          afterAddCallback();
        }
      }
    }

    const componentDeltas: Array<DeltaNetComponentTick> = [];
    for (const [componentId, collection] of this.components) {
      const { deltaDeltas } = collection.tick();
      componentDeltas.push({ componentId, deltaDeltas });
    }
    const stateDeltas: Array<DeltaNetStateUpdates> = [];
    for (const [stateId, collection] of this.states) {
      const updatedStates: Array<[number, Uint8Array]> = collection.tick();
      if (updatedStates.length === 0) {
        continue;
      }
      stateDeltas.push({
        stateId,
        updatedStates,
      });
    }

    const tickMessage: DeltaNetTick = {
      type: "tick",
      serverTime: this.getServerTime(),
      removedIndices: sortedUnoccupyingIndices,
      indicesCount: this.nextIndex,
      componentDeltaDeltas: componentDeltas,
      states: stateDeltas,
    };

    // Encode tick for v0.1 connections (only if there are v0.1 connections)
    if (this.authenticatedV01Connections.size > 0) {
      const v01Writer = new BufferWriter(this.nextIndex * this.components.size + 128);
      encodeTick(tickMessage, v01Writer);
      const v01EncodedTick = v01Writer.getBuffer();
      this.authenticatedV01Connections.forEach((connection) => {
        if (!connection.sendEncodedBytes(v01EncodedTick)) {
          failedConnections.add(connection);
        }
      });
    }

    // Encode tick for v0.2 connections (only if there are v0.2 connections)
    if (this.authenticatedV02Connections.size > 0) {
      const v02Writer = new BufferWriter(this.nextIndex * this.components.size + 128);
      encodeTickV02(tickMessage, v02Writer);
      const v02EncodedTick = v02Writer.getBuffer();
      this.authenticatedV02Connections.forEach((connection) => {
        if (!connection.sendEncodedBytes(v02EncodedTick)) {
          failedConnections.add(connection);
        }
      });
    }

    // Handle the initial checkout for new joiners

    if (this.preTickData.newJoinerConnections.size > 0) {
      const components: Array<DeltaNetInitialCheckoutComponent> = [];
      for (const [componentId, collection] of this.components) {
        components.push({
          componentId,
          values: collection.getCurrentValuesArray(),
          deltas: collection.getPreviousEmittedDeltasArray(),
        });
      }

      const states: Array<DeltaNetInitialCheckoutState> = [];
      for (const [stateId, collection] of this.states) {
        states.push({
          stateId,
          values: collection.values,
        });
      }

      const initialCheckout = {
        type: "initialCheckout",
        components,
        states,
        indicesCount: this.nextIndex,
        serverTime: this.getServerTime(),
      } satisfies DeltaNetInitialCheckoutMessage;

      // Separate new joiners by protocol version
      const v01NewJoiners: Array<DeltaNetConnection> = [];
      const v02NewJoiners: Array<DeltaNetConnection> = [];
      for (const connection of this.preTickData.newJoinerConnections) {
        switch (connection.protocolVersion) {
          case deltaNetProtocolSubProtocol_v0_1:
            v01NewJoiners.push(connection);
            break;
          case deltaNetProtocolSubProtocol_v0_2:
            v02NewJoiners.push(connection);
            break;
          default: {
            const _exhaustive: never = connection.protocolVersion;
            throw new Error(`Unknown protocol version: ${_exhaustive}`);
          }
        }
      }

      if (v01NewJoiners.length > 0) {
        const v01Writer = new BufferWriter(this.nextIndex * this.components.size + 128);
        encodeInitialCheckout(initialCheckout, v01Writer);
        const v01EncodedInitialCheckout = v01Writer.getBuffer();
        for (const connection of v01NewJoiners) {
          if (!connection.sendEncodedBytes(v01EncodedInitialCheckout)) {
            failedConnections.add(connection);
          }
        }
      }

      if (v02NewJoiners.length > 0) {
        const v02Writer = new BufferWriter(this.nextIndex * this.components.size + 128);
        encodeInitialCheckoutV02(initialCheckout, v02Writer);
        const v02EncodedInitialCheckout = v02Writer.getBuffer();
        for (const connection of v02NewJoiners) {
          if (!connection.sendEncodedBytes(v02EncodedInitialCheckout)) {
            failedConnections.add(connection);
          }
        }
      }
    }

    for (const connection of this.preTickData.newJoinerConnections) {
      if (failedConnections.has(connection)) {
        continue;
      }
      this.addToAuthenticatedSets(connection);
      connection.setAuthenticated();
    }

    // Clear pre-tick data before failed connection cleanup so that any
    // unoccupying indices added by removeWebSocket persist to the next tick.
    this.preTickData.unoccupyingIndices.clear();
    this.preTickData.newJoinerConnections.clear();
    this.preTickData.newJoinerCallbacks.clear();

    // Clean up connections that failed to send (tick or initial checkout).
    // This must happen AFTER clearing unoccupyingIndices above, because
    // removeWebSocket -> clearInternalConnectionId adds the failed connection's
    // index to unoccupyingIndices, which needs to be processed on the next tick.
    for (const connection of failedConnections) {
      try {
        this.removeWebSocket(connection.webSocket);
      } catch (cleanupError) {
        console.warn("Failed to clean up connection after send failure:", cleanupError);
      }
    }

    return {
      removedIds,
      addedIds,
      addedObserverIds,
    };
  }

  public getServerTime(): number {
    return Date.now() - this.documentEffectiveStartTime;
  }

  public setUserComponents(
    connection: DeltaNetConnection,
    internalConnectionId: number,
    components: Array<[number, bigint]>,
  ): { success: true } | { success: false; error: string } {
    if (this.disposed) {
      console.error("Cannot dispatch remote event after dispose");
      return { success: false, error: "This DeltaNetServer has been disposed" };
    }

    // Observers cannot send component updates
    if (connection.isObserver) {
      return { success: false, error: "Observers cannot send component updates" };
    }

    // Call onComponentsUpdate callback if provided
    if (this.opts.onComponentsUpdate) {
      try {
        const result = this.opts.onComponentsUpdate({
          connection,
          internalConnectionId,
          components,
        });

        if (result instanceof DeltaNetServerError) {
          return { success: false, error: result.message };
        }
        if (result instanceof Error) {
          return { success: false, error: result.message };
        }
      } catch (error) {
        console.warn("Error in onComponentsUpdate callback:", error);
        if (error instanceof DeltaNetServerError) {
          return { success: false, error: error.message };
        }
        if (error instanceof Error) {
          return { success: false, error: error.message };
        }
        return { success: false, error: "Component update failed" };
      }
    }

    // Apply component updates immediately (components don't have async validation)
    this.applyComponentUpdates(connection, internalConnectionId, components);

    return { success: true };
  }

  public setComponentValue(componentId: number, index: number, value: bigint): void {
    this.preTickData.componentsUpdated++;
    let collection = this.components.get(componentId);
    if (!collection) {
      collection = new ComponentCollection();
      this.components.set(componentId, collection);
    }
    collection.setValue(index, value);
  }

  private applyComponentUpdates(
    connection: DeltaNetConnection,
    internalConnectionId: number,
    components: Array<[number, bigint]>,
  ): void {
    if (this.preTickData.newJoinerConnections.has(connection)) {
      for (const [componentId, componentValue] of components) {
        connection.components.set(componentId, componentValue);
      }
      return;
    }

    const index = this.connectionIdToComponentIndex.get(internalConnectionId);
    if (index === undefined) {
      // Connection was likely removed - this is expected behavior
      return;
    }

    for (const [componentId, componentValue] of components) {
      this.setComponentValue(componentId, index, componentValue);
    }
  }

  public overrideUserStates(
    connection: DeltaNetConnection | null,
    internalConnectionId: number,
    states: Array<[number, Uint8Array]>,
  ) {
    this.applyStateUpdates(connection, internalConnectionId, states);
  }

  public setUserState(index: number, stateId: number, stateValue: Uint8Array) {
    let collection = this.states.get(stateId);
    if (!collection) {
      collection = new StateCollection();
      this.states.set(stateId, collection);
    }
    collection.setValue(index, stateValue);
  }

  private applyStateUpdates(
    connection: DeltaNetConnection | null,
    internalConnectionId: number,
    states: Array<[number, Uint8Array]>,
  ): void {
    if (connection !== null && this.preTickData.newJoinerConnections.has(connection)) {
      for (const [stateId, stateValue] of states) {
        connection.states.set(stateId, stateValue);
      }
      return;
    }

    const index = this.connectionIdToComponentIndex.get(internalConnectionId);
    if (index === undefined) {
      // Connection was likely removed while async validation was pending
      // This is expected behavior and not an error
      return;
    }

    for (const [stateId, stateValue] of states) {
      this.setUserState(index, stateId, stateValue);
    }
  }

  public handleCustomMessage(
    connection: DeltaNetConnection,
    internalConnectionId: number,
    customType: number,
    contents: string,
  ): void {
    if (this.disposed) {
      return;
    }

    // Call custom message callback if provided
    if (this.opts.onCustomMessage) {
      try {
        this.opts.onCustomMessage({
          connection,
          internalConnectionId,
          customType,
          contents,
        });
      } catch (error) {
        console.warn("Error in onCustomMessage callback:", error);
      }
    }
  }

  public sendCustomMessageToConnection(
    connectionId: number,
    customType: number,
    contents: string,
  ): void {
    if (this.disposed) {
      return;
    }

    const connection = this.connectionIdToConnection.get(connectionId);
    if (!connection) {
      return;
    }

    const writer = new BufferWriter(contents.length + 16);
    encodeServerCustom({ type: "serverCustom", customType, contents }, writer);
    const messageBytes = writer.getBuffer();

    connection.sendEncodedBytes(messageBytes);
  }

  public broadcastCustomMessage(customType: number, contents: string): void {
    if (this.disposed) {
      return;
    }

    const writer = new BufferWriter(contents.length + 16);
    // serverCustom encoding is identical across all protocol versions, so we encode once and broadcast.
    encodeServerCustom({ type: "serverCustom", customType, contents }, writer);
    const messageBytes = writer.getBuffer();

    for (const connection of this.authenticatedConnections) {
      connection.sendEncodedBytes(messageBytes);
    }
  }

  public dispose(): void {
    this.disposed = true;

    // Dispose and close all active connections
    const connectionsToClose = Array.from(this.allConnections);
    for (const connection of connectionsToClose) {
      try {
        connection.dispose();
        connection.webSocket.close(1001, "Server shutting down");
      } catch (error) {
        console.warn("Failed to close connection during disposal:", error);
      }
    }

    // Clear all internal data structures
    this.allConnections.clear();
    this.authenticatedConnections.clear();
    this.authenticatedV01Connections.clear();
    this.authenticatedV02Connections.clear();
    this.observerConnections.clear();
    this.webSocketToConnection.clear();
    this.connectionIdToConnection.clear();
    this.connectionIdToComponentIndex.clear();
    this.componentIndexToConnectionId.clear();
    this.components.clear();
    this.states.clear();
    this.preTickData.newJoinerConnections.clear();
    this.preTickData.unoccupyingIndices.clear();
  }
}
