/**
 * WebSocket sub-protocol string for 3d-web-experience protocol version 0.1.
 *
 * This is the value advertised during the WebSocket handshake. It encapsulates
 * the full application-level protocol: the underlying transport (delta-net) and
 * all custom message types defined by this version.
 */
export const experienceProtocolSubProtocol_v0_1 = "3d-web-experience-v0.1";

/**
 * The delta-net sub-protocol version used internally by experience protocol v0.1.
 *
 * This is an implementation detail — consumers of the experience protocol should
 * not need to reference this directly.
 */
export const experienceProtocol_v0_1_deltaNetSubProtocol = "delta-net-v0.2";

/**
 * Maximum allowed length for a chat message in characters.
 *
 * Serialization functions (`serializeClientChatMessage`, `serializeServerChatMessage`)
 * enforce this limit. The server should also truncate before relaying to prevent
 * oversized messages from being broadcast.
 */
export const MAX_CHAT_MESSAGE_LENGTH = 1000;
