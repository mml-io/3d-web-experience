import { MAX_USERNAME_LENGTH } from "./BasicUserAuthenticator";

const WEBHOOK_FETCH_TIMEOUT_MS = 10000;

export type WebhookAuthResponse = {
  userId?: string;
  username: string;
  characterDescription?: {
    meshFileUrl?: string;
    mmlCharacterUrl?: string;
    mmlCharacterString?: string;
  };
  mmlAuthToken?: string;
};

export async function fetchWebhookAuth(
  webhookUrl: string,
  token: string,
): Promise<WebhookAuthResponse> {
  const url = new URL(webhookUrl);

  if (url.protocol === "http:") {
    const hostname = url.hostname;
    if (hostname !== "localhost" && hostname !== "127.0.0.1" && hostname !== "::1") {
      console.warn(
        "WARNING: Webhook URL uses HTTP — the auth token will be sent in cleartext. Use HTTPS in production.",
      );
    }
  }

  const headers: Record<string, string> = {};
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  let res: Response;
  try {
    res = await fetch(url, { headers, signal: AbortSignal.timeout(WEBHOOK_FETCH_TIMEOUT_MS) });
  } catch (err) {
    throw new Error(`Webhook request failed: ${(err as Error).message}`);
  }

  if (!res.ok) {
    let message = `Webhook returned ${res.status}`;
    try {
      const body = await res.json();
      if (
        body &&
        typeof body === "object" &&
        "message" in body &&
        typeof body.message === "string"
      ) {
        message = body.message;
      }
    } catch {
      // ignore parse errors
    }
    throw new Error(message);
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new Error("Invalid JSON response from auth webhook");
  }

  if (!json || typeof json !== "object") {
    throw new Error("Auth webhook response must be a JSON object");
  }

  const body = json as Record<string, unknown>;
  if (typeof body.username !== "string" || body.username.length === 0) {
    throw new Error("Auth webhook response must include a non-empty 'username' string");
  }
  if (body.username.length > MAX_USERNAME_LENGTH) {
    throw new Error(
      `Auth webhook username exceeds maximum length (${MAX_USERNAME_LENGTH} characters)`,
    );
  }

  let characterDescription: WebhookAuthResponse["characterDescription"] | undefined;
  if (body.characterDescription && typeof body.characterDescription === "object") {
    const cd = body.characterDescription as Record<string, unknown>;
    characterDescription = {};
    if (typeof cd.meshFileUrl === "string") characterDescription.meshFileUrl = cd.meshFileUrl;
    if (typeof cd.mmlCharacterUrl === "string")
      characterDescription.mmlCharacterUrl = cd.mmlCharacterUrl;
    if (typeof cd.mmlCharacterString === "string")
      characterDescription.mmlCharacterString = cd.mmlCharacterString;
  }

  return {
    userId: typeof body.userId === "string" ? body.userId : undefined,
    username: body.username,
    characterDescription,
    mmlAuthToken: typeof body.mmlAuthToken === "string" ? body.mmlAuthToken : undefined,
  };
}
