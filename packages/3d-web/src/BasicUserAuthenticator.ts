import crypto from "crypto";

import type { UserAuthenticator } from "@mml-io/3d-web-experience-server";
import type {
  CharacterDescription,
  UserData,
  UserIdentityUpdate,
} from "@mml-io/3d-web-user-networking";
import express from "express";

import { fetchWebhookAuth, WebhookAuthResponse } from "./webhookAuth";

const SESSION_TTL_MS = 60 * 60 * 1000; // 1 hour
const MAX_SESSIONS = 10_000;
export const MAX_USERNAME_LENGTH = 256;

type AuthUser = {
  connectionId: number | null;
  userData?: UserData;
  mmlAuthToken?: string;
  webhookAuthenticated: boolean;
  sessionToken: string;
  createdAt: number;
};

export type BasicUserAuthenticatorOptions = {
  defaultCharacterDescriptions: CharacterDescription[];
  allowAnonymous: boolean;
  webhookUrl?: string;
  maxConnections?: number;
};

export class BasicUserAuthenticator implements UserAuthenticator {
  private static SWEEP_INTERVAL_MS = 60_000;

  private usersByConnectionId = new Map<number, AuthUser>();
  private userBySessionToken = new Map<string, AuthUser>();
  private options: BasicUserAuthenticatorOptions;
  private sweepInterval: ReturnType<typeof setInterval> | null = null;

  constructor(options: BasicUserAuthenticatorOptions) {
    this.options = options;
    if (options.defaultCharacterDescriptions.length === 0) {
      throw new Error("At least one default character description is required");
    }
    this.sweepInterval = setInterval(
      () => this.sweepExpiredSessions(),
      BasicUserAuthenticator.SWEEP_INTERVAL_MS,
    );
    this.sweepInterval.unref();
  }

  private sweepExpiredSessions(): void {
    const now = Date.now();
    for (const [token, user] of this.userBySessionToken) {
      if (user.connectionId === null && now - user.createdAt > SESSION_TTL_MS) {
        this.userBySessionToken.delete(token);
      }
    }
  }

  private isSessionExpired(user: AuthUser): boolean {
    return user.connectionId === null && Date.now() - user.createdAt > SESSION_TTL_MS;
  }

  private randomCharacterDescription(): CharacterDescription {
    const descs = this.options.defaultCharacterDescriptions;
    return descs[Math.floor(Math.random() * descs.length)];
  }

