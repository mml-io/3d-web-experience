// Server -> Client
export const InitialCheckoutMessageType = 1;
export const ServerCustomMessageType = 2;
export const UserIndexMessageType = 4; // Response to ConnectUserMessageType to indicate the user indices in the server data
export const TickMessageType = 6;
export const PingMessageType = 8;
export const WarningMessageType = 9;
export const ErrorMessageType = 10;

// Client -> Server
export const ConnectUserMessageType = 11;
export const SetUserComponentsMessageType = 12;
export const SetUserStateMessageType = 13;
export const PongMessageType = 14;
export const ClientCustomMessageType = 15;
