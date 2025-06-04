import {
  DeltaNetServer,
  DeltaNetServerError,
  DeltaNetV01Connection,
} from "@deltanet/delta-net-server";
import WebSocket from "ws";

import { DeltaNetComponentMapping } from "./DeltaNetComponentMapping";
import { UserData } from "./UserData";
import { UserNetworkingClientUpdate, UserNetworkingCodec } from "./UserNetworkingCodec";
import {
  FromUserNetworkingClientMessage,
  FromUserNetworkingServerMessage,
  USER_NETWORKING_AUTHENTICATION_FAILED_ERROR_TYPE,
  USER_NETWORKING_CONNECTION_LIMIT_REACHED_ERROR_TYPE,
  USER_NETWORKING_DISCONNECTED_MESSAGE_TYPE,
  USER_NETWORKING_IDENTITY_MESSAGE_TYPE,
  USER_NETWORKING_PONG_MESSAGE_TYPE,
  USER_NETWORKING_SERVER_ERROR_MESSAGE_TYPE,
  USER_NETWORKING_USER_AUTHENTICATE_MESSAGE_TYPE,
  USER_NETWORKING_USER_PROFILE_MESSAGE_TYPE,
  USER_NETWORKING_USER_UPDATE_MESSAGE_TYPE,
  UserIdentity,
  UserNetworkingAuthenticateMessage,
  UserNetworkingServerError,
  UserNetworkingUserUpdateMessage,
} from "./UserNetworkingMessages";

export type UserNetworkingServerClient = {
  socket: WebSocket;
  id: number;
  lastPong: number;
  update: UserNetworkingClientUpdate;
  authenticatedUser: UserData | null;
  deltaNetConnection?: DeltaNetV01Connection;
};

const WebSocketOpenStatus = 1;

export type UserNetworkingServerOptions = {
  connectionLimit?: number;
  onClientConnect: (
    clientId: number,
    sessionToken: string,
    userIdentity?: UserIdentity,
  ) => Promise<UserData | null> | UserData | null;
  onClientUserIdentityUpdate: (
    clientId: number,
    userIdentity: UserIdentity,
  ) => Promise<UserData | null> | UserData | null;
  onClientDisconnect: (clientId: number) => void;
};

export class UserNetworkingServer {
  private deltaNetServer: DeltaNetServer;
  private authenticatedClientsById: Map<number, UserNetworkingServerClient> = new Map();
  private userIdToWebSocket: Map<number, WebSocket> = new Map();
  private webSocketToUserId: Map<WebSocket, number> = new Map();
  private deltaNetConnectionToUserId: Map<DeltaNetV01Connection, number> = new Map();
  private nextClientId = 1;
  private tickInterval: NodeJS.Timeout;

  constructor(private options: UserNetworkingServerOptions) {
    this.deltaNetServer = new DeltaNetServer({
      serverConnectionIdStateId: 0,
      onJoiner: (joiner) => {
        return this.handleJoiner(joiner);
      },
      onLeave: (leave) => {
        this.handleLeave(leave);
      },
      onComponentsUpdate: (update) => {
        // Handle component updates from clients
        this.handleComponentUpdate(update);
        return; // No error
      },
    });

    // Start the deltanet server tick
    this.tickInterval = setInterval(() => {
      this.deltaNetServer.tick();
    }, 50);
  }

  private handleJoiner(joiner: any): DeltaNetServerError | void | Promise<DeltaNetServerError | void | { success: true; stateOverrides?: Array<[number, Uint8Array]> }> {
    const deltaNetConnection = joiner.deltaNetV01Connection as DeltaNetV01Connection;
    const webSocket = deltaNetConnection.webSocket as unknown as WebSocket;
    const states = joiner.states as Array<[number, Uint8Array]>;
    const sessionToken = joiner.token as string; // Get session token from deltanet token field
    const clientId = this.nextClientId++;

    console.log(`Client ID: ${clientId} joined (observer: ${deltaNetConnection.isObserver}), authenticating...`);

    // Store the client connection info
    this.webSocketToUserId.set(webSocket, clientId);
    this.userIdToWebSocket.set(clientId, webSocket);
    this.deltaNetConnectionToUserId.set(deltaNetConnection, clientId);

    if (!sessionToken) {
      console.log(`No session token provided for client ID: ${clientId}`);
      return new DeltaNetServerError("No session token provided", false);
    }

    // Handle authentication and return the result with state overrides
    return this.handleDeltaNetAuthentication(clientId, webSocket, deltaNetConnection, sessionToken)
      .then((authResult) => {
        if (!authResult.success) {
          // Authentication failed - return error to reject connection
          console.log(`Authentication failed for client ID: ${clientId}`);
          // Clean up connection mappings since auth failed
          this.webSocketToUserId.delete(webSocket);
          this.userIdToWebSocket.delete(clientId);
          this.deltaNetConnectionToUserId.delete(deltaNetConnection);
          return new DeltaNetServerError("Authentication failed", false);
        } else {
          console.log(`Client ID: ${clientId} authenticated successfully`, authResult.stateOverrides);
          // Return success with state overrides
          return {
            success: true as const,
            stateOverrides: authResult.stateOverrides
          };
        }
      })
      .catch((error) => {
        console.error(`Authentication error for client ID: ${clientId}:`, error);
        // Clean up connection mappings since auth failed
        this.webSocketToUserId.delete(webSocket);
        this.userIdToWebSocket.delete(clientId);
        this.deltaNetConnectionToUserId.delete(deltaNetConnection);
        return new DeltaNetServerError("Authentication error", false);
      });
  }

