import WebSocket from "ws";

import { heartBeatRate, packetsUpdateRate, pingPongRate } from "./user-networking-settings";
import { UserData } from "./UserData";
import { UserNetworkingClientUpdate, UserNetworkingCodec } from "./UserNetworkingCodec";
import {
  DISCONNECTED_MESSAGE_TYPE,
  FromClientMessage,
  FromServerMessage,
  IDENTITY_MESSAGE_TYPE,
  PONG_MESSAGE_TYPE,
  USER_AUTHENTICATE_MESSAGE_TYPE,
  USER_PROFILE_MESSAGE_TYPE,
  USER_UPDATE_MESSAGE_TYPE as USER_UPDATE_MESSAGE_TYPE,
  UserAuthenticateMessage,
  UserIdentity,
  UserUpdateMessage,
} from "./UserNetworkingMessages";

export type Client = {
  socket: WebSocket;
  id: number;
  lastPong: number;
  update: UserNetworkingClientUpdate;
  authenticatedUser: UserData | null;
};

const WebSocketOpenStatus = 1;

export type UserNetworkingServerOptions = {
  onClientConnect: (
    clientId: number,
    sessionToken: string,
    userIdentity?: UserIdentity,
  ) => UserData | null;
  onClientUserIdentityUpdate: (clientId: number, userIdentity: UserIdentity) => UserData | null;
  onClientDisconnect: (clientId: number) => void;
};

export class UserNetworkingServer {
  private allClients = new Set<Client>();
  private clientsById: Map<number, Client> = new Map();

  constructor(private options: UserNetworkingServerOptions) {
    setInterval(this.sendUpdates.bind(this), packetsUpdateRate);
    setInterval(this.pingClients.bind(this), pingPongRate);
    setInterval(this.heartBeat.bind(this), heartBeatRate);
  }

  private heartBeat() {
    const now = Date.now();
    this.allClients.forEach((client) => {
      if (now - client.lastPong > heartBeatRate) {
        client.socket.close();
        this.handleDisconnectedClient(client);
      }
    });
  }

  private pingClients() {
    this.clientsById.forEach((client) => {
      if (client.socket.readyState === WebSocketOpenStatus) {
        client.socket.send(JSON.stringify({ type: "ping" } as FromServerMessage));
      }
    });
  }

  private getId(): number {
    let id = 1;
    while (this.clientsById.has(id)) {
      id++;
    }
    return id;
  }

  public connectClient(socket: WebSocket) {
    const id = this.getId();
    console.log(`Client ID: ${id} joined, waiting for user-identification`);

    // Create a client but without user-information
    const client: Client = {
      id,
      lastPong: Date.now(),
      socket: socket as WebSocket,
      authenticatedUser: null,
      update: {
        id,
        position: { x: 0, y: 0, z: 0 },
        rotation: { quaternionY: 0, quaternionW: 1 },
        state: 0,
      },
    };
    this.allClients.add(client);
    this.clientsById.set(id, client);

    socket.on("message", (message: WebSocket.Data, _isBinary: boolean) => {
      if (message instanceof Buffer) {
        const arrayBuffer = new Uint8Array(message).buffer;
        const update = UserNetworkingCodec.decodeUpdate(arrayBuffer);
        update.id = id;
        client.update = update;
      } else {
        let parsed;
        try {
          parsed = JSON.parse(message as string) as FromClientMessage;
        } catch (e) {
          console.error("Error parsing JSON message", message, e);
          return;
        }
        if (!client.authenticatedUser) {
          if (parsed.type === USER_AUTHENTICATE_MESSAGE_TYPE) {
            if (!this.handleUserAuth(id, parsed)) {
              // If the user is not authorized, disconnect the client
              socket.close();
            }
          } else {
            console.error(`Unhandled message pre-auth: ${JSON.stringify(parsed)}`);
            socket.close();
          }
        } else {
          switch (parsed.type) {
            case PONG_MESSAGE_TYPE:
              client.lastPong = Date.now();
              break;

            case USER_UPDATE_MESSAGE_TYPE:
              this.handleUserUpdate(id, parsed as UserUpdateMessage);
              break;

            default:
              console.error(`Unhandled message: ${JSON.stringify(parsed)}`);
          }
        }
      }
    });

    socket.on("close", () => {
      console.log("Client disconnected", id);
      this.handleDisconnectedClient(client);
    });
  }

  private handleDisconnectedClient(client: Client) {
    if (!this.allClients.has(client)) {
      return;
    }
    if (client.authenticatedUser !== null) {
      // Only report disconnections of clients that were authenticated
      this.options.onClientDisconnect(client.id);
    }
    this.clientsById.delete(client.id);
    this.allClients.delete(client);
    const disconnectMessage = JSON.stringify({
      id: client.id,
      type: DISCONNECTED_MESSAGE_TYPE,
    } as FromServerMessage);
    for (const otherClient of this.allClients) {
      if (
        otherClient.authenticatedUser !== null &&
        otherClient.socket.readyState === WebSocketOpenStatus
      ) {
        otherClient.socket.send(disconnectMessage);
      }
    }
  }

