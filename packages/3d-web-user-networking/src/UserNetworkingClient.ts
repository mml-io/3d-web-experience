import {
  CHARACTER_UPDATE,
  CONNECTED_MESSAGE_TYPE,
  DISCONNECTED_MESSAGE_TYPE,
  FromClientMessage,
  FromServerMessage,
  IDENTITY_MESSAGE_TYPE,
  PING_MESSAGE_TYPE,
  USER_CREDENTIALS,
  USER_CREDENTIALS_PROMPT,
  USER_UPDATE,
  UserCredentialsMessage,
  UserCredentialsPromptMessage,
} from "./messages";
import { ReconnectingWebSocket, WebsocketFactory, WebsocketStatus } from "./ReconnectingWebSocket";
import { UserNetworkingClientUpdate, UserNetworkingCodec } from "./UserNetworkingCodec";

export class UserNetworkingClient extends ReconnectingWebSocket {
  constructor(
    url: string,
    websocketFactory: WebsocketFactory,
    statusUpdateCallback: (status: WebsocketStatus) => void,
    private setIdentityCallback: (id: number) => void,
    private setUserCallback: (userdata: object) => void,
    private characterUpdate: (characterId: number, characterDescription: object) => void,
    private clientUpdate: (id: number, update: null | UserNetworkingClientUpdate) => void,
  ) {
    super(url, websocketFactory, statusUpdateCallback);
  }

  public sendUpdate(update: UserNetworkingClientUpdate): void {
    const encodedUpdate = UserNetworkingCodec.encodeUpdate(update);
    this.send(encodedUpdate);
  }

  protected handleCredentialsPrompt(message: UserCredentialsPromptMessage) {
    console.log("No User-Credentials prompt, responding with empty credentials")
    // Add application's Login-Logic here.
    this.send({
      type: USER_CREDENTIALS,
      credentials: {
        signedChallenge: null, // Web3 login, e.g. by EIP-712 signing the challenge from `message`
        username: null, // user-identifier
        password: null // recommend to only send a hashed version
      }
    } as UserCredentialsMessage)
  }

  protected handleIncomingWebsocketMessage(message: MessageEvent) {
    if (typeof message.data === "string") {
      const parsed = JSON.parse(message.data) as FromServerMessage;
      switch (parsed.type) {
        case IDENTITY_MESSAGE_TYPE:
          console.log(`Assigned ID: ${parsed.id}`);
          this.setIdentityCallback(parsed.id);
          break;
        case CONNECTED_MESSAGE_TYPE:
          console.log(`Client ID: ${parsed.id} joined`);
          break;
        case USER_UPDATE:
          console.log(`Received user update`)
          this.setUserCallback(parsed);
          break;
        case DISCONNECTED_MESSAGE_TYPE:
          console.log(`Client ID: ${parsed.id} left`);
          this.clientUpdate(parsed.id, null);
          break;
        case PING_MESSAGE_TYPE: {
          this.send({ type: "pong" } as FromClientMessage);
          break;
        }
        case CHARACTER_UPDATE: {
          console.log(`Received character update for characterId ${parsed.characterId}`)
          this.characterUpdate(parsed.characterId, parsed.characterDescription);
          break;
        }
        case USER_CREDENTIALS_PROMPT: {
          this.handleCredentialsPrompt(parsed as UserCredentialsPromptMessage);
          break;
        }
        default:
          console.warn("unknown message type received", parsed);
      }
    } else if (message.data instanceof ArrayBuffer) {
      const userNetworkingClientUpdate = UserNetworkingCodec.decodeUpdate(message.data);
      this.clientUpdate(userNetworkingClientUpdate.id, userNetworkingClientUpdate);
    } else {
      console.error("Unhandled message type", message.data);
    }
  }
}
