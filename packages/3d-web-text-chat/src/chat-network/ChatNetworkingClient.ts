import {
  CHAT_NETWORKING_CHAT_MESSAGE_TYPE,
  CHAT_NETWORKING_CONNECTED_MESSAGE_TYPE,
  CHAT_NETWORKING_DISCONNECTED_MESSAGE_TYPE,
  ChatNetworkingClientChatMessage,
  FromClientMessage,
  FromServerMessage,
  CHAT_NETWORKING_IDENTITY_MESSAGE_TYPE,
  CHAT_NETWORKING_PING_MESSAGE_TYPE,
  CHAT_NETWORKING_SERVER_ERROR_MESSAGE_TYPE,
  ChatNetworkingServerErrorType,
  CHAT_NETWORKING_USER_AUTHENTICATE_MESSAGE_TYPE,
} from "./ChatNetworkingMessages";
import { ReconnectingWebSocket, WebsocketFactory, WebsocketStatus } from "./ReconnectingWebsocket";

export type ChatNetworkingClientConfig = {
  url: string;
  sessionToken: string;
  websocketFactory: WebsocketFactory;
  statusUpdateCallback: (status: WebsocketStatus) => void;
  clientChatUpdate: (id: number, update: null | ChatNetworkingClientChatMessage) => void;
  onServerError: (error: { message: string; errorType: ChatNetworkingServerErrorType }) => void;
};

export class ChatNetworkingClient extends ReconnectingWebSocket {
  constructor(private config: ChatNetworkingClientConfig) {
    super(config.url, config.websocketFactory, (status: WebsocketStatus) => {
      if (status === WebsocketStatus.Connected) {
        this.sendMessage({
          type: CHAT_NETWORKING_USER_AUTHENTICATE_MESSAGE_TYPE,
          sessionToken: config.sessionToken,
        });
      }
      config.statusUpdateCallback(status);
    });
  }

  public sendChatMessage(message: string) {
    this.sendMessage({ type: CHAT_NETWORKING_CHAT_MESSAGE_TYPE, text: message });
  }

  private sendMessage(message: FromClientMessage): void {
    this.send(message);
  }

  protected handleIncomingWebsocketMessage(message: MessageEvent) {
    if (typeof message.data === "string") {
      const parsed = JSON.parse(message.data) as FromServerMessage;
      switch (parsed.type) {
        case CHAT_NETWORKING_SERVER_ERROR_MESSAGE_TYPE:
          console.error(`Server error: ${parsed.message}. errorType: ${parsed.errorType}`);
          this.config.onServerError(parsed);
          break;
        case CHAT_NETWORKING_IDENTITY_MESSAGE_TYPE:
          console.log(`Client ID: ${parsed.id} assigned to self`);
          break;
        case CHAT_NETWORKING_CONNECTED_MESSAGE_TYPE:
          console.log(`Client ID: ${parsed.id} joined chat`);
          break;
        case CHAT_NETWORKING_DISCONNECTED_MESSAGE_TYPE:
          console.log(`Client ID: ${parsed.id} left chat`);
          break;
        case CHAT_NETWORKING_PING_MESSAGE_TYPE: {
          this.sendMessage({ type: "pong" });
          break;
        }
        case CHAT_NETWORKING_CHAT_MESSAGE_TYPE: {
          this.config.clientChatUpdate(parsed.id, parsed);
          break;
        }
        default:
          console.warn("unknown message type received", parsed);
      }
    } else {
      console.error("Unhandled message type", message.data);
    }
  }
}
