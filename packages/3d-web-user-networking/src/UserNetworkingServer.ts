import WebSocket from "ws";

import {
  CHARACTER_UPDATE,
  CharacterUpdateMessage,
  CONNECTED_MESSAGE_TYPE,
  DISCONNECTED_MESSAGE_TYPE,
  FromClientMessage,
  FromServerMessage,
  IDENTITY_MESSAGE_TYPE,
  PONG_MESSAGE_TYPE,
  USER_CREDENTIALS,
  USER_CREDENTIALS_PROMPT,
  USER_UPDATE,
  UserCredentialsMessage,
  UserCredentialsPromptMessage,
  UserUpdateMessage,
} from "./messages";
import { heartBeatRate, packetsUpdateRate, pingPongRate } from "./user-networking-settings";
import { UserNetworkingClientUpdate, UserNetworkingCodec } from "./UserNetworkingCodec";

export type Client = {
  socket: WebSocket;
  update: UserNetworkingClientUpdate;
};

const WebSocketOpenStatus = 1;

export class UserNetworkingServer {
  private clients: Map<number, Client> = new Map();
  private clientLastPong: Map<number, number> = new Map();

  // A list of playable characters
  private characters: Map<number, object> = new Map();

  private userCredentialHandler: (id: number, message: UserCredentialsMessage) => UserUpdateMessage;

  constructor() {
    setInterval(this.sendUpdates.bind(this), packetsUpdateRate);
    setInterval(this.pingClients.bind(this), pingPongRate);
    setInterval(this.heartBeat.bind(this), heartBeatRate);
  }

  updateCharacter(characterId:number, characterDescription:object): void {
    console.log(`Add character ${characterId}`)
    this.characters.set(characterId, characterDescription)
  }

  setUserCredentialHandler(callback: (id: number, message: UserCredentialsMessage) => UserUpdateMessage): void {
    this.userCredentialHandler = callback;
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

  handleUserCredentials(id: number, message: UserCredentialsMessage) {
    console.log(`Handle user credentials for Client ID ${id}!`)
    let userUpdateMessage = {
      type: USER_UPDATE,
      characterId: 0 // use the default character
    } as UserUpdateMessage;

    if(this.userCredentialHandler) {
      userUpdateMessage = this.userCredentialHandler(id, message);
    } 
    let client: Client = this.clients.get(id)!
    client.socket.send(JSON.stringify(userUpdateMessage));   
  }

  connectClient(socket: WebSocket) {
    const id = this.getId();
    console.log(`Client ID: ${id} joined`);

    const connectMessage = JSON.stringify({
      id,
      type: CONNECTED_MESSAGE_TYPE,
    } as FromServerMessage);
    for (const { socket: otherSocket } of this.clients.values()) {
      if (otherSocket.readyState === WebSocketOpenStatus) {
        otherSocket.send(connectMessage);
      }
    }

    // Assign the connection-ID
    const identityMessage = JSON.stringify({
      type: IDENTITY_MESSAGE_TYPE,
      id,
    } as FromServerMessage);
    socket.send(identityMessage);

    // Give the user a chance to identify
    const credentialsPromptMessage = JSON.stringify({
      type: USER_CREDENTIALS_PROMPT,
      challenge: "Please sign in to 3d-web-experience" // Here you could also use a dynamic challenge
    } as UserCredentialsPromptMessage)
    socket.send(credentialsPromptMessage);

    // Send upate on all existing clients to the new connection
    for (const { update } of this.clients.values()) {
      socket.send(UserNetworkingCodec.encodeUpdate(update));
    }

    // Send all available characters to the new connection
    // Note this does *not* handle the removal of no-longer-used characters client-side, it just adds or updates
    for (const [characterId, characterDescription] of this.characters.entries()) {
      const characterUpdateMessage = JSON.stringify({
        type: CHARACTER_UPDATE,
        characterId: characterId, 
        characterDescription: characterDescription
      } as CharacterUpdateMessage)
      socket.send(characterUpdateMessage);
    }
    
    // Spawn a new client
    this.clients.set(id, {
      socket: socket as WebSocket,
      update: {
        id,
        position: { x: 0, y: 0, z: 0 },
        rotation: { quaternionY: 0, quaternionW: 1 },
        state: 0,
        characterId: 0 // Invalid character / Not set! 
      },
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
          const data = JSON.parse(message as string) as FromClientMessage;
          switch(data.type) {
            case PONG_MESSAGE_TYPE: {
              this.clientLastPong.set(id, Date.now());
              break;
            }
            case USER_CREDENTIALS: {
              this.handleUserCredentials(id, data as UserCredentialsMessage);
              break;
            }
            default: {
              console.error(`unknown message ${JSON.stringify(data)} received`);
              break;
            }
          }
        } catch (e) {
          console.error("Error parsing JSON message", message, e);
        }
      }
    });

    socket.on("close", () => {
      console.log("Client disconnected", id);
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

  sendUpdates(): void {
    for (const [clientId, client] of this.clients) {
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
