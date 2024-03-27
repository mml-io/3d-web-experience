import WebSocket from "ws";

import {
  CONNECTED_MESSAGE_TYPE,
  UserUpdateMessage,
  DISCONNECTED_MESSAGE_TYPE,
  FromClientMessage,
  FromServerMessage,
  IDENTITY_MESSAGE_TYPE,
  USER_UPDATE_MESSAGE_TYPE as USER_UPDATE_MESSAGE_TYPE,
  PONG_MESSAGE_TYPE,
} from "./messages";
import { heartBeatRate, packetsUpdateRate, pingPongRate } from "./user-networking-settings";
import { UserNetworkingClientUpdate, UserNetworkingCodec } from "./UserNetworkingCodec";
import { UserData } from "./UserData";

export type Client = {
  socket: WebSocket;
  update: UserNetworkingClientUpdate;
  user: UserData | null;
};

const WebSocketOpenStatus = 1;

export class UserNetworkingServer {
  private clients: Map<number, Client> = new Map();
  private clientLastPong: Map<number, number> = new Map();

  constructor(
    private userUpdateCallback: (clientId: number, msg: UserUpdateMessage) => UserData,
    private onClientDisconnect: (clientId: number) => void,
    ) {    
    setInterval(this.sendUpdates.bind(this), packetsUpdateRate);
    setInterval(this.pingClients.bind(this), pingPongRate);
    setInterval(this.heartBeat.bind(this), heartBeatRate);
  }

  heartBeat() {
    const now = Date.now();
    this.clientLastPong.forEach((clientLastPong, id) => {
      if (now - clientLastPong > heartBeatRate) {
        this.clients.delete(id);
        this.clientLastPong.delete(id);
        const disconnectMessage = JSON.stringify({
          id,
          type: DISCONNECTED_MESSAGE_TYPE,
        } as FromServerMessage);
        for (const { socket: otherSocket } of this.clients.values()) {
          if (otherSocket.readyState === WebSocketOpenStatus) {
            otherSocket.send(disconnectMessage);
          }
        }
      }
    });
  }

  pingClients() {
    this.clients.forEach((client) => {
      if (client.socket.readyState === WebSocketOpenStatus) {
        client.socket.send(JSON.stringify({ type: "ping" } as FromServerMessage));
      }
    });
  }

  getId(): number {
    let id = 1;
    while (this.clients.has(id)) id++;
    return id;
  }


  connectClient(socket: WebSocket) {
    const id = this.getId();
    console.log(`Client ID: ${id} joined, waiting for user-identification`);

    const connectMessage = JSON.stringify({
      id,
      type: CONNECTED_MESSAGE_TYPE,
    } as FromServerMessage);
    for (const { socket: otherSocket } of this.clients.values()) {
      if (otherSocket.readyState === WebSocketOpenStatus) {
        otherSocket.send(connectMessage);
      }
    }

    // Send information about all other clients to the freshly connected client
    for (const { user, update } of this.clients.values()) {
      if(user === null) {
        // Do not send updates for any clients which have no user yet
        // Also don't send updates about my own user
        continue; 
      }
      // Send the character information
      socket.send(JSON.stringify(user.toUserProfileMessage()));
      socket.send(UserNetworkingCodec.encodeUpdate(update));
    }
   
    // Create a client but without user-information
    this.clients.set(id, {
      socket: socket as WebSocket,
      update: {
        id,
        position: { x: 0, y: 0, z: 0 },
        rotation: { quaternionY: 0, quaternionW: 1 },
        state: 0,
      },
      user: null,
    });

    socket.on("message", (message: WebSocket.Data, _isBinary: boolean) => {
      if (message instanceof Buffer) {
        const arrayBuffer = new Uint8Array(message).buffer;
        const update = UserNetworkingCodec.decodeUpdate(arrayBuffer);
        update.id = id;
        if (this.clients.get(id) !== undefined) {
          this.clients.get(id)!.update = update;
        }
      } else {
        try {
          const parsed = JSON.parse(message as string) as FromClientMessage;
          switch(parsed.type) {
            case PONG_MESSAGE_TYPE:
              this.clientLastPong.set(id, Date.now());
              break;

            case USER_UPDATE_MESSAGE_TYPE:
              this.handleUserUpdate(id, parsed as UserUpdateMessage);
              break;

            default:
              console.error(`Unhandled message: ${JSON.stringify(parsed)}`);
          }         
        } catch (e) {
          console.error("Error parsing JSON message", message, e);
        }
      }
    });

    socket.on("close", () => {
      console.log("Client disconnected", id);
      this.onClientDisconnect(id);
      this.clients.delete(id);
      const disconnectMessage = JSON.stringify({
        id,
        type: DISCONNECTED_MESSAGE_TYPE,
      } as FromServerMessage);
      for (const [clientId, { socket: otherSocket }] of this.clients) {
        if (otherSocket.readyState === WebSocketOpenStatus) {
          otherSocket.send(disconnectMessage);
        }
      }
    });
  }

