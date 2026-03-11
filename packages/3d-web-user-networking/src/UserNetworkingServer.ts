import { encodeError, DeltaNetServerErrors } from "@mml-io/delta-net-protocol";
import {
  DeltaNetConnection,
  DeltaNetServer,
  DeltaNetServerError,
  onComponentsUpdateOptions,
  onCustomMessageOptions,
  onJoinerOptions,
  onLeaveOptions,
  onStatesUpdateOptions,
} from "@mml-io/delta-net-server";

import {
  DeltaNetComponentMapping,
  STATE_CHARACTER_DESCRIPTION,
  STATE_COLORS,
  STATE_USERNAME,
} from "./DeltaNetComponentMapping";
import { UserData } from "./UserData";
import { UserNetworkingConsoleLogger, UserNetworkingLogger } from "./UserNetworkingLogger";
import { UserNetworkingServerError, CharacterDescription } from "./UserNetworkingMessages";

export type UserNetworkingServerClient = {
  socket: WebSocket;
  connectionId: number;
  lastPong: number;
  authenticatedUser: UserData | null;
  deltaNetConnection: DeltaNetConnection;
};

export type UserNetworkingServerOptions = {
  onClientConnect: (
    connectionId: number,
    sessionToken: string,
    userIdentity?: UserData,
  ) => Promise<UserData | true | Error> | UserData | true | Error;
  onClientUserIdentityUpdate: (
    connectionId: number,
    userIdentity: UserData,
  ) => Promise<UserData | null | false | true | Error> | UserData | null | false | true | Error;
  onClientDisconnect: (connectionId: number) => void;
  onClientAuthenticated?: (connectionId: number) => void;
  /**
   * Callback invoked when a client sends a custom (non-deltanet) message.
   * The higher-level server (e.g. Networked3dWebExperienceServer) should use
   * this to handle application-specific message types such as chat.
   */
  onCustomMessage?: (connectionId: number, customType: number, contents: string) => void;
  /**
   * Maps a WebSocket sub-protocol (negotiated at the HTTP upgrade) to the
   * corresponding delta-net sub-protocol string used on the wire.
   *
   * Return values:
   *  - `string`    — accept the connection using the returned delta-net sub-protocol.
   *  - `null`      — reject the connection (unsupported protocol).
   *  - `undefined` — accept the connection without specifying a delta-net sub-protocol.
   *
   * If this callback is not provided the WebSocket protocol string is passed
   * through to delta-net as-is.
   */
  resolveProtocol?: (websocketProtocol: string) => string | null | undefined;
};

export class UserNetworkingServer {
  private deltaNetServer: DeltaNetServer;
  private authenticatedClientsById: Map<number, UserNetworkingServerClient> = new Map();
  private tickInterval: NodeJS.Timeout;

  constructor(
    private options: UserNetworkingServerOptions,
    private logger: UserNetworkingLogger = new UserNetworkingConsoleLogger(),
  ) {
    this.deltaNetServer = new DeltaNetServer({
      serverConnectionIdStateId: 0,
      onJoiner: (joiner: onJoinerOptions) => {
        return this.handleJoiner(joiner);
      },
      onLeave: (leave: onLeaveOptions) => {
        this.handleLeave(leave);
      },
      onComponentsUpdate: (update: onComponentsUpdateOptions) => {
        // TODO - potentially check that components are valid (e.g. rotation is 0 to 2pi)
        return; // No error
      },
      onStatesUpdate: (update: onStatesUpdateOptions) => {
        return this.handleStatesUpdate(update);
      },
      onCustomMessage: (customMessage: onCustomMessageOptions) => {
        this.handleCustomMessage(customMessage);
      },
    });

    // Start the deltanet server tick
    this.tickInterval = setInterval(() => {
      const { addedIds, addedObserverIds } = this.deltaNetServer.tick();
      if (this.options.onClientAuthenticated) {
        for (const connectionId of addedIds) {
          this.options.onClientAuthenticated(connectionId);
        }
        for (const connectionId of addedObserverIds) {
          this.options.onClientAuthenticated(connectionId);
        }
      }
    }, 50);
  }

