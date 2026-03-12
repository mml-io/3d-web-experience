import { isRecord } from "./utils";

export type ServerBroadcastMessage = {
  broadcastType: string;
  payload: Record<string, unknown>;
};

export function parseServerBroadcastMessage(contents: string): ServerBroadcastMessage | Error {
  try {
    const parsed: unknown = JSON.parse(contents);
    if (isRecord(parsed) && typeof parsed.broadcastType === "string" && isRecord(parsed.payload)) {
      return {
        broadcastType: parsed.broadcastType,
        payload: parsed.payload,
      };
    }
    return new Error("Invalid server broadcast message: expected {broadcastType, payload}");
  } catch (error) {
    return error instanceof Error ? error : new Error(`Invalid server broadcast message: ${error}`);
  }
}

/** Serializes a server broadcast message to JSON for sending over the wire. */
export function serializeServerBroadcastMessage(msg: ServerBroadcastMessage): string {
  return JSON.stringify(msg);
}
