import {
  DeltaNetClientState,
  DeltaNetClientWebsocket,
  DeltaNetClientWebsocketInitialCheckout,
  DeltaNetClientWebsocketStatus,
  DeltaNetClientWebsocketTick,
  DeltaNetClientWebsocketUserIndex,
} from "@mml-io/delta-net-web";

import {
  DeltaNetComponentMapping,
  STATE_CHARACTER_DESCRIPTION,
  STATE_COLORS,
  STATE_INTERNAL_CONNECTION_ID,
  STATE_USER_ID,
  STATE_USERNAME,
} from "./DeltaNetComponentMapping";
import { UserNetworkingClientUpdate, WebsocketFactory, WebsocketStatus } from "./types";
import { UserData } from "./UserData";
import { UserNetworkingConsoleLogger, UserNetworkingLogger } from "./UserNetworkingLogger";
import { CharacterDescription } from "./UserNetworkingMessages";

export type UserNetworkingClientConfig = {
  url: string;
  sessionToken: string;
  websocketFactory: WebsocketFactory;
  statusUpdateCallback: (status: WebsocketStatus) => void;
  assignedIdentity: (connectionId: number) => void;
  onServerError: (error: { message: string; errorType: string }) => void;
  onCustomMessage?: (customType: number, contents: string) => void;
  onUpdate(update: NetworkUpdate): void;
  /**
   * Maps a WebSocket sub-protocol (negotiated at the HTTP upgrade) to the
   * corresponding delta-net sub-protocol string used on the wire.
   *
   * If not provided the WebSocket protocol string is passed through to
   * delta-net as-is.
   */
  resolveProtocol?: (websocketProtocol: string) => string | null;
};

export type AddedUser = {
  userState: UserData;
  components: UserNetworkingClientUpdate;
};

export type UpdatedUser = {
  userState?: Partial<UserData>;
  components: UserNetworkingClientUpdate;
};

export type NetworkUpdate = {
  removedConnectionIds: Set<number>;
  addedConnectionIds: Map<number, AddedUser>;
  updatedUsers: Map<number, UpdatedUser>;
};

export class UserNetworkingClient {
  private deltaNetClient: DeltaNetClientWebsocket;
  private deltaNetState: DeltaNetClientState;

  private connectionId: number | null = null;
  private userIndex: number | null = null;
  private userState: UserData = {
    userId: "",
    username: null,
    characterDescription: null,
    colors: null,
  };

  private stableIdToConnectionId: Map<number, number> = new Map();
  private userProfiles: Map<number, UserData> = new Map();
  private isAuthenticated = false;

  // Reused across calls to `processNetworkUpdate` (~30 Hz). Cleared at the
  // start of each call and repopulated. Consumers (notably
  // `Networked3dWebExperienceClient.onNetworkUpdate`) read these maps
  // synchronously and don't retain references — safe to reuse.
  private readonly _addedConnectionIdsScratch = new Map<number, AddedUser>();
  private readonly _removedConnectionIdsScratch = new Set<number>();
  private readonly _updatedUsersScratch = new Map<number, UpdatedUser>();
  // Per-connId pools — one persistent UserNetworkingClientUpdate +
  // UpdatedUser wrapper per active connection. The pooled
  // UserNetworkingClientUpdate is also the value `Networked3dWebExperienceClient`
  // stores into its `remoteUserStates` map, so mutating in place each tick
  // makes the new values visible without re-allocating the wrapper.
  // Entries removed from the pool when the connection is removed.
  private readonly _componentsPool = new Map<number, UserNetworkingClientUpdate>();
  private readonly _updatedUserPool = new Map<number, UpdatedUser>();
  private pendingUpdate: UserNetworkingClientUpdate;