  private handleStatesUpdate(
    update: onStatesUpdateOptions,
  ):
    | DeltaNetServerError
    | void
    | { success: true; stateOverrides?: Array<[number, Uint8Array]> }
    | Promise<
        DeltaNetServerError | void | { success: true; stateOverrides?: Array<[number, Uint8Array]> }
      > {
    const deltaNetConnection = update.connection;
    const connectionId = deltaNetConnection.internalConnectionId;
    const updatedStates = update.states;
    const updatedStatesMap = new Map<number, Uint8Array>(updatedStates);
    const updatedUserData: UserData = DeltaNetComponentMapping.fromUserStates(
      updatedStatesMap,
      this.logger,
    );

    const existingClient = this.authenticatedClientsById.get(connectionId);
    if (!existingClient) {
      return new DeltaNetServerError(
        DeltaNetServerErrors.USER_AUTHENTICATION_FAILED_ERROR_TYPE,
        "User not authenticated - no client found",
        false,
      );
    }
    const existingUserData = existingClient.authenticatedUser ?? {};
    const userData = {
      ...existingUserData,
      ...updatedUserData,
    };

    const res = this.options.onClientUserIdentityUpdate(connectionId, userData);
    if (res instanceof Promise) {
      return res.then((res) => {
        if (!this.authenticatedClientsById.get(connectionId)) {
          return new DeltaNetServerError(
            DeltaNetServerErrors.USER_AUTHENTICATION_FAILED_ERROR_TYPE,
            "User not authenticated - client disconnected",
            false,
          );
        }

        if (res instanceof DeltaNetServerError) {
          return res;
        }
        if (res instanceof Error) {
          return new DeltaNetServerError(
            DeltaNetServerErrors.USER_AUTHENTICATION_FAILED_ERROR_TYPE,
            "User identity update failed",
            false,
          );
        }
        if (res === null) {
          return new DeltaNetServerError(
            DeltaNetServerErrors.USER_AUTHENTICATION_FAILED_ERROR_TYPE,
            "User identity update failed",
            false,
          );
        }
        if (res === false) {
          return new DeltaNetServerError(
            DeltaNetServerErrors.USER_AUTHENTICATION_FAILED_ERROR_TYPE,
            "User identity update failed",
            false,
          );
        }
        if (res === true) {
          // Accept the client's update as-is — merge into the server record
          // and let the original state pass through without overrides.
          existingClient.authenticatedUser = {
            ...existingClient.authenticatedUser,
            ...updatedUserData,
          };
          return { success: true };
        }
        if (!res || typeof res !== "object") {
          return new DeltaNetServerError(
            DeltaNetServerErrors.USER_AUTHENTICATION_FAILED_ERROR_TYPE,
            "User identity update failed",
            false,
          );
        }

        existingClient.authenticatedUser = {
          ...existingClient.authenticatedUser,
          ...res,
        };

        return {
          success: true,
          stateOverrides: Array.from(
            DeltaNetComponentMapping.toStates(existingClient.authenticatedUser).entries(),
          ),
        };
      });
    }
    if (res instanceof DeltaNetServerError) {
      return res;
    }
    if (res instanceof Error) {
      return new DeltaNetServerError(
        DeltaNetServerErrors.USER_AUTHENTICATION_FAILED_ERROR_TYPE,
        "User identity update failed",
        false,
      );
    }
    if (res === null) {
      return new DeltaNetServerError(
        DeltaNetServerErrors.USER_AUTHENTICATION_FAILED_ERROR_TYPE,
        "User identity update failed",
        false,
      );
    }
    if (res === false) {
      return new DeltaNetServerError(
        DeltaNetServerErrors.USER_AUTHENTICATION_FAILED_ERROR_TYPE,
        "User identity update failed",
        false,
      );
    }
    if (res === true) {
      // Accept the client's update as-is — merge into the server record
      // and let the original state pass through without overrides.
      existingClient.authenticatedUser = {
        ...existingClient.authenticatedUser,
        ...updatedUserData,
      };
      return { success: true };
    }
    if (!res || typeof res !== "object") {
      return new DeltaNetServerError(
        DeltaNetServerErrors.USER_AUTHENTICATION_FAILED_ERROR_TYPE,
        "User identity update failed",
        false,
      );
    }

    existingClient.authenticatedUser = {
      ...existingClient.authenticatedUser,
      ...res,
    };

    return {
      success: true,
      stateOverrides: Array.from(
        DeltaNetComponentMapping.toStates(existingClient.authenticatedUser).entries(),
      ),
    };
  }

