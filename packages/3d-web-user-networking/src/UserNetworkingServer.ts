import { encodeError, DeltaNetV01ServerErrors } from "@deltanet/delta-net-protocol";
import {
  DeltaNetServer,
  DeltaNetServerError,
  DeltaNetV01Connection,
  onComponentsUpdateOptions,
  onCustomMessageOptions,
  onJoinerOptions,
  onLeaveOptions,
} from "@deltanet/delta-net-server";
import WebSocket from "ws";

import { DeltaNetComponentMapping } from "./DeltaNetComponentMapping";
import { UserNetworkingClientUpdate } from "./types";
import { UserData } from "./UserData";
import {
  FROM_CLIENT_CHAT_MESSAGE_TYPE,
  FROM_SERVER_CHAT_MESSAGE_TYPE,
  parseClientChatMessage,
  ServerChatMessage,
  UserIdentity,
  UserNetworkingServerError,
} from "./UserNetworkingMessages";

export type UserNetworkingServerClient = {
  socket: WebSocket;
  id: number;
  lastPong: number;
  update: UserNetworkingClientUpdate;
  authenticatedUser: UserData | null;
  deltaNetConnection?: DeltaNetV01Connection;
};

export type UserNetworkingServerOptions = {
  connectionLimit?: number;
  onClientConnect: (
    clientId: number,
    sessionToken: string,
    userIdentity?: Partial<UserIdentity>,
  ) => Promise<UserData | null> | UserData | null;
  onClientUserIdentityUpdate: (
    clientId: number,
    userIdentity: Partial<UserIdentity>,
  ) => Promise<UserData | null> | UserData | null;
  onClientDisconnect: (clientId: number) => void;
};

export class UserNetworkingServer {
  private deltaNetServer: DeltaNetServer;
  private authenticatedClientsById: Map<number, UserNetworkingServerClient> = new Map();
  private nextClientId = 1;
  private tickInterval: NodeJS.Timeout;

