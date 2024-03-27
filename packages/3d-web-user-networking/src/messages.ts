export const CONNECTED_MESSAGE_TYPE = "connected";
export const DISCONNECTED_MESSAGE_TYPE = "disconnected";
export const IDENTITY_MESSAGE_TYPE = "identity";
export const USER_PROFILE_MESSAGE_TYPE = "user_profile"; // To broadcast user info, the global info for all clients
export const USER_UPDATE_MESSAGE_TYPE = "user_update"; // to set user-info, credentials, characterDescription etc
export const PING_MESSAGE_TYPE = "ping";
export const PONG_MESSAGE_TYPE = "pong";

export type ConnectedMessage = {
  type: typeof CONNECTED_MESSAGE_TYPE;
  id: number;
};

export type IdentityMessage = {
  type: typeof IDENTITY_MESSAGE_TYPE;
  id: number;
};

/**
 * The Public User-Profile for a certain `id`
 */
export type UserProfileMessage = {
  type: typeof USER_PROFILE_MESSAGE_TYPE;
  id: number;
  characterDescription: object;
  userName: string;
};

export type DisconnectedMessage = {
  type: typeof DISCONNECTED_MESSAGE_TYPE;
  id: number;
};

export type FromServerPingMessage = {
  type: typeof PING_MESSAGE_TYPE;
};

export type FromServerMessage =
  | ConnectedMessage
  | IdentityMessage
  | UserProfileMessage
  | DisconnectedMessage
  | FromServerPingMessage;

export type FromClientPongMessage = {
  type: typeof PONG_MESSAGE_TYPE;
};

/**
 * The User-Update message including credentials.
 * This allows the client to log in and customize his character
 * The server may verify the UserUpdate before broadcasting via USER_PROFILE_TYPE
 */
export type UserUpdateMessage = {
  type: typeof USER_UPDATE_MESSAGE_TYPE;
  // TODO proper typing
  credentials: {
    USER_AUTH_TOKEN: string; // This is set a
  };
  characterDescription: object;
  userName: string|null;
};

export type FromClientMessage = FromClientPongMessage | UserUpdateMessage;