  public updateUserCharacter(clientId: number, userDescription: object) {

    const oldUserDescription = this.clients.get(clientId)?.user;

    if(oldUserDescription) {
      // create a message and pass it through updateUser
      const temporaryNewUserDescription = {
        type: USER_UPDATE_MESSAGE_TYPE, 
        credentials: oldUserDescription?.credentials,
        characterDescription: userDescription,
        userName: oldUserDescription?.userName
      } as UserUpdateMessage;

      this.updateUser(clientId, temporaryNewUserDescription);
    }    
  }

  // triggered either server-side or client side...
  updateUser(clientId:number, message: UserUpdateMessage) {
    var client = this.clients.get(clientId)!;

    // TODO Add a callback for userAuthorization (authorization logic shall be implement-able in example/server/src/*)
    // TODO add a callback for characterDescription, userName verification etc (does a authorized user own each model in an mml-character string etc)

    // If both is fine, update the client's user
    // If not, TODO error handling and communicating error back to client
    const authorizedUserData = this.userUpdateCallback(clientId, message);
    
    if(!authorizedUserData) {
      console.error(`Client-id=${clientId} user_update unauthorized`);
      return;
    }

    // Sanity check - be really suspicious here to account for bad programming behavior
    if(authorizedUserData.id != clientId) {
      console.error(`Client-id=${clientId} user_update fails (client-id mismatch)`);
      return;
    }

    client.user = authorizedUserData;
    this.clients.set(clientId, client);
    
    const newUserData = JSON.stringify(client.user.toUserProfileMessage());

    // Broadcast the new userdata to all sockets, INCLUDING the user of the calling socket
    // Clients will always render based on the public userProfile. 
    // This makes it intuitive, as it is "what you see is what other's see" from a user's perspective.
    for (const [otherClientId, otherClient] of this.clients) {
      if (otherClient.socket.readyState === WebSocketOpenStatus) {
        otherClient.socket.send(newUserData);
      }
    }
  }

  handleUserUpdate(clientId: number, message: UserUpdateMessage): void {
    console.log(`Handle credentials for clientId=${clientId}`);
    console.log(message.credentials);

    var client = this.clients.get(clientId)!;
    const socket = client!.socket;

    this.updateUser(clientId, message);

    // Note broadcasting this before sending the identity message ensures the calling client's profile
    // is sent back to the client BEFORE it starts rendering (which happens when the identity message is received)

    // Finally, tell the client who he is
    // TODO: Implement logic s.t. at repeated user_updates (e.g. changing authorization, user-name, character) AFTER initial loading
    // will not add additional identity messages
    const identityMessage = JSON.stringify({
      id: clientId,
      type: IDENTITY_MESSAGE_TYPE,
    } as FromServerMessage);
    socket.send(identityMessage);
    
    // Broadcast standard updates
    this.sendUpdates();    
  }

  sendUpdates(): void {
    for (const [clientId, client] of this.clients) {
      if(client.user === null) {
        // Do not send updates about connected clients, which have no user assigned yet.
        // Note to self: Clients w/o users may later even be used intentionally as spectator mode
        continue;
      }
      const update = client.update;
      const encodedUpdate = UserNetworkingCodec.encodeUpdate(update);

      for (const [otherClientId, otherClient] of this.clients) {
        if (otherClientId !== clientId && otherClient.socket.readyState === WebSocketOpenStatus) {
          otherClient.socket.send(encodedUpdate);
        }
      }
    }
  }
}