  private handleJoiner(
    joiner: onJoinerOptions,
  ):
    | DeltaNetServerError
    | void
    | { success: true; stateOverrides?: Array<[number, Uint8Array]> }
    | Promise<
        DeltaNetServerError | void | { success: true; stateOverrides?: Array<[number, Uint8Array]> }
      > {
    const deltaNetConnection = joiner.connection;
    const webSocket = deltaNetConnection.webSocket as unknown as WebSocket;
    const states = joiner.states as Array<[number, Uint8Array]>;
    const connectionId = joiner.internalConnectionId;

    const statesMap = new Map<number, Uint8Array>(states);
    const userData: UserData = DeltaNetComponentMapping.fromUserStates(statesMap, this.logger);

    // Handle authentication and return the result with state overrides
    return this.handleDeltaNetAuthentication(
      connectionId,
      webSocket,
      deltaNetConnection,
      joiner.token,
      userData,
    )
      .then((authResult) => {
        if (!authResult.success) {
          // Authentication failed - return error to reject connection
          this.logger.warn(
            `Authentication failed for connection ID: ${connectionId}`,
            authResult.error,
          );
          return new DeltaNetServerError(
            DeltaNetServerErrors.USER_AUTHENTICATION_FAILED_ERROR_TYPE,
            authResult.error?.message || "Authentication failed",
            false,
          );
        } else {
          // Return success with state overrides
          return {
            success: true as const,
            stateOverrides: authResult.stateOverrides,
          };
        }
      })
      .catch((error) => {
        this.logger.error(`Authentication error for connection ID: ${connectionId}:`, error);
        return new DeltaNetServerError(
          DeltaNetServerErrors.USER_AUTHENTICATION_FAILED_ERROR_TYPE,
          "Authentication error",
          false,
        );
      });
  }

  private handleLeave(leave: onLeaveOptions): void {
    const deltaNetConnection = leave.connection;
    const connectionId = deltaNetConnection.internalConnectionId;

    if (connectionId !== undefined) {
      const client = this.authenticatedClientsById.get(connectionId);
      if (client) {
        this.options.onClientDisconnect(connectionId);
        this.authenticatedClientsById.delete(connectionId);
      }
    }
  }

  private handleCustomMessage(customMessage: onCustomMessageOptions): void {
    const deltaNetConnection = customMessage.connection;
    const connectionId = deltaNetConnection.internalConnectionId;

    const client = this.authenticatedClientsById.get(connectionId);
    if (client && client.authenticatedUser) {
      this.options.onCustomMessage?.(
        connectionId,
        customMessage.customType,
        customMessage.contents,
      );
    } else {
      this.logger.warn(`Custom message from unauthenticated client ${connectionId} - ignoring`);
    }
  }

  private async handleDeltaNetAuthentication(
    connectionId: number,
    webSocket: WebSocket,
    deltaNetConnection: DeltaNetConnection,
    sessionToken: string,
    userIdentity: UserData,
  ): Promise<
    | { success: true; stateOverrides?: Array<[number, Uint8Array]> }
    | { success: false; error?: Error }
  > {
    try {
      // For observers, we might want to allow anonymous access or use a different authentication flow
      let onClientConnectReturn = deltaNetConnection.isObserver
        ? null // Observers don't need user data
        : await this.options.onClientConnect(connectionId, sessionToken, userIdentity);

      if (!deltaNetConnection.isObserver && !onClientConnectReturn) {
        this.logger.warn(
          `Authentication failed for connection ${connectionId} - no user data returned`,
        );
        return { success: false };
      }

      if (onClientConnectReturn instanceof Error) {
        return { success: false, error: onClientConnectReturn };
      }

      if (onClientConnectReturn === true) {
        onClientConnectReturn = userIdentity;
      }

      // Auto-generate userId if not provided by the authenticator
      if (onClientConnectReturn && !onClientConnectReturn.userId) {
        onClientConnectReturn = {
          ...onClientConnectReturn,
          userId: crypto.randomUUID(),
        };
      }

      const authenticatedUser: UserData | null = onClientConnectReturn;

      // Create authenticated client
      const authenticatedClient: UserNetworkingServerClient = {
        connectionId,
        socket: webSocket,
        lastPong: Date.now(),
        authenticatedUser,
        deltaNetConnection: deltaNetConnection,
      };
      this.authenticatedClientsById.set(connectionId, authenticatedClient);

      // Create state overrides with the user data from the authenticator
      // Observers don't have user data, so no state overrides
      let stateOverrides: Array<[number, Uint8Array]> = [];
      if (onClientConnectReturn) {
        const officialStates = DeltaNetComponentMapping.toStates(onClientConnectReturn);
        stateOverrides = Array.from(officialStates.entries());
      }

      return {
        success: true,
        stateOverrides: stateOverrides,
      };
    } catch (error) {
      this.logger.error("Authentication error:", error);
      return { success: false };
    }
  }

