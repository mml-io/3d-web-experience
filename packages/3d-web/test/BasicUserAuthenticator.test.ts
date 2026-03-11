import { jest } from "@jest/globals";

import { BasicUserAuthenticator } from "../src/BasicUserAuthenticator";

// Minimal mock request factory
function mockRequest(query: Record<string, string> = {}): import("express").Request {
  return { query } as unknown as import("express").Request;
}

const defaultCharacterDescriptions = [{ meshFileUrl: "/avatars/avatar-1-bodyA-skin01.glb" }];

describe("BasicUserAuthenticator", () => {
  describe("anonymous mode (allowAnonymous: true, no webhook)", () => {
    let auth: BasicUserAuthenticator;

    beforeEach(() => {
      auth = new BasicUserAuthenticator({
        defaultCharacterDescriptions,
        allowAnonymous: true,
      });
    });

    afterEach(() => {
      auth.dispose();
    });

    it("generates unique session tokens", async () => {
      const req = mockRequest();
      const t1 = await auth.generateAuthorizedSessionToken(req);
      const t2 = await auth.generateAuthorizedSessionToken(req);
      expect(t1).toBeTruthy();
      expect(t2).toBeTruthy();
      expect(t1).not.toBe(t2);
    });

    it("onClientConnect succeeds with a known token", async () => {
      const token = (await auth.generateAuthorizedSessionToken(mockRequest()))!;
      const result = await auth.onClientConnect(1, token);
      expect(result).not.toBeInstanceOf(Error);
      expect((result as import("@mml-io/3d-web-user-networking").UserData).username).toBe("User 1");
    });

    it("onClientConnect assigns default username 'User {id}'", async () => {
      const token = (await auth.generateAuthorizedSessionToken(mockRequest()))!;
      const result = await auth.onClientConnect(42, token);
      expect((result as import("@mml-io/3d-web-user-networking").UserData).username).toBe(
        "User 42",
      );
    });

    it("onClientConnect uses default characterDescription when none provided", async () => {
      const token = (await auth.generateAuthorizedSessionToken(mockRequest()))!;
      const result = await auth.onClientConnect(1, token);
      expect(
        (result as import("@mml-io/3d-web-user-networking").UserData).characterDescription,
      ).toEqual(defaultCharacterDescriptions[0]);
    });

    it("onClientConnect uses client-provided characterDescription when given", async () => {
      const token = (await auth.generateAuthorizedSessionToken(mockRequest()))!;
      const clientChar = { meshFileUrl: "/custom-avatar.glb" };
      const result = await auth.onClientConnect(1, token, {
        userId: "user-1",
        username: "ignored",
        characterDescription: clientChar,
        colors: [],
      });
      expect(
        (result as import("@mml-io/3d-web-user-networking").UserData).characterDescription,
      ).toEqual(clientChar);
    });

    it("rejects unknown session tokens", async () => {
      const result = await auth.onClientConnect(1, "nonexistent-token");
      expect(result).toBeInstanceOf(Error);
      expect((result as Error).message).toMatch(/Unknown or expired/);
    });

    it("rejects duplicate connection on same token", async () => {
      const token = (await auth.generateAuthorizedSessionToken(mockRequest()))!;
      await auth.onClientConnect(1, token);
      const result = await auth.onClientConnect(2, token);
      expect(result).toBeInstanceOf(Error);
      expect((result as Error).message).toMatch(/already connected/);
    });

    it("getClientIdForSessionToken returns id for connected user", async () => {
      const token = (await auth.generateAuthorizedSessionToken(mockRequest()))!;
      await auth.onClientConnect(7, token);
      expect(auth.getClientIdForSessionToken(token)).toEqual({ id: 7 });
    });

    it("getClientIdForSessionToken returns null for disconnected user", async () => {
      const token = (await auth.generateAuthorizedSessionToken(mockRequest()))!;
      await auth.onClientConnect(7, token);
      auth.onClientDisconnect(7);
      expect(auth.getClientIdForSessionToken(token)).toBeNull();
    });

    it("onClientUserIdentityUpdate merges new fields", async () => {
      const token = (await auth.generateAuthorizedSessionToken(mockRequest()))!;
      await auth.onClientConnect(1, token);

      const updated = auth.onClientUserIdentityUpdate(1, {
        username: "NewName",
        characterDescription: { meshFileUrl: "/new.glb" },
        colors: [],
      });
      expect(updated).not.toBeInstanceOf(Error);
      const identity = updated as import("@mml-io/3d-web-user-networking").UserIdentityUpdate;
      expect(identity.username).toBe("NewName");
    });

    it("onClientUserIdentityUpdate returns error for unknown connectionId", () => {
      const result = auth.onClientUserIdentityUpdate(999, {
        username: "x",
        characterDescription: defaultCharacterDescriptions[0],
        colors: [],
      });
      expect(result).toBeInstanceOf(Error);
      expect((result as Error).message).toMatch(/Unknown connectionId/);
    });

    it("onClientDisconnect removes session entirely", async () => {
      const token = (await auth.generateAuthorizedSessionToken(mockRequest()))!;
      await auth.onClientConnect(1, token);
      auth.onClientDisconnect(1);

      // Session is fully removed — reconnection with the same token fails
      const result = await auth.onClientConnect(2, token);
      expect(result).toBeInstanceOf(Error);
      expect((result as Error).message).toMatch(/Unknown or expired/);
    });

    it("getSessionAuthToken returns null for anonymous sessions", async () => {
      const token = (await auth.generateAuthorizedSessionToken(mockRequest()))!;
      expect(auth.getSessionAuthToken(token)).toBeNull();
    });
  });

  describe("anonymous mode disabled (allowAnonymous: false, no webhook)", () => {
    let auth: BasicUserAuthenticator;

    beforeEach(() => {
      auth = new BasicUserAuthenticator({
        defaultCharacterDescriptions,
        allowAnonymous: false,
      });
    });

    afterEach(() => {
      auth.dispose();
    });

    it("generateAuthorizedSessionToken returns null (no query token)", async () => {
      const result = await auth.generateAuthorizedSessionToken(mockRequest());
      expect(result).toBeNull();
    });

    it("generateAuthorizedSessionToken returns null (with query token but no webhook)", async () => {
      const result = await auth.generateAuthorizedSessionToken(mockRequest({ token: "abc" }));
      expect(result).toBeNull();
    });
  });

  describe("webhook mode", () => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    function setupWebhookAuth(opts: { allowAnonymous?: boolean } = {}): BasicUserAuthenticator {
      return new BasicUserAuthenticator({
        defaultCharacterDescriptions,
        allowAnonymous: opts.allowAnonymous ?? false,
        webhookUrl: "https://example.com/auth",
      });
    }

    function mockFetchOk(body: Record<string, unknown>): void {
      jest.spyOn(global, "fetch").mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => body,
      } as Response);
    }

    it("generateAuthorizedSessionToken calls webhook with Authorization header", async () => {
      mockFetchOk({ username: "alice" });
      const auth = setupWebhookAuth();
      const token = await auth.generateAuthorizedSessionToken(mockRequest({ token: "ext-tok" }));
      expect(token).toBeTruthy();

      const fetchMock = global.fetch as jest.Mock<typeof global.fetch>;
      const calledUrl = fetchMock.mock.calls[0][0] as URL;
      expect(calledUrl.searchParams.get("token")).toBeNull();
      const calledOpts = fetchMock.mock.calls[0][1] as RequestInit;
      expect((calledOpts.headers as Record<string, string>)["Authorization"]).toBe(
        "Bearer ext-tok",
      );
      auth.dispose();
    });

    it("stores webhook-provided username and characterDescription", async () => {
      mockFetchOk({
        username: "alice",
        characterDescription: { meshFileUrl: "/alice.glb" },
      });
      const auth = setupWebhookAuth();
      const sessionToken = (await auth.generateAuthorizedSessionToken(
        mockRequest({ token: "tok" }),
      ))!;
      const userData = await auth.onClientConnect(1, sessionToken);
      expect((userData as import("@mml-io/3d-web-user-networking").UserData).username).toBe(
        "alice",
      );
      expect(
        (userData as import("@mml-io/3d-web-user-networking").UserData).characterDescription,
      ).toEqual({ meshFileUrl: "/alice.glb" });
      auth.dispose();
    });

    it("stores webhook-provided mmlAuthToken", async () => {
      mockFetchOk({ username: "alice", mmlAuthToken: "jwt-123" });
      const auth = setupWebhookAuth();
      const sessionToken = (await auth.generateAuthorizedSessionToken(
        mockRequest({ token: "tok" }),
      ))!;
      expect(auth.getSessionAuthToken(sessionToken)).toBe("jwt-123");
      auth.dispose();
    });

    it("returns null when webhook fails (non-200)", async () => {
      jest.spyOn(global, "fetch").mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({}),
      } as Response);
      const auth = setupWebhookAuth();
      const result = await auth.generateAuthorizedSessionToken(mockRequest({ token: "tok" }));
      expect(result).toBeNull();
      auth.dispose();
    });

    it("returns null when webhook returns invalid response", async () => {
      mockFetchOk({ noUsername: true });
      const auth = setupWebhookAuth();
      const result = await auth.generateAuthorizedSessionToken(mockRequest({ token: "tok" }));
      expect(result).toBeNull();
      auth.dispose();
    });

    it("falls back to anonymous when no query token and allowAnonymous=true", async () => {
      const fetchMock = jest
        .spyOn(global, "fetch")
        .mockImplementation(jest.fn<typeof global.fetch>());
      const auth = setupWebhookAuth({ allowAnonymous: true });
      const token = await auth.generateAuthorizedSessionToken(mockRequest());
      expect(token).toBeTruthy();
      // Should be anonymous — no webhook call
      expect(fetchMock).not.toHaveBeenCalled();
      auth.dispose();
    });

    it("returns null when no query token and allowAnonymous=false", async () => {
      const auth = setupWebhookAuth({ allowAnonymous: false });
      const result = await auth.generateAuthorizedSessionToken(mockRequest());
      expect(result).toBeNull();
      auth.dispose();
    });
  });

  describe("connection limits", () => {
    let auth: BasicUserAuthenticator;

    beforeEach(() => {
      auth = new BasicUserAuthenticator({
        defaultCharacterDescriptions,
        allowAnonymous: true,
        maxConnections: 2,
      });
    });

    afterEach(() => {
      auth.dispose();
    });

    it("accepts connections up to maxConnections", async () => {
      const t1 = (await auth.generateAuthorizedSessionToken(mockRequest()))!;
      const t2 = (await auth.generateAuthorizedSessionToken(mockRequest()))!;
      expect(await auth.onClientConnect(1, t1)).not.toBeInstanceOf(Error);
      expect(await auth.onClientConnect(2, t2)).not.toBeInstanceOf(Error);
    });

    it("rejects connection when at maxConnections", async () => {
      const t1 = (await auth.generateAuthorizedSessionToken(mockRequest()))!;
      const t2 = (await auth.generateAuthorizedSessionToken(mockRequest()))!;
      const t3 = (await auth.generateAuthorizedSessionToken(mockRequest()))!;
      await auth.onClientConnect(1, t1);
      await auth.onClientConnect(2, t2);
      const result = await auth.onClientConnect(3, t3);
      expect(result).toBeInstanceOf(Error);
      expect((result as Error).message).toMatch(/Connection limit reached/);
    });

    it("allows new connection after disconnect frees a slot", async () => {
      const t1 = (await auth.generateAuthorizedSessionToken(mockRequest()))!;
      const t2 = (await auth.generateAuthorizedSessionToken(mockRequest()))!;
      const t3 = (await auth.generateAuthorizedSessionToken(mockRequest()))!;
      await auth.onClientConnect(1, t1);
      await auth.onClientConnect(2, t2);
      auth.onClientDisconnect(1);
      const result = await auth.onClientConnect(3, t3);
      expect(result).not.toBeInstanceOf(Error);
    });
  });

  describe("session TTL", () => {
    let auth: BasicUserAuthenticator;

    beforeEach(() => {
      jest.useFakeTimers();
      auth = new BasicUserAuthenticator({
        defaultCharacterDescriptions,
        allowAnonymous: true,
      });
    });

    afterEach(() => {
      auth.dispose();
      jest.useRealTimers();
    });

    it("expires session after TTL", async () => {
      const token = (await auth.generateAuthorizedSessionToken(mockRequest()))!;

      // Advance past the 1-hour TTL
      jest.advanceTimersByTime(60 * 60 * 1000 + 1);

      const result = await auth.onClientConnect(1, token);
      expect(result).toBeInstanceOf(Error);
      expect((result as Error).message).toMatch(/Unknown or expired/);
    });

    it("connected client's session does not expire", async () => {
      const token = (await auth.generateAuthorizedSessionToken(mockRequest()))!;
      await auth.onClientConnect(1, token);

      jest.advanceTimersByTime(60 * 60 * 1000 + 1);

      // Connected sessions are not subject to expiry.
      expect(auth.getClientIdForSessionToken(token)).toEqual({ id: 1 });
    });

    it("disconnected session is immediately removed", async () => {
      const token = (await auth.generateAuthorizedSessionToken(mockRequest()))!;
      await auth.onClientConnect(1, token);
      auth.onClientDisconnect(1);

      // Session is fully removed on disconnect — no grace period
      const result = await auth.onClientConnect(2, token);
      expect(result).toBeInstanceOf(Error);
    });

    it("dispose clears sweep interval and session map", async () => {
      await auth.generateAuthorizedSessionToken(mockRequest());
      await auth.generateAuthorizedSessionToken(mockRequest());

      auth.dispose();

      expect(jest.getTimerCount()).toBe(0);
    });
  });

  describe("sanitizeCharacterDescription", () => {
    let auth: BasicUserAuthenticator;

    beforeEach(() => {
      auth = new BasicUserAuthenticator({
        defaultCharacterDescriptions,
        allowAnonymous: true,
      });
    });

    afterEach(() => {
      auth.dispose();
    });

    it("falls back to default when characterDescription exceeds 8KB", async () => {
      const token = (await auth.generateAuthorizedSessionToken(mockRequest()))!;
      const oversizedDesc = { meshFileUrl: "x".repeat(9000) };
      const result = await auth.onClientConnect(1, token, {
        userId: "user-1",
        username: "test",
        characterDescription: oversizedDesc,
        colors: [],
      });
      expect(result).not.toBeInstanceOf(Error);
      const userData = result as import("@mml-io/3d-web-user-networking").UserData;
      // Should fall back to the default character description, not the oversized one
      expect(userData.characterDescription).toEqual(defaultCharacterDescriptions[0]);
    });
  });

  describe("generateBotSessionToken", () => {
    let auth: BasicUserAuthenticator;

    afterEach(() => {
      auth.dispose();
    });

    it("creates a valid session token that works with onClientConnect", async () => {
      auth = new BasicUserAuthenticator({
        defaultCharacterDescriptions,
        allowAnonymous: false,
      });
      const token = auth.generateBotSessionToken();
      expect(token).toBeTruthy();
      expect(typeof token).toBe("string");

      const result = await auth.onClientConnect(1, token!);
      expect(result).not.toBeInstanceOf(Error);
      const userData = result as import("@mml-io/3d-web-user-networking").UserData;
      expect(userData.username).toBe("User 1");
    });

    it("returns null when session limit is reached", () => {
      auth = new BasicUserAuthenticator({
        defaultCharacterDescriptions,
        allowAnonymous: true,
      });
      // Fill up to MAX_SESSIONS (10_000 — private constant)
      for (let i = 0; i < 10_000; i++) {
        const t = auth.generateBotSessionToken();
        expect(t).not.toBeNull();
      }

      // At capacity — next creation fails
      const token = auth.generateBotSessionToken();
      expect(token).toBeNull();
    });

    it("returns null when session limit is reached and all sessions are connected", async () => {
      auth = new BasicUserAuthenticator({
        defaultCharacterDescriptions,
        allowAnonymous: true,
        // Use a small maxConnections to keep the test fast while still hitting
        // MAX_SESSIONS capacity. We fill 50 sessions and connect them all so
        // there are no disconnected sessions to evict. Eviction only removes
        // disconnected sessions, so a 51st session creation succeeds (evicting
        // from the 50 in the session map), but connecting the 51st fails due
        // to maxConnections.
        maxConnections: 50,
      });

      // Create and connect sessions up to maxConnections
      for (let i = 0; i < 50; i++) {
        const t = auth.generateBotSessionToken()!;
        expect(t).not.toBeNull();
        const result = await auth.onClientConnect(i, t);
        expect(result).not.toBeInstanceOf(Error);
      }

      // All 50 connection slots are full. A new token can be created (session
      // map is well below MAX_SESSIONS), but connecting it is rejected.
      const extraToken = auth.generateBotSessionToken()!;
      expect(extraToken).not.toBeNull();
      const connectResult = await auth.onClientConnect(50, extraToken);
      expect(connectResult).toBeInstanceOf(Error);
      expect((connectResult as Error).message).toMatch(/Connection limit reached/);
    });
  });

  describe("webhook-authenticated session integrity", () => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    it("preserves webhook-assigned userId and username on connect even if client presents different values (connectionId = 0)", async () => {
      jest.spyOn(global, "fetch").mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          userId: "webhook-user-id",
          username: "webhook-alice",
          mmlAuthToken: "jwt-token",
        }),
      } as Response);

      const auth = new BasicUserAuthenticator({
        defaultCharacterDescriptions,
        allowAnonymous: false,
        webhookUrl: "https://example.com/auth",
      });

      const sessionToken = (await auth.generateAuthorizedSessionToken(
        mockRequest({ token: "tok" }),
      ))!;

      // Connect with connectionId = 0 (falsy) and client-provided identity
      const result = await auth.onClientConnect(0, sessionToken, {
        userId: "attacker-id",
        username: "attacker-name",
        characterDescription: defaultCharacterDescriptions[0],
        colors: [],
      });

      expect(result).not.toBeInstanceOf(Error);
      const userData = result as import("@mml-io/3d-web-user-networking").UserData;
      // Webhook-assigned userId must be preserved
      expect(userData.userId).toBe("webhook-user-id");
      // Webhook-assigned username must be preserved
      expect(userData.username).toBe("webhook-alice");

      // Verify getClientIdForSessionToken works with connectionId 0
      expect(auth.getClientIdForSessionToken(sessionToken)).toEqual({ id: 0 });
      auth.dispose();
    });
  });

  describe("webhook username override prevention", () => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    it("prevents username override via onClientUserIdentityUpdate when webhook-authenticated with mmlAuthToken", async () => {
      jest.spyOn(global, "fetch").mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          username: "webhook-alice",
          mmlAuthToken: "jwt-token",
        }),
      } as Response);

      const auth = new BasicUserAuthenticator({
        defaultCharacterDescriptions,
        allowAnonymous: false,
        webhookUrl: "https://example.com/auth",
      });

      const sessionToken = (await auth.generateAuthorizedSessionToken(
        mockRequest({ token: "tok" }),
      ))!;
      await auth.onClientConnect(1, sessionToken);

      const updated = auth.onClientUserIdentityUpdate(1, {
        username: "hacker-override",
        characterDescription: defaultCharacterDescriptions[0],
        colors: [],
      });
      expect(updated).not.toBeInstanceOf(Error);
      const identity = updated as import("@mml-io/3d-web-user-networking").UserIdentityUpdate;
      // Username should remain the webhook-assigned value, not the client's override
      expect(identity.username).toBe("webhook-alice");
      auth.dispose();
    });

    it("prevents username override via onClientUserIdentityUpdate when webhook-authenticated WITHOUT mmlAuthToken", async () => {
      jest.spyOn(global, "fetch").mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          username: "webhook-bob",
        }),
      } as Response);

      const auth = new BasicUserAuthenticator({
        defaultCharacterDescriptions,
        allowAnonymous: false,
        webhookUrl: "https://example.com/auth",
      });

      const sessionToken = (await auth.generateAuthorizedSessionToken(
        mockRequest({ token: "tok" }),
      ))!;

      // No mmlAuthToken on session
      expect(auth.getSessionAuthToken(sessionToken)).toBeNull();

      await auth.onClientConnect(1, sessionToken);

      const updated = auth.onClientUserIdentityUpdate(1, {
        username: "hacker-override",
        characterDescription: defaultCharacterDescriptions[0],
        colors: [],
      });
      expect(updated).not.toBeInstanceOf(Error);
      const identity = updated as import("@mml-io/3d-web-user-networking").UserIdentityUpdate;
      // Username should remain the webhook-assigned value even without mmlAuthToken
      expect(identity.username).toBe("webhook-bob");
      auth.dispose();
    });
  });

  describe("webhook userId override prevention", () => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    it("does not expose userId in identity update response", async () => {
      jest.spyOn(global, "fetch").mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          userId: "webhook-uid-42",
          username: "webhook-alice",
          mmlAuthToken: "jwt-token",
        }),
      } as Response);

      const auth = new BasicUserAuthenticator({
        defaultCharacterDescriptions,
        allowAnonymous: false,
        webhookUrl: "https://example.com/auth",
      });

      const sessionToken = (await auth.generateAuthorizedSessionToken(
        mockRequest({ token: "tok" }),
      ))!;

      // Verify the webhook userId is returned on connect
      const connectResult = await auth.onClientConnect(1, sessionToken);
      expect(connectResult).not.toBeInstanceOf(Error);
      const userData = connectResult as import("@mml-io/3d-web-user-networking").UserData;
      expect(userData.userId).toBe("webhook-uid-42");

      // Call onClientUserIdentityUpdate — the returned UserIdentityUpdate must
      // not contain a userId property (the type contract excludes it)
      const updated = auth.onClientUserIdentityUpdate(1, {
        username: "new-name",
        characterDescription: defaultCharacterDescriptions[0],
        colors: [],
      });
      expect(updated).not.toBeInstanceOf(Error);
      const identity = updated as import("@mml-io/3d-web-user-networking").UserIdentityUpdate;
      expect("userId" in identity).toBe(false);

      // Verify the session is still valid and the original userId was not mutated
      expect(auth.getClientIdForSessionToken(sessionToken)).toEqual({ id: 1 });
      auth.dispose();
    });
  });

  describe("username sanitization in onClientUserIdentityUpdate", () => {
    let auth: BasicUserAuthenticator;

    beforeEach(() => {
      auth = new BasicUserAuthenticator({
        defaultCharacterDescriptions,
        allowAnonymous: true,
      });
    });

    afterEach(() => {
      auth.dispose();
    });

    it("strips control characters from username", async () => {
      const token = (await auth.generateAuthorizedSessionToken(mockRequest()))!;
      await auth.onClientConnect(1, token);

      const updated = auth.onClientUserIdentityUpdate(1, {
        username: "hello\x00world\x1f\x7ftest",
        characterDescription: defaultCharacterDescriptions[0],
        colors: [],
      });
      expect(updated).not.toBeInstanceOf(Error);
      const identity = updated as import("@mml-io/3d-web-user-networking").UserIdentityUpdate;
      expect(identity.username).toBe("helloworldtest");
    });

    it("truncates username to MAX_USERNAME_LENGTH (256)", async () => {
      const token = (await auth.generateAuthorizedSessionToken(mockRequest()))!;
      await auth.onClientConnect(1, token);

      const longUsername = "A".repeat(300);
      const updated = auth.onClientUserIdentityUpdate(1, {
        username: longUsername,
        characterDescription: defaultCharacterDescriptions[0],
        colors: [],
      });
      expect(updated).not.toBeInstanceOf(Error);
      const identity = updated as import("@mml-io/3d-web-user-networking").UserIdentityUpdate;
      expect(identity.username).toBe("A".repeat(256));
    });
  });

  describe("dispose", () => {
    it("clears all sessions and sweep interval", async () => {
      const auth = new BasicUserAuthenticator({
        defaultCharacterDescriptions,
        allowAnonymous: true,
      });
      const token = (await auth.generateAuthorizedSessionToken(mockRequest()))!;
      await auth.onClientConnect(1, token);

      auth.dispose();

      expect(auth.getClientIdForSessionToken(token)).toBeNull();
      const connectResult = await auth.onClientConnect(2, token);
      expect(connectResult).toBeInstanceOf(Error);
    });

    it("subsequent operations return errors/null after dispose", async () => {
      const auth = new BasicUserAuthenticator({
        defaultCharacterDescriptions,
        allowAnonymous: true,
      });
      const token = (await auth.generateAuthorizedSessionToken(mockRequest()))!;

      auth.dispose();

      expect(auth.getSessionAuthToken(token)).toBeNull();
      expect(auth.getClientIdForSessionToken(token)).toBeNull();
    });
  });
});