  private handleLeave(leave: any): void {
    const deltaNetConnection = leave.deltaNetV01Connection as DeltaNetV01Connection;
    const clientId = this.deltaNetConnectionToUserId.get(deltaNetConnection);

    if (clientId !== undefined) {
      const client = this.authenticatedClientsById.get(clientId);
      if (client) {
        console.log(`Client ID: ${clientId} left`);
        this.options.onClientDisconnect(clientId);
        this.authenticatedClientsById.delete(clientId);

        // Notify other clients about disconnection
        this.broadcastDisconnection(clientId);
      }

      this.webSocketToUserId.delete(deltaNetConnection.webSocket as unknown as WebSocket);
      this.userIdToWebSocket.delete(clientId);
      this.deltaNetConnectionToUserId.delete(deltaNetConnection);
    }
  }

  private handleComponentUpdate(update: any): void {
    const deltaNetConnection = update.deltaNetV01Connection as DeltaNetV01Connection;
    const components = update.components as Array<[number, bigint]>;
    const clientId = this.deltaNetConnectionToUserId.get(deltaNetConnection);

    // Observers don't send component updates, so this should not happen
    if (deltaNetConnection.isObserver) {
      console.warn(`Observer client ${clientId} attempted to send component update - ignoring`);
      return;
    }

    if (clientId !== undefined) {
      const client = this.authenticatedClientsById.get(clientId);
      if (client) {
        // Convert deltanet components back to UserNetworkingClientUpdate
        const componentsMap = new Map(components);
        const clientUpdate = DeltaNetComponentMapping.fromComponents(componentsMap, clientId);
        client.update = clientUpdate;
      }
    }
  }

  private async handleWebSocketMessage(clientId: number, message: WebSocket.Data): Promise<void> {
    const webSocket = this.userIdToWebSocket.get(clientId);
    if (!webSocket) return;

    if (message instanceof Buffer) {
      // Binary update - decode and convert to deltanet components
      const update = UserNetworkingCodec.decodeUpdate(new Uint8Array(message).buffer);
      update.id = clientId;

      const client = this.authenticatedClientsById.get(clientId);
      if (client && client.deltaNetConnection) {
        client.update = update;

        // Convert to deltanet components and update
        const components = DeltaNetComponentMapping.toComponents(update);
        const componentsArray = Array.from(components.entries());
        this.deltaNetServer.setUserComponents(client.deltaNetConnection, clientId, componentsArray);
      }
    } else {
      // JSON message
      let parsed: FromUserNetworkingClientMessage;
      try {
        parsed = JSON.parse(message as string);
      } catch (e) {
        console.error("Error parsing JSON message", message, e);
        return;
      }

      const client = this.authenticatedClientsById.get(clientId);

      if (client) {
        // Handle messages from authenticated clients
        switch (parsed.type) {
          case "pong":
            client.lastPong = Date.now();
            break;
          case USER_NETWORKING_USER_UPDATE_MESSAGE_TYPE:
            await this.handleUserUpdate(clientId, parsed);
            break;
        }
      }
    }
  }

