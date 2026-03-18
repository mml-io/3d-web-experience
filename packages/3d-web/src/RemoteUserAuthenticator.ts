import crypto from "crypto";

import type { UserAuthenticator } from "@mml-io/3d-web-experience-server";
import type {
  CharacterDescription,
  UserData,
  UserIdentityUpdate,
} from "@mml-io/3d-web-user-networking";
import express from "express";

const AUTH_FETCH_TIMEOUT_MS = 10000;
const AUTH_IDENTITY_UPDATE_TIMEOUT_MS = 1000;
const MAX_USERNAME_LENGTH = 256;

export type RemoteUserAuthenticatorOptions = {
  serverUrl: string;
  defaultCharacterDescription: CharacterDescription;
  /** Allow forwarding credentials over HTTP to non-localhost URLs. Defaults to false. */
  allowInsecureHttp?: boolean;
  /** Maximum number of simultaneous connections. Defaults to 10,000. */
  maxConnections?: number;
};

export class RemoteUserAuthenticator implements UserAuthenticator {
  private serverUrl: string;
  private defaultCharacterDescription: CharacterDescription;
  private maxConnections: number;
  private connectionIdBySessionToken = new Map<string, number>();
  private sessionTokenByConnectionId = new Map<number, string>();
  private userDataByConnectionId = new Map<number, UserData>();
  private inFlightTokens = new Set<string>();

  constructor(options: RemoteUserAuthenticatorOptions) {
    this.serverUrl = options.serverUrl.replace(/\/+$/, "");
    this.defaultCharacterDescription = options.defaultCharacterDescription;
    this.maxConnections = options.maxConnections ?? 10_000;

    // Block credential forwarding over HTTP for non-localhost unless explicitly allowed
    try {
      const parsed = new URL(this.serverUrl);
      const isLocalhost =
        parsed.hostname === "localhost" ||
        parsed.hostname === "127.0.0.1" ||
        parsed.hostname === "::1";
      if (parsed.protocol === "http:" && !isLocalhost) {
        if (!options.allowInsecureHttp) {
          throw new Error(
            `Auth server URL "${this.serverUrl}" uses HTTP for a non-localhost host. ` +
              `Credentials (cookie and authorization headers) would be forwarded without encryption. ` +
              `Use HTTPS, or set allowInsecureHttp: true to override this check.`,
          );
        }
        console.warn(
          `[RemoteUserAuthenticator] WARNING: Auth server URL "${this.serverUrl}" uses HTTP. ` +
            `Credentials will be forwarded without encryption (allowInsecureHttp is enabled).`,
        );
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes("uses HTTP")) {
        throw err;
      }
      console.warn(
        `[RemoteUserAuthenticator] WARNING: Could not parse auth server URL "${this.serverUrl}".`,
      );
    }
  }

  private sanitizeCharacterDescription(
    desc: CharacterDescription | null | undefined,
    fallback: CharacterDescription | null = null,
  ): CharacterDescription | null {
    if (!desc) return fallback;

    // Whitelist-copy only fields that are actually strings to prevent non-string
    // values from bypassing the size check or propagating invalid data
    const sanitized: Record<string, string> = {};
    if (typeof desc.meshFileUrl === "string") sanitized.meshFileUrl = desc.meshFileUrl;
    if (typeof desc.mmlCharacterUrl === "string") sanitized.mmlCharacterUrl = desc.mmlCharacterUrl;
    if (typeof desc.mmlCharacterString === "string")
      sanitized.mmlCharacterString = desc.mmlCharacterString;

    const fields = Object.values(sanitized);
    if (fields.length === 0) return fallback;

    const totalLength = fields.reduce((sum, f) => sum + f.length, 0);
    if (totalLength > 8192) {
      console.warn(
        "[RemoteUserAuthenticator] characterDescription fields exceed 8KB limit, using fallback",
      );
      return fallback;
    }
    return sanitized as unknown as CharacterDescription;
  }

  private sanitizeColors(
    colors: Array<[number, number, number]> | null | undefined,
  ): Array<[number, number, number]> | null {
    if (!Array.isArray(colors)) return null;
    const clamped: Array<[number, number, number]> = [];
    for (const entry of colors.slice(0, 100)) {
      if (
        !Array.isArray(entry) ||
        entry.length !== 3 ||
        !entry.every((v) => typeof v === "number" && Number.isFinite(v))
      ) {
        continue;
      }
      clamped.push([
        Math.max(0, Math.min(255, entry[0])),
        Math.max(0, Math.min(255, entry[1])),
        Math.max(0, Math.min(255, entry[2])),
      ]);
    }
    return clamped.length > 0 ? clamped : null;
  }

  private sanitizeUsername(username: string): string {
    return username.replace(/[\x00-\x1f\x7f]/g, "").slice(0, MAX_USERNAME_LENGTH);
  }