  public connectClient(socket: WebSocket): void {
    // Map the negotiated WebSocket sub-protocol to the corresponding delta-net
    // sub-protocol used on the wire.
    const resolvedProtocol = this.options.resolveProtocol
      ? this.options.resolveProtocol(socket.protocol)
      : undefined;

    if (resolvedProtocol === null) {
      this.logger.warn(
        `Rejecting client: unsupported WebSocket sub-protocol "${socket.protocol}". ` +
          `resolveProtocol returned null, indicating no matching protocol version.`,
      );
      socket.close(1002, "Unsupported sub-protocol");
      return;
    }

    this.deltaNetServer.addWebSocket(
      socket as unknown as globalThis.WebSocket,
      resolvedProtocol ?? undefined,
    );

    socket.addEventListener("close", () => {
      this.deltaNetServer.removeWebSocket(socket as unknown as globalThis.WebSocket);
    });
  }

  public broadcastMessage(broadcastType: number, broadcastPayload: string): void {
    this.deltaNetServer.broadcastCustomMessage(broadcastType, broadcastPayload);
  }

  public sendCustomMessageToClient(
    connectionId: number,
    customType: number,
    payload: string,
  ): void {
    const client = this.authenticatedClientsById.get(connectionId);
    if (!client) {
      return;
    }
    this.deltaNetServer.sendCustomMessageToConnection(connectionId, customType, payload);
  }

  public getAuthenticatedUser(connectionId: number): UserData | null {
    const client = this.authenticatedClientsById.get(connectionId);
    return client?.authenticatedUser ?? null;
  }

  public updateUserCharacter(connectionId: number, userData: UserData): void {
    this.logger.info("updateUserCharacter", connectionId, userData);
    this.internalUpdateUser(connectionId, userData);
  }

  public updateUserUserId(connectionId: number, userId: string): void {
    const client = this.authenticatedClientsById.get(connectionId);
    if (!client || !client.authenticatedUser) return;

    client.authenticatedUser = {
      ...client.authenticatedUser,
      userId,
    };

    const states = DeltaNetComponentMapping.toUserIdState(userId);
    const asArray = Array.from(states.entries());
    this.deltaNetServer.overrideUserStates(client.deltaNetConnection, connectionId, asArray);
  }

  public updateUserUsername(connectionId: number, username: string): void {
    const client = this.authenticatedClientsById.get(connectionId);
    if (!client || !client.authenticatedUser) return;

    // Update local user data by creating a new UserData object
    client.authenticatedUser = {
      ...client.authenticatedUser,
      username: username,
    };

    // Update deltanet states with just the username
    const states = DeltaNetComponentMapping.toUsernameState(username);
    const asArray = Array.from(states.entries());
    this.deltaNetServer.overrideUserStates(client.deltaNetConnection, connectionId, asArray);
  }

  public updateUserCharacterDescription(
    connectionId: number,
    characterDescription: CharacterDescription,
  ): void {
    const client = this.authenticatedClientsById.get(connectionId);
    if (!client || !client.authenticatedUser) return;

    // Update local user data by creating a new UserData object
    client.authenticatedUser = {
      ...client.authenticatedUser,
      characterDescription: characterDescription,
    };

    // Update deltanet states with just the character description
    const states = DeltaNetComponentMapping.toCharacterDescriptionState(characterDescription);
    const asArray = Array.from(states.entries());
    this.deltaNetServer.overrideUserStates(client.deltaNetConnection, connectionId, asArray);
  }

