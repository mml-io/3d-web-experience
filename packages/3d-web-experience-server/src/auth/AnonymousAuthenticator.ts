import crypto from "crypto";

import type { CharacterDescription, UserData } from "@mml-io/3d-web-user-networking";

import type { UserAuthenticator } from "../Networked3dWebExperienceServer";

const TOKEN_EXPIRY_MS = 5 * 60 * 1000; // Unused tokens expire after 5 minutes
const TOKEN_CLEANUP_INTERVAL_MS = 60 * 1000; // Clean up every minute

export type AnonymousAuthenticatorOptions = {
  /** Character descriptions to randomly assign to connecting users. */
  defaultCharacterDescriptions?: CharacterDescription[];
};

/**
 * Stateless anonymous authenticator. Every connection gets a random username
 * and avatar. No database required.
 */
export class AnonymousAuthenticator implements UserAuthenticator {
  private usersByToken = new Map<
    string,
    { id: number; userData: UserData; connectionId: number | null; createdAt: number }
  >();
  private connectionIdToToken = new Map<number, string>();
  private nextId = 1;
  private characterDescriptions: CharacterDescription[];
  private cleanupInterval: ReturnType<typeof setInterval>;

  constructor(options?: AnonymousAuthenticatorOptions) {
    this.characterDescriptions = options?.defaultCharacterDescriptions ?? [];

    // Periodically clean up tokens that were never used to connect.
    // Use unref() so this interval doesn't prevent the process from exiting
    // if dispose() is not called.
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [token, entry] of this.usersByToken) {
        if (entry.connectionId === null && now - entry.createdAt > TOKEN_EXPIRY_MS) {
          this.usersByToken.delete(token);
        }
      }
    }, TOKEN_CLEANUP_INTERVAL_MS);
    this.cleanupInterval.unref();
  }

  private randomCharacterDescription(): CharacterDescription | undefined {
    if (this.characterDescriptions.length === 0) return undefined;
    return this.characterDescriptions[
      Math.floor(Math.random() * this.characterDescriptions.length)
    ];
  }

  async generateAuthorizedSessionToken(): Promise<string> {
    const token = crypto.randomBytes(20).toString("hex");
    const id = this.nextId++;
    const characterDescription = this.randomCharacterDescription();
    const userData: UserData = {
      userId: crypto.randomUUID(),
      username: `User ${id}`,
      characterDescription: characterDescription ?? null,
      colors: null,
    };
    this.usersByToken.set(token, { id, userData, connectionId: null, createdAt: Date.now() });
    return token;
  }

  getClientIdForSessionToken(sessionToken: string): { id: number } | null {
    const entry = this.usersByToken.get(sessionToken);
    if (!entry) return null;
    return { id: entry.id };
  }

  onClientConnect(
    connectionId: number,
    sessionToken: string,
    _userIdentityPresentedOnConnection?: UserData,
  ): UserData | true | Error {
    const entry = this.usersByToken.get(sessionToken);
    if (!entry) {
      return new Error("Invalid session token");
    }
    if (entry.connectionId !== null) {
      return new Error("Session token already connected");
    }
    entry.connectionId = connectionId;
    this.connectionIdToToken.set(connectionId, sessionToken);
    return entry.userData;
  }

  onClientUserIdentityUpdate(
    _connectionId: number,
    userIdentity: UserData,
  ): UserData | true | Error {
    return userIdentity;
  }

  onClientDisconnect(connectionId: number): void {
    const token = this.connectionIdToToken.get(connectionId);
    if (token) {
      this.usersByToken.delete(token);
      this.connectionIdToToken.delete(connectionId);
    }
  }

  getSessionAuthToken(_sessionToken: string): string | null {
    return null;
  }

  dispose(): void {
    clearInterval(this.cleanupInterval);
    this.usersByToken.clear();
    this.connectionIdToToken.clear();
  }
}
