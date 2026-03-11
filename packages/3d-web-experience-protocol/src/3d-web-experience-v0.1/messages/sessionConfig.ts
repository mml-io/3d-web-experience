import { isRecord } from "./utils";

/**
 * Per-user session data sent via `FROM_SERVER_SESSION_CONFIG_MESSAGE_TYPE`.
 *
 * Unlike `WorldConfigPayload` (which is the same for all clients), this
 * payload carries data specific to a single user's session — for example,
 * an auth token for authenticated MML document connections.
 */
export type SessionConfigPayload = {
  /** Auth token for MML document connections that require authentication. */
  authToken?: string | null;
};

/**
 * Parses a JSON string into a validated `SessionConfigPayload`.
 *
 * Returns an `Error` if the string is not valid JSON or the resulting value
 * does not conform to the expected shape.
 */
export function parseSessionConfigPayload(contents: string): SessionConfigPayload | Error {
  try {
    const parsed: unknown = JSON.parse(contents);
    if (!isRecord(parsed)) {
      throw new Error("expected a plain object");
    }

    const result: SessionConfigPayload = {};
    if ("authToken" in parsed) {
      if (parsed.authToken !== null && typeof parsed.authToken !== "string") {
        throw new Error("authToken must be a string or null");
      }
      result.authToken = parsed.authToken as string | null;
    }
    return result;
  } catch (error) {
    return error instanceof Error ? error : new Error(`Invalid session config: ${error}`);
  }
}

/** Serializes a session config payload to JSON for sending over the wire. */
export function serializeSessionConfigPayload(config: SessionConfigPayload): string {
  return JSON.stringify(config);
}
