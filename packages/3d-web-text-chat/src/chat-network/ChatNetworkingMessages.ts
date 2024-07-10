export const CHAT_NETWORKING_IDENTITY_MESSAGE_TYPE = "identity";
export const CHAT_NETWORKING_USER_AUTHENTICATE_MESSAGE_TYPE = "user_auth";
export const CHAT_NETWORKING_CONNECTED_MESSAGE_TYPE = "connected";
export const CHAT_NETWORKING_DISCONNECTED_MESSAGE_TYPE = "disconnected";
export const CHAT_NETWORKING_SERVER_ERROR_MESSAGE_TYPE = "error";
export const CHAT_NETWORKING_PING_MESSAGE_TYPE = "ping";
export const CHAT_NETWORKING_PONG_MESSAGE_TYPE = "pong";
export const CHAT_NETWORKING_CHAT_MESSAGE_TYPE = "chat";

export type ChatNetworkingIdentityMessage = {
  type: typeof CHAT_NETWORKING_IDENTITY_MESSAGE_TYPE;
  id: number;
};

export type ChatNetworkingConnectedMessage = {
  type: typeof CHAT_NETWORKING_CONNECTED_MESSAGE_TYPE;
  id: number;
};

export type ChatNetworkingDisconnectedMessage = {
  type: typeof CHAT_NETWORKING_DISCONNECTED_MESSAGE_TYPE;
  id: number;
};

export const CHAT_NETWORKING_SERVER_SHUTDOWN_ERROR_TYPE = "SERVER_SHUTDOWN";
export const CHAT_NETWORKING_UNKNOWN_ERROR = "UNKNOWN_ERROR";

export type ChatNetworkingServerErrorType =
  | typeof CHAT_NETWORKING_SERVER_SHUTDOWN_ERROR_TYPE
  | typeof CHAT_NETWORKING_UNKNOWN_ERROR;

export type ChatNetworkingServerError = {
  type: typeof CHAT_NETWORKING_SERVER_ERROR_MESSAGE_TYPE;
  errorType: ChatNetworkingServerErrorType;
  message: string;
};

export type ChatNetworkingServerPingMessage = {
  type: typeof CHAT_NETWORKING_PING_MESSAGE_TYPE;
};

export type ChatNetworkingServerChatMessage = {
  type: typeof CHAT_NETWORKING_CHAT_MESSAGE_TYPE;
  id: number;
  text: string;
};

export type FromServerMessage =
  | ChatNetworkingIdentityMessage
  | ChatNetworkingConnectedMessage
  | ChatNetworkingDisconnectedMessage
  | ChatNetworkingServerPingMessage
  | ChatNetworkingServerChatMessage
  | ChatNetworkingServerError;

export type ChatNetworkingClientPongMessage = {
  type: typeof CHAT_NETWORKING_PONG_MESSAGE_TYPE;
};

export type ChatNetworkingClientAuthenticateMessage = {
  type: typeof CHAT_NETWORKING_USER_AUTHENTICATE_MESSAGE_TYPE;
  sessionToken: string;
};

export type ChatNetworkingClientChatMessage = {
  type: typeof CHAT_NETWORKING_CHAT_MESSAGE_TYPE;
  text: string;
};

export type FromClientMessage =
  | ChatNetworkingClientPongMessage
  | ChatNetworkingClientAuthenticateMessage
  | ChatNetworkingClientChatMessage;