  constructor(
    private config: UserNetworkingClientConfig,
    initialUserState?: UserData,
    initialUpdate?: UserNetworkingClientUpdate,
    private logger: UserNetworkingLogger = new UserNetworkingConsoleLogger(),
  ) {
    this.pendingUpdate = initialUpdate ?? {
      position: { x: 0, y: 0, z: 0 },
      rotation: { eulerY: 0 },
      state: 0,
    };
    this.userState = initialUserState ?? {
      userId: "",
      username: null,
      characterDescription: null,
      colors: null,
    };
    this.deltaNetState = new DeltaNetClientState();

    // Create deltanet client
    this.deltaNetClient = new DeltaNetClientWebsocket(
      config.url,
      (url: string) => {
        const ws = config.websocketFactory(url);
        return ws;
      },
      config.sessionToken,
      {
        ignoreData: false,
        onInitialCheckout: (initialCheckout: DeltaNetClientWebsocketInitialCheckout) => {
          const { addedStableIds } = this.deltaNetState.handleInitialCheckout(initialCheckout);

          // Process any state updates
          const networkUpdate = this.processNetworkUpdate([], addedStableIds, []);
          this.config.onUpdate(networkUpdate);

          // Now that we have the connection IDs, resolve our stable ID from the userIndex
          if (this.userIndex !== null) {
            const stableIds = this.deltaNetState.getStableIds();
            if (this.userIndex < stableIds.length) {
              const stableId = stableIds[this.userIndex];
              const connId = this.stableIdToConnectionId.get(stableId);
              if (!connId) {
                throw new Error(`No connectionId found for stableId ${stableId}`);
              }
              this.connectionId = connId;
              this.isAuthenticated = true;
              this.config.assignedIdentity(this.connectionId);
            } else {
              this.logger.error(
                `Invalid userIndex ${this.userIndex}, stableIds length: ${stableIds.length}`,
              );
            }
          }
        },
        onTick: (tick: DeltaNetClientWebsocketTick) => {
          const { stateUpdates, removedStableIds, addedStableIds } =
            this.deltaNetState.handleTick(tick);
          // Process state updates
          const networkUpdate = this.processNetworkUpdate(
            removedStableIds,
            addedStableIds,
            stateUpdates,
          );
          this.config.onUpdate(networkUpdate);
        },
        onUserIndex: (userIndex: DeltaNetClientWebsocketUserIndex) => {
          // Store the userIndex and set it on deltanet state
          this.userIndex = userIndex.userIndex;
          this.deltaNetState.setLocalIndex(userIndex.userIndex);
        },
        onError: (errorType: string, errorMessage: string, retryable: boolean) => {
          this.logger.error(
            "DeltaNet error:",
            errorType,
            "errorMessage:",
            errorMessage,
            "retryable:",
            retryable,
          );
          this.config.onServerError({
            message: errorMessage,
            errorType: errorType,
          });
        },
        onWarning: (warning: string) => {
          this.logger.warn("DeltaNet warning:", warning);
        },
        onServerCustom: (customType: number, contents: string) => {
          // Handle server custom messages
          this.config.onCustomMessage?.(customType, contents);
        },
      },
      undefined, // timeCallback
      (status: DeltaNetClientWebsocketStatus) => {
        // Map deltanet status to websocket status
        let mappedStatus: WebsocketStatus;
        switch (status) {
          case DeltaNetClientWebsocketStatus.Connected:
            mappedStatus = WebsocketStatus.Connected;
            break;
          case DeltaNetClientWebsocketStatus.ConnectionOpen:
            this.sendInitialAuthentication();
            mappedStatus = WebsocketStatus.Connected;
            // Send initial authentication data immediately upon connection
            break;
          case DeltaNetClientWebsocketStatus.Disconnected:
            mappedStatus = WebsocketStatus.Disconnected;
            this.reset();
            break;
          case DeltaNetClientWebsocketStatus.Reconnecting:
            mappedStatus = WebsocketStatus.Reconnecting;
            this.reset();
            break;
          default:
            mappedStatus = WebsocketStatus.Disconnected;
        }
        this.config.statusUpdateCallback(mappedStatus);
      },
      config.resolveProtocol,
    );
  }

  private reset(): void {
    this.deltaNetState.reset();
    this.userProfiles.clear();
    this.stableIdToConnectionId.clear();
    this.isAuthenticated = false;
    this.connectionId = null;
    this.userIndex = null;
  }

  private sendInitialAuthentication(): void {
    // Send initial components and states to become "ready"
    const components = DeltaNetComponentMapping.toComponents(this.pendingUpdate);

    // Create initial states for user data
    const states = DeltaNetComponentMapping.toStates(this.userState);

    // Send to deltanet - this makes the client "ready" and triggers authentication
    this.deltaNetClient.setUserComponents(components, states);
  }

