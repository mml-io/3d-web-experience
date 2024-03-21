export const CONNECTED_MESSAGE_TYPE = "connected";
export const DISCONNECTED_MESSAGE_TYPE = "disconnected";
export const IDENTITY_MESSAGE_TYPE = "identity";
export const PING_MESSAGE_TYPE = "ping";
export const PONG_MESSAGE_TYPE = "pong";
export const USER_UPDATE = "user_update" 
export const USER_UPDATE_REMOTE = "user_update_remote"
export const USER_CREDENTIALS_PROMPT = "user_credentials_prompt"
export const USER_CREDENTIALS = "user_credentials"
export const CHARACTER_UPDATE = "character_update"

export type ConnectedMessage = {
  type: typeof CONNECTED_MESSAGE_TYPE;
  id: number;
};

export type UserRemoteUpdateMessage = {
  // This shall only contain data that's public to all players and guests
  type: typeof USER_UPDATE_REMOTE;
  id: number; // The connection id which has been updated
  username: string; 
  characterDescription: object;
  params: object | null; // customizable parameters
}

export type UserUpdateMessage = {
  // This shall contain all data (public and private) designated for the logged-in user.
  // It shall only be sent to the connection `id`, which provided corresponding `user_credentials`
  type: typeof USER_UPDATE;
  id: number; // The connection id which has been updated
  username: string; 
  characterId: number;
  params: object | null; // customizable parameters
}

export type CharacterUpdateMessage = {
  type: typeof CHARACTER_UPDATE;
  characterId: number;
  characterDescription: object;
}

export type UserCredentialsPromptMessage = {
  // Expected to be answered with a user_credentials
  type: typeof USER_CREDENTIALS_PROMPT;
  challenge: string | null; // e.g. a message to sign
}

export type UserCredentialsMessage = {
  type: typeof USER_CREDENTIALS;
  credentials: object | null; // TODO typing! At least support username, password (or password hash), signature of challenge,
}

export type IdentityMessage = {
  type: typeof IDENTITY_MESSAGE_TYPE;
  id: number;
};

export type DisconnectedMessage = {
  type: typeof DISCONNECTED_MESSAGE_TYPE;
  id: number;
};

export type FromServerPingMessage = {
  type: typeof PING_MESSAGE_TYPE;
};

export type FromClientPongMessage = {
  type: typeof PONG_MESSAGE_TYPE;
};

export type FromServerMessage =
  | ConnectedMessage
  | IdentityMessage
  | UserCredentialsPromptMessage
  | UserUpdateMessage
  | UserRemoteUpdateMessage
  | CharacterUpdateMessage
  | DisconnectedMessage
  | FromServerPingMessage;

export type FromClientMessage = 
  | FromClientPongMessage
  | UserCredentialsMessage;