  private handleUserAuth(clientId: number, credentials: UserAuthenticateMessage): boolean {
    const userData = this.options.onClientConnect(
      clientId,
      credentials.sessionToken,
      credentials.userIdentity,
    );
    if (!userData) {
      console.error(`Client-id ${clientId} user_auth unauthorized and ignored`);
      return false;
    }

    const client = this.clientsById.get(clientId);
    if (!client) {
      console.error(`Client-id ${clientId}, client not found`);
      return false;
    }

    console.log("Client authenticated", clientId, userData);
    client.authenticatedUser = userData;

    const identityMessage = JSON.stringify({
      id: clientId,
      type: IDENTITY_MESSAGE_TYPE,
    } as FromServerMessage);

    const userProfileMessage = JSON.stringify({
      id: clientId,
      type: USER_PROFILE_MESSAGE_TYPE,
      username: userData.username,
      characterDescription: userData.characterDescription,
    } as FromServerMessage);

    client.socket.send(userProfileMessage);
    client.socket.send(identityMessage);

    const userUpdateMessage = UserNetworkingCodec.encodeUpdate(client.update);

    // Send information about all other clients to the freshly connected client and vice versa
    for (const otherClient of this.clientsById.values()) {
      if (
        otherClient.socket.readyState !== WebSocketOpenStatus ||
        otherClient.authenticatedUser == null ||
        otherClient === client
      ) {
        // Do not send updates for any clients which have not yet authenticated or not yet connected
        continue;
      }
      // Send the character information
      client.socket.send(
        JSON.stringify({
          id: otherClient.update.id,
          type: USER_PROFILE_MESSAGE_TYPE,
          username: otherClient.authenticatedUser?.username,
          characterDescription: otherClient.authenticatedUser?.characterDescription,
        } as FromServerMessage),
      );
      client.socket.send(UserNetworkingCodec.encodeUpdate(otherClient.update));

      otherClient.socket.send(userProfileMessage);
      otherClient.socket.send(userUpdateMessage);
    }

    console.log("Client authenticated", clientId);

    return true;
  }

  public updateUserCharacter(clientId: number, userData: UserData) {
    this.internalUpdateUser(clientId, userData);
  }

  private internalUpdateUser(clientId: number, userData: UserData) {
    // This function assumes authorization has already been done
    const client = this.clientsById.get(clientId)!;

    client.authenticatedUser = userData;
    this.clientsById.set(clientId, client);

    const newUserData = JSON.stringify({
      id: clientId,
      type: USER_PROFILE_MESSAGE_TYPE,
      username: userData.username,
      characterDescription: userData.characterDescription,
    } as FromServerMessage);

    // Broadcast the new userdata to all sockets, INCLUDING the user of the calling socket
    // Clients will always render based on the public userProfile.
    // This makes it intuitive, as it is "what you see is what other's see" from a user's perspective.
    for (const [otherClientId, otherClient] of this.clientsById) {
      if (!otherClient.authenticatedUser) {
        // Do not send updates for any clients which have no user yet
        continue;
      }
      if (otherClient.socket.readyState === WebSocketOpenStatus) {
        otherClient.socket.send(newUserData);
      }
    }
  }

  private handleUserUpdate(clientId: number, message: UserUpdateMessage): void {
    const client = this.clientsById.get(clientId);
    if (!client) {
      console.error(`Client-id ${clientId} user_update ignored, client not found`);
      return;
    }

    // Verify using the user authenticator what the allowed version of this update is
    const authorizedUserData = this.options.onClientUserIdentityUpdate(
      clientId,
      message.userIdentity,
    );
    if (!authorizedUserData) {
      // TODO - inform the client about the unauthorized update
      console.warn(`Client-id ${clientId} user_update unauthorized and ignored`);
      return;
    }

    this.internalUpdateUser(clientId, authorizedUserData);
  }

  private sendUpdates(): void {
    for (const [clientId, client] of this.clientsById) {
      if (!client.authenticatedUser) {
        // Do not send updates about unauthenticated clients
        continue;
      }
      const update = client.update;
      const encodedUpdate = UserNetworkingCodec.encodeUpdate(update);

      for (const [otherClientId, otherClient] of this.clientsById) {
        if (
          otherClient.authenticatedUser !== null &&
          otherClientId !== clientId &&
          otherClient.socket.readyState === WebSocketOpenStatus
        ) {
          otherClient.socket.send(encodedUpdate);
        }
      }
    }
  }
}