  private processNetworkUpdate(
    removedStableIds: number[],
    addedStableIdsArray: number[],
    stateUpdates: Array<{ stableId: number; stateId: number; state: Uint8Array }>,
  ): NetworkUpdate {
    // Reuse class-owned scratch maps across calls. Consumers must not
    // retain references past a single tick.
    const addedConnectionIds = this._addedConnectionIdsScratch;
    const removedConnectionIds = this._removedConnectionIdsScratch;
    const updatedUsers = this._updatedUsersScratch;
    addedConnectionIds.clear();
    removedConnectionIds.clear();
    updatedUsers.clear();

    for (const stableId of removedStableIds) {
      const connId = this.stableIdToConnectionId.get(stableId);
      if (connId) {
        removedConnectionIds.add(connId);

        // Remove from user profiles
        this.userProfiles.delete(connId);

        // Remove from stableIdToConnectionId
        this.stableIdToConnectionId.delete(stableId);

        // Drop pooled per-connId scratch — they're tied to a connection's
        // lifetime, so a new connection on the same id starts fresh.
        this._componentsPool.delete(connId);
        this._updatedUserPool.delete(connId);
      } else {
        throw new Error(`No connectionId found for stableId ${stableId}`);
      }
    }

    for (const stableId of addedStableIdsArray) {
      const stableUserData = this.deltaNetState.byStableId.get(stableId);
      if (!stableUserData) {
        throw new Error(`No stableUserData found for stableId ${stableId}`);
      }
      const connectionIdState = stableUserData.states.get(STATE_INTERNAL_CONNECTION_ID);
      if (!connectionIdState) {
        throw new Error(`No connectionIdState found for stableId ${stableId}`);
      }
      const connId = DeltaNetComponentMapping.userIdFromBytes(connectionIdState);
      if (!connId) {
        throw new Error(`Failed to extract connectionId from bytes for stableId ${stableId}`);
      }
      this.stableIdToConnectionId.set(stableId, connId);
      const newProfile = DeltaNetComponentMapping.fromStates(stableUserData.states, this.logger);
      this.userProfiles.set(connId, newProfile);
      // Allocate a per-connId components scratch and seed it from the
      // component map. Re-used in subsequent update ticks via mutation.
      const clientUpdate: UserNetworkingClientUpdate = {
        position: { x: 0, y: 0, z: 0 },
        rotation: { eulerY: 0 },
        state: 0,
      };
      DeltaNetComponentMapping.fromComponentsInto(stableUserData.components, clientUpdate);
      this._componentsPool.set(connId, clientUpdate);
      addedConnectionIds.set(connId, {
        userState: newProfile,
        components: clientUpdate,
      });
    }

    for (const [stableUserId, userInfo] of this.deltaNetState.byStableId) {
      const connId = this.stableIdToConnectionId.get(stableUserId);
      if (!connId) {
        throw new Error(`No connectionId found for stableUserId ${stableUserId}`);
      }
      if (!addedConnectionIds.has(connId)) {
        if (userInfo.components.size > 0) {
          // Mutate the per-connId pooled components in place. The same
          // reference also lives downstream in
          // `Networked3dWebExperienceClient.remoteUserStates` (set on the
          // initial ADD), so the new values are visible to readers
          // without us reseating the entry.
          let pooledComponents = this._componentsPool.get(connId);
          if (!pooledComponents) {
            // Defensive: shouldn't happen — every active connId is
            // seeded on add. Fall back to a fresh allocation.
            pooledComponents = {
              position: { x: 0, y: 0, z: 0 },
              rotation: { eulerY: 0 },
              state: 0,
            };
            this._componentsPool.set(connId, pooledComponents);
          }
          DeltaNetComponentMapping.fromComponentsInto(userInfo.components, pooledComponents);

          // Reuse the per-connId UpdatedUser wrapper.
          let pooledUpdated = this._updatedUserPool.get(connId);
          if (!pooledUpdated) {
            pooledUpdated = { components: pooledComponents };
            this._updatedUserPool.set(connId, pooledUpdated);
          } else {
            pooledUpdated.components = pooledComponents;
            // Clear any sticky userState left from a prior state-update
            // tick on this connId.
            pooledUpdated.userState = undefined;
          }
          updatedUsers.set(connId, pooledUpdated);
        }
      }
    }

    for (const update of stateUpdates) {
      // update.stableId is actually a stable user ID maintained by deltanet, not an index
      const stableUserId = update.stableId;

      const connId = this.stableIdToConnectionId.get(stableUserId);
      if (!connId) {
        throw new Error(`No connectionId found for stableUserId ${stableUserId}`);
      }

      if (addedConnectionIds.has(connId)) {
        continue;
      }

      const profile = this.userProfiles.get(connId);
      if (!profile) {
        this.logger.warn(`No profile found for connection ${connId}, skipping update`);
        continue;
      }
      let existingUpdate = updatedUsers.get(connId);
      if (!existingUpdate) {
        const stableUserData = this.deltaNetState.byStableId.get(stableUserId);
        const components = stableUserData
          ? DeltaNetComponentMapping.fromComponents(stableUserData.components)
          : { position: { x: 0, y: 0, z: 0 }, rotation: { eulerY: 0 }, state: 0 };
        existingUpdate = { components };
        updatedUsers.set(connId, existingUpdate);
      }
      let existingUserStateUpdate: Partial<UserData> | undefined = existingUpdate.userState;
      if (!existingUserStateUpdate) {
        existingUserStateUpdate = {};
        existingUpdate.userState = existingUserStateUpdate;
      }

      switch (update.stateId) {
        case STATE_INTERNAL_CONNECTION_ID:
          this.logger.error(
            "STATE_INTERNAL_CONNECTION_ID is not expected to change in state updates",
          );
          break;
        case STATE_USER_ID: {
          const persistentUserId = DeltaNetComponentMapping.persistentUserIdFromBytes(update.state);
          if (persistentUserId) {
            profile.userId = persistentUserId;
            existingUserStateUpdate.userId = persistentUserId;
          }
          break;
        }
        case STATE_USERNAME: {
          const username = DeltaNetComponentMapping.usernameFromBytes(update.state);
          if (username) {
            profile.username = username;
            existingUserStateUpdate.username = username;
          }
          break;
        }
        case STATE_CHARACTER_DESCRIPTION: {
          const characterDescription = DeltaNetComponentMapping.characterDescriptionFromBytes(
            update.state,
          );
          profile.characterDescription = characterDescription;
          existingUserStateUpdate.characterDescription = characterDescription;
          break;
        }
        case STATE_COLORS: {
          const colors = DeltaNetComponentMapping.decodeColors(update.state, this.logger);
          profile.colors = colors;
          existingUserStateUpdate.colors = colors;
          break;
        }
        default:
          this.logger.warn(`Unknown state ID: ${update.stateId}`);
      }
    }

    return {
      removedConnectionIds,
      addedConnectionIds,
      updatedUsers,
    };
  }

