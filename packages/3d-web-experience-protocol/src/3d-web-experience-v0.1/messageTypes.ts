/**
 * Custom message type IDs for experience protocol v0.1.
 *
 * These numeric identifiers are used as the `customType` field in delta-net
 * custom messages. All type IDs share a single numeric namespace — the
 * `FROM_CLIENT_` / `FROM_SERVER_` naming convention indicates directionality.
 *
 * Naming convention: `FROM_<SOURCE>_<DESCRIPTION>_MESSAGE_TYPE`
 */

/** Server-to-client broadcast message. */
export const FROM_SERVER_BROADCAST_MESSAGE_TYPE = 1 as const;

/** Client-to-server chat message. */
export const FROM_CLIENT_CHAT_MESSAGE_TYPE = 2 as const;

/** Server-to-client chat message (relayed from another client). */
export const FROM_SERVER_CHAT_MESSAGE_TYPE = 3 as const;

/**
 * Server-to-client world configuration message.
 *
 * Sent per-client after authentication and can be broadcast to all clients for
 * live config updates. The JSON payload corresponds to `WorldConfigPayload`.
 */
export const FROM_SERVER_WORLD_CONFIG_MESSAGE_TYPE = 4 as const;