  public updateUserColors(connectionId: number, colors: Array<[number, number, number]>): void {
    const client = this.authenticatedClientsById.get(connectionId);
    if (!client || !client.authenticatedUser) return;

    // Update local user data by creating a new UserData object
    client.authenticatedUser = {
      ...client.authenticatedUser,
      colors: colors,
    };

    // Update deltanet states with just the colors
    const states = DeltaNetComponentMapping.toColorsState(colors);
    const asArray = Array.from(states.entries());
    this.deltaNetServer.overrideUserStates(client.deltaNetConnection, connectionId, asArray);
  }

  public updateUserStates(connectionId: number, updates: UserData): void {
    const client = this.authenticatedClientsById.get(connectionId);
    if (!client || !client.authenticatedUser) return;

    const states = new Map<number, Uint8Array>();
    let hasUpdates = false;
    let updatedUserData = client.authenticatedUser;

    // Update username if provided
    if (updates.username !== undefined) {
      updatedUserData = {
        ...updatedUserData,
        username: updates.username,
      };
      if (updates.username !== null) {
        const usernameStates = DeltaNetComponentMapping.toUsernameState(updates.username);
        for (const [stateId, stateValue] of usernameStates) {
          states.set(stateId, stateValue);
        }
      } else {
        states.set(STATE_USERNAME, new Uint8Array(0));
      }
      hasUpdates = true;
    }

    // Update character description if provided
    if (updates.characterDescription !== undefined) {
      updatedUserData = {
        ...updatedUserData,
        characterDescription: updates.characterDescription,
      };
      if (updates.characterDescription !== null) {
        const characterDescStates = DeltaNetComponentMapping.toCharacterDescriptionState(
          updates.characterDescription,
        );
        for (const [stateId, stateValue] of characterDescStates) {
          states.set(stateId, stateValue);
        }
      } else {
        states.set(STATE_CHARACTER_DESCRIPTION, new Uint8Array(0));
      }
      hasUpdates = true;
    }

    // Update colors if provided
    if (updates.colors !== undefined) {
      updatedUserData = {
        ...updatedUserData,
        colors: updates.colors,
      };
      if (updates.colors !== null) {
        const colorsStates = DeltaNetComponentMapping.toColorsState(updates.colors);
        for (const [stateId, stateValue] of colorsStates) {
          states.set(stateId, stateValue);
        }
      } else {
        states.set(STATE_COLORS, new Uint8Array(0));
      }
      hasUpdates = true;
    }

    // Only send update if there are changes
    if (hasUpdates) {
      client.authenticatedUser = updatedUserData;
      const asArray = Array.from(states.entries());
      this.deltaNetServer.overrideUserStates(client.deltaNetConnection, connectionId, asArray);
    }
  }

  private internalUpdateUser(connectionId: number, userData: UserData): void {
    const client = this.authenticatedClientsById.get(connectionId);
    if (!client) {
      throw new Error(`internalUpdateUser - client not found for connectionId ${connectionId}`);
    }
    this.logger.info("internalUpdateUser", connectionId, userData);

    client.authenticatedUser = {
      ...client.authenticatedUser,
      ...userData,
    };

    // Update deltanet states
    const states = DeltaNetComponentMapping.toStates(userData);

    const asArray = Array.from(states.entries());
    this.deltaNetServer.overrideUserStates(client.deltaNetConnection, connectionId, asArray);
  }

  public dispose(clientCloseError?: UserNetworkingServerError): void {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
    }

    let errorMessage: Uint8Array | null = null;
    if (clientCloseError) {
      errorMessage = encodeError({
        type: "error",
        errorType: clientCloseError.errorType,
        message: clientCloseError.message,
        retryable: clientCloseError.retryable,
      }).getBuffer();
    }

    // Close all client connections
    for (const [, client] of this.authenticatedClientsById) {
      if (errorMessage) {
        client.socket.send(errorMessage);
      }
      client.socket.close();
    }

    this.authenticatedClientsById.clear();
    this.deltaNetServer.dispose();
  }
}