  private async handleDeltaNetAuthentication(
    clientId: number,
    webSocket: WebSocket,
    deltaNetConnection: DeltaNetV01Connection,
    sessionToken: string,
  ): Promise<{ success: boolean; stateOverrides?: Array<[number, Uint8Array]> }> {
    try {
      console.log(`Authenticating client ${clientId} (observer: ${deltaNetConnection.isObserver}) with session token: ${sessionToken.substring(0, 10)}...`);
      
      // For observers, we might want to allow anonymous access or use a different authentication flow
      const userData = deltaNetConnection.isObserver 
        ? null // Observers don't need user data
        : await this.options.onClientConnect(clientId, sessionToken, undefined);

      console.log(`Authentication result for client ${clientId}:`, {
        success: deltaNetConnection.isObserver || !!userData,
        isObserver: deltaNetConnection.isObserver,
        username: userData?.username,
        characterDescription: userData?.characterDescription
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

      // Create state overrides with the official user data from the authenticator
      // Observers don't have user data, so no state overrides
      let stateOverrides: Array<[number, Uint8Array]> = [];
      if (userData) {
        const officialStates = DeltaNetComponentMapping.toStates(userData.username, userData.characterDescription);
        stateOverrides = Array.from(officialStates.entries());

        console.log(`Created state overrides for client ${clientId}:`, {
          username: userData.username,
          characterDescription: userData.characterDescription,
          overridesCount: stateOverrides.length
        });
      } else {
        console.log(`Observer client ${clientId} - no state overrides needed`);
      }

      return { 
        success: true, 
        stateOverrides: stateOverrides 
      };
    } catch (error) {
      console.error("Authentication error:", error);
      return { success: false };
    }
  }

  private async handleUserUpdate(
    clientId: number,
    message: UserNetworkingUserUpdateMessage,
  ): Promise<void> {
    const client = this.authenticatedClientsById.get(clientId);
    if (!client || !client.deltaNetConnection) return;

    try {
      const userData = await this.options.onClientUserIdentityUpdate(
        clientId,
        message.userIdentity,
      );
      if (userData && client.authenticatedUser) {
        client.authenticatedUser = userData;

        // Update deltanet states
        const states = DeltaNetComponentMapping.toStates(
          userData.username,
          userData.characterDescription,
        );
        const components = DeltaNetComponentMapping.toComponents(client.update);
        const componentsArray = Array.from(components.entries());
        this.deltaNetServer.setUserComponents(client.deltaNetConnection, clientId, componentsArray);

        // Broadcast profile update to all clients
        const profileMessage = JSON.stringify({
          id: clientId,
          type: USER_NETWORKING_USER_PROFILE_MESSAGE_TYPE,
          username: userData.username,
          characterDescription: userData.characterDescription,
        } as FromUserNetworkingServerMessage);

        for (const [, otherClient] of this.authenticatedClientsById) {
          if (otherClient.socket.readyState === WebSocketOpenStatus) {
            otherClient.socket.send(profileMessage);
          }
        }
      }
    } catch (error) {
      console.error("User update error:", error);
    }
  }

  private broadcastDisconnection(clientId: number): void {
    const message = JSON.stringify({
      type: USER_NETWORKING_DISCONNECTED_MESSAGE_TYPE,
      id: clientId,
    } as FromUserNetworkingServerMessage);

    for (const [, client] of this.authenticatedClientsById) {
      if (client.socket.readyState === WebSocketOpenStatus) {
        client.socket.send(message);
      }
    }
  }

  public connectClient(socket: WebSocket): void {
    // Add websocket to deltanet server
    this.deltaNetServer.addWebSocket(socket as unknown as globalThis.WebSocket);

    socket.on("close", () => {
      this.deltaNetServer.removeWebSocket(socket as unknown as globalThis.WebSocket);
    });
  }

  public broadcastMessage(broadcastType: string, broadcastPayload: any): void {
    const message: FromUserNetworkingServerMessage = {
      type: "broadcast",
      broadcastType,
      payload: broadcastPayload,
    };
    const messageString = JSON.stringify(message);
    for (const [, client] of this.authenticatedClientsById) {
      if (client.socket.readyState === WebSocketOpenStatus) {
        client.socket.send(messageString);
      }
    }
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
    );
    const components = DeltaNetComponentMapping.toComponents(client.update);
    const componentsArray = Array.from(components.entries());
    this.deltaNetServer.setUserComponents(client.deltaNetConnection, clientId, componentsArray);

    // Broadcast to all clients
    const profileMessage = JSON.stringify({
      id: clientId,
      type: USER_NETWORKING_USER_PROFILE_MESSAGE_TYPE,
      username: userData.username,
      characterDescription: userData.characterDescription,
    } as FromUserNetworkingServerMessage);

    for (const [, otherClient] of this.authenticatedClientsById) {
      if (otherClient.socket.readyState === WebSocketOpenStatus) {
        otherClient.socket.send(profileMessage);
      }
    }
  }

  public dispose(clientCloseError?: UserNetworkingServerError): void {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
    }

    // Close all client connections
    for (const [, client] of this.authenticatedClientsById) {
      if (clientCloseError) {
        const errorMessage = JSON.stringify({
          type: USER_NETWORKING_SERVER_ERROR_MESSAGE_TYPE,
          errorType: clientCloseError.errorType,
          message: clientCloseError.message,
        } as FromUserNetworkingServerMessage);
        client.socket.send(errorMessage);
      }
      client.socket.close();
    }

    this.authenticatedClientsById.clear();
    this.userIdToWebSocket.clear();
    this.webSocketToUserId.clear();
    this.deltaNetConnectionToUserId.clear();
  }
}