  constructor(private options: UserNetworkingServerOptions) {
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
      onCustomMessage: (customMessage: onCustomMessageOptions) => {
        this.handleCustomMessage(customMessage);
      },
    });

    // Start the deltanet server tick
    this.tickInterval = setInterval(() => {
      this.deltaNetServer.tick();
    }, 50);
  }

  private handleJoiner(
    joiner: onJoinerOptions,
  ):
    | DeltaNetServerError
    | void
    | Promise<
        DeltaNetServerError | void | { success: true; stateOverrides?: Array<[number, Uint8Array]> }
      > {
    const deltaNetConnection = joiner.deltaNetV01Connection as DeltaNetV01Connection;
    const webSocket = deltaNetConnection.webSocket as unknown as WebSocket;
    const states = joiner.states as Array<[number, Uint8Array]>;
    const clientId = this.nextClientId++;

    console.log(
      `Client ID: ${clientId} joined (observer: ${deltaNetConnection.isObserver}), authenticating...`,
    );

    const statesMap = new Map<number, Uint8Array>(states);
    const userData: Partial<UserIdentity> = DeltaNetComponentMapping.fromUserStates(statesMap);

    // Handle authentication and return the result with state overrides
    return this.handleDeltaNetAuthentication(
      clientId,
      webSocket,
      deltaNetConnection,
      joiner.token,
      userData,
    )
      .then((authResult) => {
        if (!authResult.success) {
          // Authentication failed - return error to reject connection
          console.log(`Authentication failed for client ID: ${clientId}`);
          return new DeltaNetServerError(
            DeltaNetV01ServerErrors.USER_AUTHENTICATION_FAILED_ERROR_TYPE,
            "Authentication failed",
            false,
          );
        } else {
          console.log(
            `Client ID: ${clientId} authenticated successfully`,
            authResult.stateOverrides,
          );
          // Return success with state overrides
          return {
            success: true as const,
            stateOverrides: authResult.stateOverrides,
          };
        }
      })
      .catch((error) => {
        console.error(`Authentication error for client ID: ${clientId}:`, error);
        return new DeltaNetServerError(
          DeltaNetV01ServerErrors.USER_AUTHENTICATION_FAILED_ERROR_TYPE,
          "Authentication error",
          false,
        );
      });
  }

  private handleLeave(leave: onLeaveOptions): void {
    const deltaNetConnection = leave.deltaNetV01Connection as DeltaNetV01Connection;
    const clientId = deltaNetConnection.internalConnectionId;

    if (clientId !== undefined) {
      const client = this.authenticatedClientsById.get(clientId);
      if (client) {
        console.log(`Client ID: ${clientId} left`);
        this.options.onClientDisconnect(clientId);
        this.authenticatedClientsById.delete(clientId);
      }
    }
  }

  private handleCustomMessage(customMessage: onCustomMessageOptions): void {
    const deltaNetConnection = customMessage.deltaNetV01Connection;
    const clientId = deltaNetConnection.internalConnectionId;

    const client = this.authenticatedClientsById.get(clientId);
    if (client && client.authenticatedUser) {
      console.log(
        `Custom message from client ${clientId} (${client.authenticatedUser.username}): type=${customMessage.customType}, content=${customMessage.contents}`,
      );

      // Handle chat messages
      if (customMessage.customType === FROM_CLIENT_CHAT_MESSAGE_TYPE) {
        const chatMessage = parseClientChatMessage(customMessage.contents);
        if (chatMessage instanceof Error) {
          console.error(`Invalid chat message from client ${clientId}:`, chatMessage);
        } else {
          const serverChatMessage: ServerChatMessage = {
            fromUserId: clientId,
            message: chatMessage.message,
          };
          // Broadcast the chat message to all other clients
          this.deltaNetServer.broadcastCustomMessage(
            FROM_SERVER_CHAT_MESSAGE_TYPE,
            JSON.stringify(serverChatMessage),
          );
        }
      }
    } else {
      console.warn(`Custom message from unauthenticated client ${clientId} - ignoring`);
    }
  }

  private async handleDeltaNetAuthentication(
    clientId: number,
    webSocket: WebSocket,
    deltaNetConnection: DeltaNetV01Connection,
    sessionToken: string,
    userIdentity: Partial<UserIdentity>,
  ): Promise<{ success: boolean; stateOverrides?: Array<[number, Uint8Array]> }> {
    try {
      console.log(
        `Authenticating client ${clientId} (observer: ${deltaNetConnection.isObserver}) with session token: ${sessionToken.substring(0, 10)}...`,
      );

      // For observers, we might want to allow anonymous access or use a different authentication flow
      const userData = deltaNetConnection.isObserver
        ? null // Observers don't need user data
        : await this.options.onClientConnect(clientId, sessionToken, userIdentity);

      console.log(`Authentication result for client ${clientId}:`, {
        success: deltaNetConnection.isObserver || !!userData,
        isObserver: deltaNetConnection.isObserver,
        username: userData?.username,
        characterDescription: userData?.characterDescription,
      });

      if (!deltaNetConnection.isObserver && !userData) {
        console.log(`Authentication failed for client ${clientId} - no user data returned`);
        return { success: false };
      }

      // Check connection limit
      if (
        this.options.connectionLimit !== undefined &&
        this.authenticatedClientsById.size >= this.options.connectionLimit
      ) {
        console.log(`Connection limit reached for client ${clientId}`);
        return { success: false };
      }

      // Create authenticated client
      const authenticatedClient: UserNetworkingServerClient = {
        id: clientId,
        socket: webSocket,
        lastPong: Date.now(),
        authenticatedUser: userData,
        deltaNetConnection: deltaNetConnection,
        update: {
          id: clientId,
          position: { x: 0, y: 0, z: 0 },
          rotation: { quaternionY: 0, quaternionW: 1 },
          state: 0,
        },
      };

      this.authenticatedClientsById.set(clientId, authenticatedClient);

      // Create state overrides with the user data from the authenticator
      // Observers don't have user data, so no state overrides
      let stateOverrides: Array<[number, Uint8Array]> = [];
      if (userData) {
        const officialStates = DeltaNetComponentMapping.toStates(
          userData.username,
          userData.characterDescription,
          userData.colors,
        );
        stateOverrides = Array.from(officialStates.entries());

        console.log(`Created state overrides for client ${clientId}:`, {
          username: userData.username,
          characterDescription: userData.characterDescription,
          overridesCount: stateOverrides.length,
        });
      } else {
        console.log(`Observer client ${clientId} - no state overrides needed`);
      }

      return {
        success: true,
        stateOverrides: stateOverrides,
      };
    } catch (error) {
      console.error("Authentication error:", error);
      return { success: false };
    }
  }

  public connectClient(socket: WebSocket): void {
    // Add websocket to deltanet server
    this.deltaNetServer.addWebSocket(socket as unknown as globalThis.WebSocket);

    socket.on("close", () => {
      this.deltaNetServer.removeWebSocket(socket as unknown as globalThis.WebSocket);
    });
  }

  public broadcastMessage(broadcastType: number, broadcastPayload: string): void {
    this.deltaNetServer.broadcastCustomMessage(broadcastType, broadcastPayload);
  }

  public updateUserCharacter(clientId: number, userData: UserData): void {
    this.internalUpdateUser(clientId, userData);
  }

  private internalUpdateUser(clientId: number, userData: UserData): void {
    const client = this.authenticatedClientsById.get(clientId);
    if (!client || !client.deltaNetConnection) return;

    client.authenticatedUser = userData;

    // Update deltanet states
    const states = DeltaNetComponentMapping.toStates(
      userData.username,
      userData.characterDescription,
      userData.colors,
    );

    const asArray = Array.from(states.entries());
    this.deltaNetServer.overrideUserStates(client.deltaNetConnection, clientId, asArray);
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
  }
}