  public async generateAuthorizedSessionToken(
    req: express.Request,
  ): Promise<string | { redirect: string } | null> {
    const forwardHeaders: Record<string, string> = {};
    if (req.headers.cookie) {
      forwardHeaders["cookie"] = req.headers.cookie;
    }
    if (req.headers.authorization) {
      forwardHeaders["authorization"] = req.headers.authorization;
    }

    const host = req.get("host");
    if (!host || !/^[\w.-]+(:\d+)?$/.test(host)) {
      console.error("Request has invalid or missing Host header");
      return null;
    }

    let res: Response;
    try {
      res = await fetch(`${this.serverUrl}/session`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...forwardHeaders,
        },
        body: JSON.stringify({
          query: Object.fromEntries(
            Object.entries(req.query).filter(
              (entry): entry is [string, string] => typeof entry[1] === "string",
            ),
          ),
          origin: `${req.protocol}://${host}/`,
        }),
        signal: AbortSignal.timeout(AUTH_FETCH_TIMEOUT_MS),
      });
    } catch (err) {
      console.error(`Auth server unreachable: ${(err as Error).message}`);
      return null;
    }

    if (!res.ok) {
      console.error(`Auth server returned ${res.status}`);
      return null;
    }

    let body: Record<string, unknown>;
    try {
      body = (await res.json()) as Record<string, unknown>;
    } catch {
      console.error("Auth server returned invalid JSON");
      return null;
    }

    if (typeof body.redirect === "string") {
      try {
        const redirectUrl = new URL(body.redirect);
        if (redirectUrl.protocol !== "http:" && redirectUrl.protocol !== "https:") {
          console.error("Auth server returned redirect with disallowed protocol");
          return null;
        }
      } catch {
        console.error("Auth server returned invalid redirect URL");
        return null;
      }
      return { redirect: body.redirect };
    }

    if (typeof body.sessionToken === "string") {
      if (!/^[\w.+/=_-]+$/.test(body.sessionToken)) {
        console.error("Auth server returned session token with unsafe characters");
        return null;
      }
      return body.sessionToken;
    }

    console.error("Auth server response missing sessionToken or redirect");
    return null;
  }

  public getClientIdForSessionToken(sessionToken: string): { id: number } | null {
    const connectionId = this.connectionIdBySessionToken.get(sessionToken);
    if (connectionId === undefined) {
      return null;
    }
    return { id: connectionId };
  }

  public async onClientConnect(
    connectionId: number,
    sessionToken: string,
    userIdentityPresentedOnConnection?: UserData,
  ): Promise<UserData | true | Error> {
    if (this.connectionIdBySessionToken.has(sessionToken)) {
      return new Error("Session token already connected");
    }

    if (this.inFlightTokens.has(sessionToken)) {
      return new Error("Session token already connecting");
    }

    if (this.connectionIdBySessionToken.size + this.inFlightTokens.size >= this.maxConnections) {
      return new Error(`Connection limit reached (${this.maxConnections})`);
    }

    this.inFlightTokens.add(sessionToken);

    let res: Response;
    try {
      res = await fetch(`${this.serverUrl}/session/connect`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          connectionId,
          sessionToken,
          userIdentity: userIdentityPresentedOnConnection,
        }),
        signal: AbortSignal.timeout(AUTH_FETCH_TIMEOUT_MS),
      });
    } catch (err) {
      this.inFlightTokens.delete(sessionToken);
      return new Error(`Auth server unreachable: ${(err as Error).message}`);
    }

    if (!res.ok) {
      this.inFlightTokens.delete(sessionToken);
      let message = `Auth server rejected connection (${res.status})`;
      try {
        const body = (await res.json()) as Record<string, unknown>;
        if (typeof body.message === "string") {
          message = body.message;
        }
      } catch {
        // ignore parse errors
      }
      return new Error(message);
    }

    let body: Record<string, unknown>;
    try {
      body = (await res.json()) as Record<string, unknown>;
    } catch {
      this.inFlightTokens.delete(sessionToken);
      return new Error("Auth server returned invalid JSON on connect");
    }

    let resultUserData: UserData;

    if (body.userData && typeof body.userData === "object") {
      const ud = body.userData as Record<string, unknown>;
      if (typeof ud.username !== "string" || typeof ud.userId !== "string") {
        this.inFlightTokens.delete(sessionToken);
        return new Error("Auth server returned invalid userData (missing username or userId)");
      }
      resultUserData = {
        userId: ud.userId as string,
        username: this.sanitizeUsername(ud.username as string),
        characterDescription:
          this.sanitizeCharacterDescription(
            ud.characterDescription as CharacterDescription | null,
            this.defaultCharacterDescription,
          ) ?? this.defaultCharacterDescription,
        colors: this.sanitizeColors(ud.colors as Array<[number, number, number]> | null) ?? [],
      };
    } else {
      resultUserData = {
        userId: crypto.randomUUID(),
        username: `User ${connectionId}`,
        characterDescription:
          this.sanitizeCharacterDescription(
            userIdentityPresentedOnConnection?.characterDescription,
            this.defaultCharacterDescription,
          ) ?? this.defaultCharacterDescription,
        colors: this.sanitizeColors(userIdentityPresentedOnConnection?.colors) ?? [],
      };
    }

    this.inFlightTokens.delete(sessionToken);
    this.connectionIdBySessionToken.set(sessionToken, connectionId);
    this.sessionTokenByConnectionId.set(connectionId, sessionToken);
    this.userDataByConnectionId.set(connectionId, resultUserData);
    return resultUserData;
  }

  public async onClientUserIdentityUpdate(
    connectionId: number,
    userIdentity: UserIdentityUpdate,
  ): Promise<UserIdentityUpdate | Error> {
    const existingUserData = this.userDataByConnectionId.get(connectionId);
    if (!existingUserData) {
      return new Error(`Unknown connectionId ${connectionId}`);
    }

    const existingUpdate: UserIdentityUpdate = {
      username: existingUserData.username,
      characterDescription: existingUserData.characterDescription,
      colors: existingUserData.colors,
    };

    let res: Response;
    try {
      res = await fetch(`${this.serverUrl}/session/update`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ connectionId, userIdentity }),
        signal: AbortSignal.timeout(AUTH_IDENTITY_UPDATE_TIMEOUT_MS),
      });
    } catch (err) {
      console.error(`Auth server identity update timed out or failed: ${(err as Error).message}`);
      return existingUpdate;
    }

    if (!res.ok) {
      return existingUpdate;
    }

    let body: Record<string, unknown>;
    try {
      body = (await res.json()) as Record<string, unknown>;
    } catch {
      return existingUpdate;
    }

    if (body.userData && typeof body.userData === "object") {
      const ud = body.userData as Record<string, unknown>;
      if (typeof ud.username === "string") {
        const sanitizedCharDesc = this.sanitizeCharacterDescription(
          ud.characterDescription as CharacterDescription | null,
          this.defaultCharacterDescription,
        );
        const serverUpdate: UserIdentityUpdate = {
          username: this.sanitizeUsername(ud.username as string),
          characterDescription: sanitizedCharDesc ?? this.defaultCharacterDescription,
          colors:
            this.sanitizeColors(ud.colors as Array<[number, number, number]> | null) ??
            existingUserData.colors,
        };
        this.userDataByConnectionId.set(connectionId, {
          userId: existingUserData.userId,
          username: serverUpdate.username,
          characterDescription: serverUpdate.characterDescription,
          colors: serverUpdate.colors,
        });
        return serverUpdate;
      }
    }

    const sanitizedIdentity: UserIdentityUpdate = {
      username:
        userIdentity.username !== null ? this.sanitizeUsername(userIdentity.username) : null,
      characterDescription:
        this.sanitizeCharacterDescription(
          userIdentity.characterDescription,
          existingUserData.characterDescription,
        ) ?? existingUserData.characterDescription,
      colors: this.sanitizeColors(userIdentity.colors) ?? existingUserData.colors,
    };
    this.userDataByConnectionId.set(connectionId, {
      userId: existingUserData.userId,
      username: sanitizedIdentity.username ?? existingUserData.username,
      characterDescription: sanitizedIdentity.characterDescription,
      colors: sanitizedIdentity.colors,
    });
    return sanitizedIdentity;
  }

  public onClientDisconnect(connectionId: number): void {
    const token = this.sessionTokenByConnectionId.get(connectionId);
    if (token) {
      this.connectionIdBySessionToken.delete(token);
      this.sessionTokenByConnectionId.delete(connectionId);
    }
    this.userDataByConnectionId.delete(connectionId);

    // Fire-and-forget notification to the auth server
    fetch(`${this.serverUrl}/session/disconnect`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ connectionId, sessionToken: token }),
      signal: AbortSignal.timeout(AUTH_FETCH_TIMEOUT_MS),
    }).catch((err) => {
      console.error(`Failed to notify auth server of disconnect: ${(err as Error).message}`);
    });
  }

  public getSessionAuthToken(sessionToken: string): Promise<string | null> {
    return fetch(`${this.serverUrl}/session/auth-token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionToken }),
      signal: AbortSignal.timeout(AUTH_FETCH_TIMEOUT_MS),
    })
      .then(async (res) => {
        if (!res.ok) return null;
        const body = (await res.json()) as Record<string, unknown>;
        return typeof body.authToken === "string" ? body.authToken : null;
      })
      .catch(() => null);
  }

  public dispose(): void {
    this.connectionIdBySessionToken.clear();
    this.sessionTokenByConnectionId.clear();
    this.userDataByConnectionId.clear();
    this.inFlightTokens.clear();
  }
}