  private sanitizeCharacterDescription(
    desc: CharacterDescription | null | undefined,
    fallback: CharacterDescription | null,
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
      console.warn("[auth] characterDescription fields exceed 8KB limit, using default");
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

  private createSession(webhookResponse?: WebhookAuthResponse): AuthUser | Error {
    if (this.userBySessionToken.size >= MAX_SESSIONS) {
      return new Error(`Session limit reached (${MAX_SESSIONS})`);
    }
    const sessionToken = crypto.randomBytes(20).toString("hex");
    const authUser: AuthUser = {
      connectionId: null,
      sessionToken,
      mmlAuthToken: webhookResponse?.mmlAuthToken,
      webhookAuthenticated: !!webhookResponse,
      createdAt: Date.now(),
    };

    if (webhookResponse) {
      const charDesc = webhookResponse.characterDescription;
      const sanitizedUsername = webhookResponse.username
        .replace(/[\x00-\x1f\x7f]/g, "")
        .slice(0, MAX_USERNAME_LENGTH);
      authUser.userData = {
        userId: webhookResponse.userId ?? crypto.randomUUID(),
        username: sanitizedUsername,
        characterDescription: this.sanitizeCharacterDescription(
          charDesc as CharacterDescription | undefined,
          this.randomCharacterDescription(),
        ),
        colors: [],
      };
    }

    this.userBySessionToken.set(sessionToken, authUser);
    return authUser;
  }

  public setAllowAnonymous(allow: boolean): void {
    this.options.allowAnonymous = allow;
  }

  public async generateAuthorizedSessionToken(req: express.Request): Promise<string | null> {
    const queryToken = req.query["token"] as string | undefined;

    if (this.options.webhookUrl && queryToken) {
      try {
        const webhookResponse = await fetchWebhookAuth(this.options.webhookUrl, queryToken);
        const session = this.createSession(webhookResponse);
        if (session instanceof Error) {
          console.error(`Session creation failed: ${session.message}`);
          return null;
        }
        return session.sessionToken;
      } catch (err) {
        console.error(`Auth webhook failed: ${(err as Error).message}`);
        return null;
      }
    }

    if (this.options.allowAnonymous) {
      const session = this.createSession();
      if (session instanceof Error) {
        console.error(`Session creation failed: ${session.message}`);
        return null;
      }
      return session.sessionToken;
    }

    // No token provided and anonymous access is disabled
    return null;
  }

  /**
   * Create a session for a bot that has already been authenticated via an API
   * key. Bypasses the webhook flow and anonymous-access check.
   */
  public generateBotSessionToken(): string | null {
    const session = this.createSession();
    if (session instanceof Error) {
      console.error(`Bot session creation failed: ${session.message}`);
      return null;
    }
    return session.sessionToken;
  }

  public getSessionAuthToken(sessionToken: string): string | null {
    const user = this.userBySessionToken.get(sessionToken);
    if (!user) return null;
    if (this.isSessionExpired(user)) {
      this.userBySessionToken.delete(sessionToken);
      return null;
    }
    return user.mmlAuthToken ?? null;
  }

  public async onClientConnect(
    connectionId: number,
    sessionToken: string,
    userIdentityPresentedOnConnection?: UserData,
  ): Promise<UserData | true | Error> {
    const user = this.userBySessionToken.get(sessionToken);
    if (!user) {
      return new Error("Unknown or expired session token");
    }

    if (this.isSessionExpired(user)) {
      this.userBySessionToken.delete(sessionToken);
      return new Error("Unknown or expired session token");
    }

    if (user.connectionId !== null) {
      return new Error("Session token already connected");
    }

    if (
      this.options.maxConnections !== undefined &&
      this.usersByConnectionId.size >= this.options.maxConnections
    ) {
      return new Error(`Connection limit reached (${this.options.maxConnections})`);
    }

    user.connectionId = connectionId;

    if (!user.userData) {
      // Anonymous session — assign default identity
      user.userData = {
        userId: crypto.randomUUID(),
        username: `User ${connectionId}`,
        characterDescription: this.sanitizeCharacterDescription(
          userIdentityPresentedOnConnection?.characterDescription,
          this.randomCharacterDescription(),
        ),
        colors: this.sanitizeColors(userIdentityPresentedOnConnection?.colors) ?? [],
      };
    } else if (userIdentityPresentedOnConnection) {
      // Webhook session — allow client to override avatar choice
      user.userData = {
        userId: user.userData.userId,
        username: user.userData.username,
        characterDescription: this.sanitizeCharacterDescription(
          userIdentityPresentedOnConnection.characterDescription,
          user.userData.characterDescription,
        ),
        colors:
          this.sanitizeColors(userIdentityPresentedOnConnection.colors) ?? user.userData.colors,
      };
    }

    this.usersByConnectionId.set(connectionId, user);
    return user.userData;
  }

  public getClientIdForSessionToken(sessionToken: string): { id: number } | null {
    const user = this.userBySessionToken.get(sessionToken);
    if (!user) return null;
    if (this.isSessionExpired(user)) {
      this.userBySessionToken.delete(sessionToken);
      return null;
    }
    if (user.connectionId === null) return null;
    return { id: user.connectionId };
  }

  public onClientUserIdentityUpdate(
    connectionId: number,
    msg: UserIdentityUpdate,
  ): UserIdentityUpdate | true | Error {
    const user = this.usersByConnectionId.get(connectionId);
    if (!user || !user.userData) {
      return new Error(`Unknown connectionId ${connectionId}`);
    }

    const sanitizedUsername =
      msg.username !== null
        ? msg.username.replace(/[\x00-\x1f\x7f]/g, "").slice(0, MAX_USERNAME_LENGTH)
        : undefined;

    // Webhook-authenticated sessions have a server-assigned username — do not
    // allow clients to override it.
    const username =
      user.webhookAuthenticated && user.userData.username
        ? user.userData.username
        : (sanitizedUsername ?? user.userData.username);

    const update: UserIdentityUpdate = {
      username,
      characterDescription: this.sanitizeCharacterDescription(
        msg.characterDescription,
        user.userData.characterDescription,
      ),
      colors: this.sanitizeColors(msg.colors) ?? user.userData.colors,
    };

    user.userData = {
      userId: user.userData.userId,
      username: update.username,
      characterDescription: update.characterDescription,
      colors: update.colors,
    };
    return update;
  }

  public onClientDisconnect(connectionId: number): void {
    const user = this.usersByConnectionId.get(connectionId);
    if (user) {
      this.usersByConnectionId.delete(connectionId);
      this.userBySessionToken.delete(user.sessionToken);
    }
  }

  public dispose(): void {
    if (this.sweepInterval) {
      clearInterval(this.sweepInterval);
      this.sweepInterval = null;
    }
    this.userBySessionToken.clear();
    this.usersByConnectionId.clear();
  }
}
