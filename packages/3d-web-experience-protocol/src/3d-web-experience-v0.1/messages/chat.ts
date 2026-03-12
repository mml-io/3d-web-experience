import { MAX_CHAT_MESSAGE_LENGTH } from "../constants";

import { isRecord } from "./utils";

export type ClientChatMessage = {
  message: string;
};

export type ServerChatMessage = {
  fromConnectionId: number;
  userId: string;
  message: string;
};

/**
 * Parses a JSON string into a validated `ClientChatMessage`.
 *
 * This function validates structure only — it does NOT truncate the message.
 * Truncation is an application-level concern and should be done by the server
 * before relaying (see `Networked3dWebExperienceServer`).
 */
export function parseClientChatMessage(contents: string): ClientChatMessage | Error {
  try {
    const parsed: unknown = JSON.parse(contents);
    if (isRecord(parsed) && typeof parsed.message === "string") {
      return {
        message: parsed.message,
      };
    }
    return new Error("Invalid chat message: expected {message}");
  } catch (error) {
    return error instanceof Error ? error : new Error(`Invalid chat message: ${error}`);
  }
}

/**
 * Parses a JSON string into a validated `ServerChatMessage`.
 *
 * This function validates structure only — it does NOT truncate the message.
 */
export function parseServerChatMessage(contents: string): ServerChatMessage | Error {
  try {
    const parsed: unknown = JSON.parse(contents);
    if (
      isRecord(parsed) &&
      typeof parsed.fromConnectionId === "number" &&
      Number.isInteger(parsed.fromConnectionId) &&
      parsed.fromConnectionId >= 0 &&
      typeof parsed.message === "string"
    ) {
      return {
        fromConnectionId: parsed.fromConnectionId,
        userId: typeof parsed.userId === "string" ? parsed.userId : "",
        message: parsed.message,
      };
    }
    return new Error(
      "Invalid server chat message: expected {fromConnectionId (non-negative integer), message}",
    );
  } catch (error) {
    return error instanceof Error ? error : new Error(`Invalid server chat message: ${error}`);
  }
}

/**
 * Serializes a client chat message to JSON for sending over the wire.
 *
 * Truncates the message to `MAX_CHAT_MESSAGE_LENGTH` characters.
 */
export function serializeClientChatMessage(msg: ClientChatMessage): string {
  return JSON.stringify({
    message: msg.message.slice(0, MAX_CHAT_MESSAGE_LENGTH),
  });
}

/**
 * Serializes a server chat message to JSON for sending over the wire.
 *
 * Truncates the message to `MAX_CHAT_MESSAGE_LENGTH` characters.
 */
export function serializeServerChatMessage(msg: ServerChatMessage): string {
  return JSON.stringify({
    fromConnectionId: msg.fromConnectionId,
    userId: msg.userId,
    message: msg.message.slice(0, MAX_CHAT_MESSAGE_LENGTH),
  });
}
