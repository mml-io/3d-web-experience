import { jest } from "@jest/globals";

import { AnonymousAuthenticator } from "../src/auth/AnonymousAuthenticator";

describe("AnonymousAuthenticator", () => {
  let auth: AnonymousAuthenticator;

  const testAvatars = [
    { meshFileUrl: "/avatars/avatar-1.glb" },
    { meshFileUrl: "/avatars/avatar-2.glb" },
  ];

  beforeEach(() => {
    auth = new AnonymousAuthenticator({ defaultCharacterDescriptions: testAvatars });
  });

  afterEach(() => {
    auth.dispose();
  });

  it("generateAuthorizedSessionToken returns unique tokens", async () => {
    const token1 = await auth.generateAuthorizedSessionToken();
    const token2 = await auth.generateAuthorizedSessionToken();
    expect(typeof token1).toBe("string");
    expect(typeof token2).toBe("string");
    expect(token1).not.toBe(token2);
  });

  it("getClientIdForSessionToken returns id for valid token", async () => {
    const token = await auth.generateAuthorizedSessionToken();
    const result = auth.getClientIdForSessionToken(token);
    expect(result).not.toBeNull();
    expect(result!.id).toBeGreaterThan(0);
  });

  it("getClientIdForSessionToken returns null for invalid token", () => {
    const result = auth.getClientIdForSessionToken("invalid-token");
    expect(result).toBeNull();
  });

  it("onClientConnect with valid token returns UserData with userId", async () => {
    const token = await auth.generateAuthorizedSessionToken();
    const result = auth.onClientConnect(1, token);
    expect(result).not.toBeInstanceOf(Error);
    const userData = result as unknown as {
      userId: string;
      username: string;
      characterDescription: { meshFileUrl: string } | null;
    };
    expect(userData.userId).toEqual(expect.any(String));
    expect(userData.userId.length).toBeGreaterThan(0);
    expect(userData.username).toMatch(/^User \d+$/);
    expect(userData.characterDescription?.meshFileUrl).toContain("/avatars/avatar-");
  });

  it("onClientConnect with invalid token returns Error", () => {
    const result = auth.onClientConnect(1, "bad-token");
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toBe("Invalid session token");
  });

  it("onClientUserIdentityUpdate passes through identity", () => {
    const identity = {
      username: "Test",
      characterDescription: null,
      colors: null,
    };
    const result = auth.onClientUserIdentityUpdate(1, identity);
    expect(result).toBe(identity);
  });

  it("onClientDisconnect cleans up token", async () => {
    const token = await auth.generateAuthorizedSessionToken();
    auth.onClientConnect(1, token);
    auth.onClientDisconnect(1);

    // Token should be removed after disconnect
    const result = auth.getClientIdForSessionToken(token);
    expect(result).toBeNull();
  });

  it("getSessionAuthToken returns null", async () => {
    const token = await auth.generateAuthorizedSessionToken();
    expect(auth.getSessionAuthToken(token)).toBeNull();
  });

  it("dispose clears all state", async () => {
    const token = await auth.generateAuthorizedSessionToken();
    auth.onClientConnect(1, token);
    auth.dispose();
    expect(auth.getClientIdForSessionToken(token)).toBeNull();
  });

  it("assigns from provided character descriptions", async () => {
    const token = await auth.generateAuthorizedSessionToken();
    const result = auth.onClientConnect(1, token);
    const userData = result as { characterDescription: { meshFileUrl: string } };
    expect(testAvatars.map((a) => a.meshFileUrl)).toContain(
      userData.characterDescription.meshFileUrl,
    );
  });

  it("characterDescription is null when no descriptions provided", async () => {
    auth.dispose();
    auth = new AnonymousAuthenticator();
    const token = await auth.generateAuthorizedSessionToken();
    const result = auth.onClientConnect(1, token);
    const userData = result as { characterDescription: unknown };
    expect(userData.characterDescription).toBeNull();
  });

  it("token expiry cleanup removes unused tokens", async () => {
    jest.useFakeTimers();
    auth.dispose();
    auth = new AnonymousAuthenticator({ defaultCharacterDescriptions: testAvatars });

    const token = await auth.generateAuthorizedSessionToken();
    // Don't connect — just leave the token unused
    expect(auth.getClientIdForSessionToken(token)).not.toBeNull();

    // Advance past expiry + cleanup interval
    jest.advanceTimersByTime(6 * 60 * 1000);

    // After cleanup, unused token should be gone
    expect(auth.getClientIdForSessionToken(token)).toBeNull();

    jest.useRealTimers();
  });

  it("connected tokens are not cleaned up by expiry", async () => {
    jest.useFakeTimers();
    auth.dispose();
    auth = new AnonymousAuthenticator({ defaultCharacterDescriptions: testAvatars });

    const token = await auth.generateAuthorizedSessionToken();
    auth.onClientConnect(1, token);

    // Advance past expiry + cleanup interval
    jest.advanceTimersByTime(6 * 60 * 1000);

    // Token should still be valid because client is connected
    expect(auth.getClientIdForSessionToken(token)).not.toBeNull();

    auth.onClientDisconnect(1);
    jest.useRealTimers();
  });
});