  public sendUpdate(update: UserNetworkingClientUpdate): void {
    if (!this.isAuthenticated || this.connectionId === null) {
      // Store the update to send after authentication
      this.pendingUpdate = update;
      return;
    }

    // Convert to deltanet components and send
    const components = DeltaNetComponentMapping.toComponents(update);
    this.deltaNetClient.setUserComponents(components, new Map());
  }

  public sendCustomMessage(customType: number, contents: string): void {
    if (!this.isAuthenticated || this.connectionId === null) {
      this.logger.warn("Cannot send custom message before authentication");
      return;
    }

    this.deltaNetClient.sendCustomMessage(customType, contents);
  }

  public updateUsername(username: string): void {
    if (!this.isAuthenticated || this.connectionId === null) {
      return;
    }

    // Update local state
    this.userState.username = username;

    // Send state update
    const states = DeltaNetComponentMapping.toUsernameState(username);
    this.deltaNetClient.setUserComponents(new Map(), states);
  }

  public updateCharacterDescription(characterDescription: CharacterDescription): void {
    if (!this.isAuthenticated || this.connectionId === null) {
      return;
    }

    // Update local state
    this.userState.characterDescription = characterDescription;

    // Send state update
    const states = DeltaNetComponentMapping.toCharacterDescriptionState(characterDescription);
    this.deltaNetClient.setUserComponents(new Map(), states);
  }

  public updateColors(colors: Array<[number, number, number]>): void {
    if (!this.isAuthenticated || this.connectionId === null) {
      return;
    }

    // Update local state
    this.userState.colors = colors;

    // Send state update
    const states = DeltaNetComponentMapping.toColorsState(colors);
    this.deltaNetClient.setUserComponents(new Map(), states);
  }

  public stop(): void {
    this.deltaNetClient.stop();
    this.reset();
  }
}
