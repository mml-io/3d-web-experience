import {
  CONNECTED_MESSAGE_TYPE,
  DISCONNECTED_MESSAGE_TYPE,
  FromClientMessage,
  FromServerMessage,
  IDENTITY_MESSAGE_TYPE,
  PING_MESSAGE_TYPE,
} from "./messages";
import { ReconnectingWebSocket, WebsocketFactory, WebsocketStatus } from "./ReconnectingWebSocket";
import { UserNetworkingClientUpdate, UserNetworkingCodec } from "./UserNetworkingCodec";

export class UserNetworkingClient extends ReconnectingWebSocket {
  constructor(
    url: string,
    websocketFactory: WebsocketFactory,
    statusUpdateCallback: (status: WebsocketStatus) => void,
    private messageHandler: (message: FromServerMessage, networkClient: UserNetworkingClient) => void,
    private clientUpdate: (id: number, update: null | UserNetworkingClientUpdate) => void,
  ) {
    super(url, websocketFactory, statusUpdateCallback);
  }

  public sendUpdate(update: UserNetworkingClientUpdate): void {
    const encodedUpdate = UserNetworkingCodec.encodeUpdate(update);
    this.send(encodedUpdate);
  }

  public sendMessage(message: FromClientMessage): void {
    this.send(message);
  }

  protected handleStatusUpdateInternally(status: WebsocketStatus) {
    console.log("Handle internal connected")

  }

  protected handleIncomingWebsocketMessage(message: MessageEvent) {
    if (typeof message.data === "string") {
      const parsed = JSON.parse(message.data) as FromServerMessage;
      switch (parsed.type) {
        case CONNECTED_MESSAGE_TYPE:
          console.log(`Client ID: ${parsed.id} joined`);
          break;
        case DISCONNECTED_MESSAGE_TYPE:
          console.log(`Client ID: ${parsed.id} left`);
          this.clientUpdate(parsed.id, null);
          break;
        case PING_MESSAGE_TYPE: {
          this.send({ type: "pong" } as FromClientMessage);
          break;
        }
        default:
          this.messageHandler(parsed, this);
      }
    } else if (message.data instanceof ArrayBuffer) {
      const userNetworkingClientUpdate = UserNetworkingCodec.decodeUpdate(message.data);
      this.clientUpdate(userNetworkingClientUpdate.id, userNetworkingClientUpdate);
    } else {
      console.error("Unhandled message type", message.data);
    }
  }
}
