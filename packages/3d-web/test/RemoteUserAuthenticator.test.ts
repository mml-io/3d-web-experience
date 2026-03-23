import http from "http";

import { RemoteUserAuthenticator } from "../src/RemoteUserAuthenticator";

const defaultCharacterDescription = { meshFileUrl: "/avatars/avatar-1-bodyA-skin01.glb" };

type MockHandler = (
  req: http.IncomingMessage,
  body: string,
) => { status: number; body: Record<string, unknown> };

function createMockAuthServer(handler: MockHandler): Promise<{
  server: http.Server;
  url: string;
}> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (chunk: Buffer) => {
        body += chunk.toString();
      });
      req.on("end", () => {
        const result = handler(req, body);
        res.writeHead(result.status, { "content-type": "application/json" });
        res.end(JSON.stringify(result.body));
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      resolve({ server, url: `http://127.0.0.1:${addr.port}` });
    });
  });
}

function mockRequest(
  query: Record<string, string> = {},
  headers: Record<string, string> = {},
): import("express").Request {
  return {
    query,
    headers,
    protocol: "http",
    get(name: string) {
      if (name === "host") return "localhost:8080";
      return undefined;
    },
  } as unknown as import("express").Request;
}

describe("RemoteUserAuthenticator", () => {
  let mockServer: http.Server | null = null;

  afterEach((done) => {
    if (mockServer) {
      mockServer.close(() => done());
      mockServer = null;
    } else {
      done();
    }
  });

  describe("generateAuthorizedSessionToken", () => {
    it("returns sessionToken on success", async () => {
      const { server, url } = await createMockAuthServer((req) => {
        if (req.url === "/session" && req.method === "POST") {
          return { status: 200, body: { sessionToken: "tok-abc" } };
        }
        return { status: 404, body: {} };
      });
      mockServer = server;

      const auth = new RemoteUserAuthenticator({
        serverUrl: url,
        defaultCharacterDescription,
      });

      const result = await auth.generateAuthorizedSessionToken(mockRequest());
      expect(result).toBe("tok-abc");
      auth.dispose();
    });

    it("returns redirect object when auth server sends redirect", async () => {
      const { server, url } = await createMockAuthServer((req) => {
        if (req.url === "/session" && req.method === "POST") {
          return { status: 200, body: { redirect: "https://login.example.com/auth" } };
        }
        return { status: 404, body: {} };
      });
      mockServer = server;

      const auth = new RemoteUserAuthenticator({
        serverUrl: url,
        defaultCharacterDescription,
      });

      const result = await auth.generateAuthorizedSessionToken(mockRequest());
      expect(result).toEqual({ redirect: "https://login.example.com/auth" });
      auth.dispose();
    });

    it("returns null when auth server rejects (non-200)", async () => {
      const { server, url } = await createMockAuthServer(() => {
        return { status: 403, body: { message: "Forbidden" } };
      });
      mockServer = server;

      const auth = new RemoteUserAuthenticator({
        serverUrl: url,
        defaultCharacterDescription,
      });

      const result = await auth.generateAuthorizedSessionToken(mockRequest());
      expect(result).toBeNull();
      auth.dispose();
    });

    it("forwards cookies, query, and origin to the auth server", async () => {
      let receivedHeaders: http.IncomingHttpHeaders = {};
      let receivedBody: Record<string, unknown> = {};

      const { server, url } = await createMockAuthServer((req, body) => {
        receivedHeaders = req.headers;
        receivedBody = JSON.parse(body);
        return { status: 200, body: { sessionToken: "tok-xyz" } };
      });
      mockServer = server;

      const auth = new RemoteUserAuthenticator({
        serverUrl: url,
        defaultCharacterDescription,
      });

      await auth.generateAuthorizedSessionToken(
        mockRequest({ token: "ext-tok" }, { cookie: "session=abc123" }),
      );

      expect(receivedHeaders.cookie).toBe("session=abc123");
      expect(receivedBody.query).toEqual({ token: "ext-tok" });
      expect(receivedBody.origin).toBe("http://localhost:8080/");
      auth.dispose();
    });

    it("returns null when Host header is missing", async () => {
      const { server, url } = await createMockAuthServer(() => {
        return { status: 200, body: { sessionToken: "tok-abc" } };
      });
      mockServer = server;

      const auth = new RemoteUserAuthenticator({
        serverUrl: url,
        defaultCharacterDescription,
      });

      const req = {
        query: {},
        headers: {},
        protocol: "http",
        get() {
          return undefined;
        },
      } as unknown as import("express").Request;

      const result = await auth.generateAuthorizedSessionToken(req);
      expect(result).toBeNull();
      auth.dispose();
    });

    it("returns null when Host header contains invalid characters", async () => {
      const { server, url } = await createMockAuthServer(() => {
        return { status: 200, body: { sessionToken: "tok-abc" } };
      });
      mockServer = server;

      const auth = new RemoteUserAuthenticator({
        serverUrl: url,
        defaultCharacterDescription,
      });

      const req = {
        query: {},
        headers: {},
        protocol: "http",
        get(name: string) {
          if (name === "host") return "evil.com/<script>";
          return undefined;
        },
      } as unknown as import("express").Request;

      const result = await auth.generateAuthorizedSessionToken(req);
      expect(result).toBeNull();
      auth.dispose();
    });

    it("returns null when auth server is unreachable", async () => {
      const auth = new RemoteUserAuthenticator({
        serverUrl: "http://127.0.0.1:1",
        defaultCharacterDescription,
      });

      const result = await auth.generateAuthorizedSessionToken(mockRequest());
      expect(result).toBeNull();
      auth.dispose();
    });

    it("rejects redirect URLs with non-http/https protocols (e.g. javascript:)", async () => {
      const { server, url } = await createMockAuthServer((req) => {
        if (req.url === "/session" && req.method === "POST") {
          return { status: 200, body: { redirect: "javascript:alert(1)" } };
        }
        return { status: 404, body: {} };
      });
      mockServer = server;

      const auth = new RemoteUserAuthenticator({
        serverUrl: url,
        defaultCharacterDescription,
      });

      const result = await auth.generateAuthorizedSessionToken(mockRequest());
      expect(result).toBeNull();
      auth.dispose();
    });

    it("rejects redirect URLs with data: protocol", async () => {
      const { server, url } = await createMockAuthServer((req) => {
        if (req.url === "/session" && req.method === "POST") {
          return { status: 200, body: { redirect: "data:text/html,<h1>evil</h1>" } };
        }
        return { status: 404, body: {} };
      });
      mockServer = server;

      const auth = new RemoteUserAuthenticator({
        serverUrl: url,
        defaultCharacterDescription,
      });

      const result = await auth.generateAuthorizedSessionToken(mockRequest());
      expect(result).toBeNull();
      auth.dispose();
    });

    it("rejects session tokens with unsafe characters", async () => {
      const { server, url } = await createMockAuthServer((req) => {
        if (req.url === "/session" && req.method === "POST") {
          return {
            status: 200,
            body: { sessionToken: '";}</script><script>alert(1)</script>' },
          };
        }
        return { status: 404, body: {} };
      });
      mockServer = server;

      const auth = new RemoteUserAuthenticator({
        serverUrl: url,
        defaultCharacterDescription,
      });

      const result = await auth.generateAuthorizedSessionToken(mockRequest());
      expect(result).toBeNull();
      auth.dispose();
    });

    it("returns null when auth server returns invalid JSON", async () => {
      const server = await new Promise<{ server: http.Server; url: string }>((resolve) => {
        const srv = http.createServer((req, res) => {
          res.writeHead(200, { "content-type": "application/json" });
          res.end("not valid json{{{");
        });
        srv.listen(0, "127.0.0.1", () => {
          const addr = srv.address() as { port: number };
          resolve({ server: srv, url: `http://127.0.0.1:${addr.port}` });
        });
      });
      mockServer = server.server;

      const auth = new RemoteUserAuthenticator({
        serverUrl: server.url,
        defaultCharacterDescription,
      });

      const result = await auth.generateAuthorizedSessionToken(mockRequest());
      expect(result).toBeNull();
      auth.dispose();
    });
  });

  describe("onClientConnect", () => {
    it("succeeds and returns userData from auth server", async () => {
      const { server, url } = await createMockAuthServer((req) => {
        if (req.url === "/session/connect" && req.method === "POST") {
          return {
            status: 200,
            body: {
              userData: {
                userId: "alice-id",
                username: "alice",
                characterDescription: { meshFileUrl: "/alice.glb" },
                colors: [],
              },
            },
          };
        }
        return { status: 200, body: { sessionToken: "tok-1" } };
      });
      mockServer = server;

      const auth = new RemoteUserAuthenticator({
        serverUrl: url,
        defaultCharacterDescription,
      });

      const result = await auth.onClientConnect(1, "tok-1");
      expect(result).not.toBeInstanceOf(Error);
      expect((result as import("@mml-io/3d-web-user-networking").UserData).username).toBe("alice");
      auth.dispose();
    });

    it("returns default userData when auth server omits it", async () => {
      const { server, url } = await createMockAuthServer((req) => {
        if (req.url === "/session/connect" && req.method === "POST") {
          return { status: 200, body: {} };
        }
        return { status: 200, body: { sessionToken: "tok-1" } };
      });
      mockServer = server;

      const auth = new RemoteUserAuthenticator({
        serverUrl: url,
        defaultCharacterDescription,
      });

      const result = await auth.onClientConnect(5, "tok-1");
      expect(result).not.toBeInstanceOf(Error);
      const userData = result as import("@mml-io/3d-web-user-networking").UserData;
      expect(userData.username).toBe("User 5");
      expect(userData.characterDescription).toEqual(defaultCharacterDescription);
      auth.dispose();
    });

    it("uses presented username when auth server omits userData", async () => {
      const { server, url } = await createMockAuthServer((req) => {
        if (req.url === "/session/connect" && req.method === "POST") {
          return { status: 200, body: {} };
        }
        return { status: 200, body: { sessionToken: "tok-1" } };
      });
      mockServer = server;

      const auth = new RemoteUserAuthenticator({
        serverUrl: url,
        defaultCharacterDescription,
      });

      const result = await auth.onClientConnect(1, "tok-1", {
        userId: "",
        username: "BridgeBot",
        characterDescription: null,
        colors: [],
      });
      expect(result).not.toBeInstanceOf(Error);
      const userData = result as import("@mml-io/3d-web-user-networking").UserData;
      expect(userData.username).toBe("BridgeBot");
      auth.dispose();
    });

    it("sanitizes presented username when auth server omits userData", async () => {
      const { server, url } = await createMockAuthServer((req) => {
        if (req.url === "/session/connect" && req.method === "POST") {
          return { status: 200, body: {} };
        }
        return { status: 200, body: { sessionToken: "tok-1" } };
      });
      mockServer = server;

      const auth = new RemoteUserAuthenticator({
        serverUrl: url,
        defaultCharacterDescription,
      });

      const result = await auth.onClientConnect(1, "tok-1", {
        userId: "",
        username: "Bot\x00Name\x1f\x7f",
        characterDescription: null,
        colors: [],
      });
      expect(result).not.toBeInstanceOf(Error);
      const userData = result as import("@mml-io/3d-web-user-networking").UserData;
      expect(userData.username).toBe("BotName");
      auth.dispose();
    });

    it("returns Error when auth server rejects connection", async () => {
      const { server, url } = await createMockAuthServer((req) => {
        if (req.url === "/session/connect") {
          return { status: 403, body: { message: "Session expired" } };
        }
        return { status: 200, body: { sessionToken: "tok-1" } };
      });
      mockServer = server;

      const auth = new RemoteUserAuthenticator({
        serverUrl: url,
        defaultCharacterDescription,
      });

      const result = await auth.onClientConnect(1, "tok-bad");
      expect(result).toBeInstanceOf(Error);
      expect((result as Error).message).toBe("Session expired");
      auth.dispose();
    });

    it("tracks connectionId after successful connect", async () => {
      const { server, url } = await createMockAuthServer((req) => {
        if (req.url === "/session/connect") {
          return { status: 200, body: {} };
        }
        return { status: 200, body: { sessionToken: "tok-1" } };
      });
      mockServer = server;

      const auth = new RemoteUserAuthenticator({
        serverUrl: url,
        defaultCharacterDescription,
      });

      await auth.onClientConnect(7, "tok-1");
      expect(auth.getClientIdForSessionToken("tok-1")).toEqual({ id: 7 });
      auth.dispose();
    });

    it("returns Error when auth server is unreachable", async () => {
      const auth = new RemoteUserAuthenticator({
        serverUrl: "http://127.0.0.1:1",
        defaultCharacterDescription,
      });

      const result = await auth.onClientConnect(1, "tok-1");
      expect(result).toBeInstanceOf(Error);
      expect((result as Error).message).toMatch(/Auth server unreachable/);
      auth.dispose();
    });

    it("rejects duplicate session token on second connect", async () => {
      const { server, url } = await createMockAuthServer((req) => {
        if (req.url === "/session/connect") {
          return { status: 200, body: {} };
        }
        return { status: 200, body: { sessionToken: "tok-1" } };
      });
      mockServer = server;

      const auth = new RemoteUserAuthenticator({
        serverUrl: url,
        defaultCharacterDescription,
      });

      const first = await auth.onClientConnect(1, "tok-dup");
      expect(first).not.toBeInstanceOf(Error);

      const second = await auth.onClientConnect(2, "tok-dup");
      expect(second).toBeInstanceOf(Error);
      expect((second as Error).message).toBe("Session token already connected");
      auth.dispose();
    });

    it("returns Error when auth server returns invalid JSON on connect", async () => {
      const server = await new Promise<{ server: http.Server; url: string }>((resolve) => {
        const srv = http.createServer((req, res) => {
          if (req.url === "/session/connect") {
            res.writeHead(200, { "content-type": "application/json" });
            res.end("not json");
            return;
          }
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ sessionToken: "tok-1" }));
        });
        srv.listen(0, "127.0.0.1", () => {
          const addr = srv.address() as { port: number };
          resolve({ server: srv, url: `http://127.0.0.1:${addr.port}` });
        });
      });
      mockServer = server.server;

      const auth = new RemoteUserAuthenticator({
        serverUrl: server.url,
        defaultCharacterDescription,
      });

      const result = await auth.onClientConnect(1, "tok-1");
      expect(result).toBeInstanceOf(Error);
      expect((result as Error).message).toMatch(/invalid JSON/i);
      auth.dispose();
    });

    it("replaces oversized characterDescription from auth server with default", async () => {
      const oversizedUrl = "x".repeat(9000);
      const { server, url } = await createMockAuthServer((req) => {
        if (req.url === "/session/connect" && req.method === "POST") {
          return {
            status: 200,
            body: {
              userData: {
                userId: "big-avatar-id",
                username: "bigavatar",
                characterDescription: { meshFileUrl: oversizedUrl },
                colors: [],
              },
            },
          };
        }
        return { status: 200, body: { sessionToken: "tok-1" } };
      });
      mockServer = server;

      const auth = new RemoteUserAuthenticator({
        serverUrl: url,
        defaultCharacterDescription,
      });

      const result = await auth.onClientConnect(1, "tok-big");
      expect(result).not.toBeInstanceOf(Error);
      const userData = result as import("@mml-io/3d-web-user-networking").UserData;
      expect(userData.characterDescription).toEqual(defaultCharacterDescription);
      auth.dispose();
    });

    it("works correctly with connectionId 0", async () => {
      const { server, url } = await createMockAuthServer((req) => {
        if (req.url === "/session/connect" && req.method === "POST") {
          return { status: 200, body: {} };
        }
        return { status: 200, body: { sessionToken: "tok-zero" } };
      });
      mockServer = server;

      const auth = new RemoteUserAuthenticator({
        serverUrl: url,
        defaultCharacterDescription,
      });

      const result = await auth.onClientConnect(0, "tok-zero");
      expect(result).not.toBeInstanceOf(Error);
      expect(auth.getClientIdForSessionToken("tok-zero")).toEqual({ id: 0 });
      auth.dispose();
    });

    it("rejects concurrent connections with the same session token (TOCTOU)", async () => {
      let resolveFirst!: () => void;
      const firstCallBarrier = new Promise<void>((resolve) => {
        resolveFirst = resolve;
      });

      const server = await new Promise<{ server: http.Server; url: string }>((resolve) => {
        let callCount = 0;
        const srv = http.createServer((req, res) => {
          let body = "";
          req.on("data", (chunk: Buffer) => {
            body += chunk.toString();
          });
          req.on("end", () => {
            if (req.url === "/session/connect") {
              callCount++;
              if (callCount === 1) {
                // First call: delay the response until the barrier resolves
                firstCallBarrier.then(() => {
                  res.writeHead(200, { "content-type": "application/json" });
                  res.end(JSON.stringify({}));
                });
                return;
              }
              // Subsequent calls respond immediately
              res.writeHead(200, { "content-type": "application/json" });
              res.end(JSON.stringify({}));
              return;
            }
            res.writeHead(200, { "content-type": "application/json" });
            res.end(JSON.stringify({}));
          });
        });
        srv.listen(0, "127.0.0.1", () => {
          const addr = srv.address() as { port: number };
          resolve({ server: srv, url: `http://127.0.0.1:${addr.port}` });
        });
      });
      mockServer = server.server;

      const auth = new RemoteUserAuthenticator({
        serverUrl: server.url,
        defaultCharacterDescription,
      });

      const token = "tok-race";
      const promise1 = auth.onClientConnect(1, token);
      const promise2 = auth.onClientConnect(2, token);

      // Second call should fail immediately because the token is in-flight
      const result2 = await promise2;
      expect(result2).toBeInstanceOf(Error);
      expect((result2 as Error).message).toContain("Session token already");

      // Now let the first call complete
      resolveFirst();
      const result1 = await promise1;
      expect(result1).not.toBeInstanceOf(Error);
      auth.dispose();
    });

    it("returns Error when maxConnections is reached", async () => {
      const { server, url } = await createMockAuthServer((req) => {
        if (req.url === "/session/connect") {
          return { status: 200, body: {} };
        }
        return { status: 200, body: { sessionToken: "tok-1" } };
      });
      mockServer = server;

      const auth = new RemoteUserAuthenticator({
        serverUrl: url,
        defaultCharacterDescription,
        maxConnections: 2,
      });

      const r1 = await auth.onClientConnect(1, "tok-1");
      expect(r1).not.toBeInstanceOf(Error);

      const r2 = await auth.onClientConnect(2, "tok-2");
      expect(r2).not.toBeInstanceOf(Error);

      // Third connection should be rejected
      const r3 = await auth.onClientConnect(3, "tok-3");
      expect(r3).toBeInstanceOf(Error);
      expect((r3 as Error).message).toMatch(/Connection limit reached/);
      auth.dispose();
    });

    it("uses userIdentityPresentedOnConnection when auth server returns no userData", async () => {
      const { server, url } = await createMockAuthServer((req) => {
        if (req.url === "/session/connect" && req.method === "POST") {
          return { status: 200, body: {} };
        }
        return { status: 200, body: { sessionToken: "tok-1" } };
      });
      mockServer = server;

      const auth = new RemoteUserAuthenticator({
        serverUrl: url,
        defaultCharacterDescription,
      });

      const clientIdentity: import("@mml-io/3d-web-user-networking").UserData = {
        userId: "client-uid",
        username: "ClientUser",
        characterDescription: {
          meshFileUrl: "/client-avatar.glb",
        },
        colors: [[1, 0, 0]] as Array<[number, number, number]>,
      };

      const result = await auth.onClientConnect(1, "tok-1", clientIdentity);
      expect(result).not.toBeInstanceOf(Error);
      const userData = result as import("@mml-io/3d-web-user-networking").UserData;
      // Username, character description, and colors come from userIdentityPresentedOnConnection
      expect(userData.username).toBe("ClientUser");
      expect(userData.characterDescription).toEqual({ meshFileUrl: "/client-avatar.glb" });
      expect(userData.colors).toEqual([[1, 0, 0]]);
      auth.dispose();
    });

    it("returns Error and does not leak maps when auth server returns malformed userData", async () => {
      const { server, url } = await createMockAuthServer((req) => {
        if (req.url === "/session/connect") {
          return {
            status: 200,
            body: { userData: { username: 123 } },
          };
        }
        return { status: 200, body: { sessionToken: "tok-1" } };
      });
      mockServer = server;

      const auth = new RemoteUserAuthenticator({
        serverUrl: url,
        defaultCharacterDescription,
      });

      const result = await auth.onClientConnect(1, "tok-bad-ud");
      expect(result).toBeInstanceOf(Error);
      expect((result as Error).message).toMatch(/invalid userData/);

      // Maps must not contain entries for the failed connection
      expect(auth.getClientIdForSessionToken("tok-bad-ud")).toBeNull();
      auth.dispose();
    });
  });

  describe("getClientIdForSessionToken", () => {
    it("returns null for unknown session token", () => {
      const auth = new RemoteUserAuthenticator({
        serverUrl: "http://localhost:1",
        defaultCharacterDescription,
      });

      expect(auth.getClientIdForSessionToken("unknown")).toBeNull();
      auth.dispose();
    });
  });

  describe("onClientUserIdentityUpdate", () => {
    it("accepts identity update and notifies auth server", async () => {
      let updateReceived = false;

      const { server, url } = await createMockAuthServer((req) => {
        if (req.url === "/session/update" && req.method === "POST") {
          updateReceived = true;
          return { status: 200, body: {} };
        }
        if (req.url === "/session/connect") {
          return { status: 200, body: {} };
        }
        return { status: 200, body: { sessionToken: "tok-1" } };
      });
      mockServer = server;

      const auth = new RemoteUserAuthenticator({
        serverUrl: url,
        defaultCharacterDescription,
      });

      await auth.onClientConnect(1, "tok-1");

      const newIdentity = {
        username: "NewName",
        characterDescription: {
          meshFileUrl: "/new.glb",
        } as import("@mml-io/3d-web-user-networking").CharacterDescription,
        colors: [] as Array<[number, number, number]>,
      };
      const result = await auth.onClientUserIdentityUpdate(1, newIdentity);
      expect(result).not.toBeInstanceOf(Error);
      expect(result).toEqual(newIdentity);
      expect(updateReceived).toBe(true);
      auth.dispose();
    });

    it("applies server-overridden userData from auth server", async () => {
      const { server, url } = await createMockAuthServer((req) => {
        if (req.url === "/session/update" && req.method === "POST") {
          return {
            status: 200,
            body: {
              userData: {
                username: "server-enforced-name",
                characterDescription: { meshFileUrl: "/server-avatar.glb" },
                colors: [[1, 0, 0]] as Array<[number, number, number]>,
              },
            },
          };
        }
        if (req.url === "/session/connect") {
          return { status: 200, body: {} };
        }
        return { status: 200, body: { sessionToken: "tok-1" } };
      });
      mockServer = server;

      const auth = new RemoteUserAuthenticator({
        serverUrl: url,
        defaultCharacterDescription,
      });

      await auth.onClientConnect(1, "tok-1");

      const result = await auth.onClientUserIdentityUpdate(1, {
        username: "client-requested-name",
        characterDescription:
          defaultCharacterDescription as import("@mml-io/3d-web-user-networking").CharacterDescription,
        colors: [] as Array<[number, number, number]>,
      });
      expect(result).not.toBeInstanceOf(Error);
      expect(result).not.toBe(false);
      const update = result as import("@mml-io/3d-web-user-networking").UserIdentityUpdate;
      // The server's overridden values should be used, not the client's
      expect(update.username).toBe("server-enforced-name");
      expect(update.characterDescription).toEqual({ meshFileUrl: "/server-avatar.glb" });
      auth.dispose();
    });

    it("falls back to defaultCharacterDescription when server returns userData without characterDescription", async () => {
      const { server, url } = await createMockAuthServer((req) => {
        if (req.url === "/session/update" && req.method === "POST") {
          return {
            status: 200,
            body: {
              userData: {
                username: "server-name",
                // no characterDescription field
                colors: [[0, 1, 0]] as Array<[number, number, number]>,
              },
            },
          };
        }
        if (req.url === "/session/connect") {
          return { status: 200, body: {} };
        }
        return { status: 200, body: { sessionToken: "tok-1" } };
      });
      mockServer = server;

      const auth = new RemoteUserAuthenticator({
        serverUrl: url,
        defaultCharacterDescription,
      });

      await auth.onClientConnect(1, "tok-1");

      const result = await auth.onClientUserIdentityUpdate(1, {
        username: "client-name",
        characterDescription:
          defaultCharacterDescription as import("@mml-io/3d-web-user-networking").CharacterDescription,
        colors: [] as Array<[number, number, number]>,
      });
      expect(result).not.toBeInstanceOf(Error);
      const update = result as import("@mml-io/3d-web-user-networking").UserIdentityUpdate;
      expect(update.username).toBe("server-name");
      expect(update.characterDescription).toEqual(defaultCharacterDescription);
      auth.dispose();
    });

    it("returns existing user data when auth server is unreachable", async () => {
      const { server, url } = await createMockAuthServer((req) => {
        if (req.url === "/session/connect") {
          return { status: 200, body: {} };
        }
        return { status: 200, body: { sessionToken: "tok-1" } };
      });
      mockServer = server;

      const auth = new RemoteUserAuthenticator({
        serverUrl: url,
        defaultCharacterDescription,
      });

      await auth.onClientConnect(1, "tok-1");

      // Shut down the server so the update call fails
      await new Promise<void>((resolve) => server.close(() => resolve()));
      mockServer = null;

      const result = await auth.onClientUserIdentityUpdate(1, {
        username: "NewName",
        characterDescription:
          defaultCharacterDescription as import("@mml-io/3d-web-user-networking").CharacterDescription,
        colors: [] as Array<[number, number, number]>,
      });
      expect(result).not.toBeInstanceOf(Error);
      const update = result as import("@mml-io/3d-web-user-networking").UserIdentityUpdate;
      // Should return existing data (User 1 / default character) since the server is unreachable
      expect(update.username).toBe("User 1");
      expect(update.characterDescription).toEqual(defaultCharacterDescription);
      auth.dispose();
    });

    it("returns existing user data when auth server responds with non-200", async () => {
      let firstUpdate = true;
      const { server, url } = await createMockAuthServer((req) => {
        if (req.url === "/session/update" && req.method === "POST") {
          if (firstUpdate) {
            firstUpdate = false;
            return { status: 500, body: { message: "Internal Server Error" } };
          }
        }
        if (req.url === "/session/connect") {
          return { status: 200, body: {} };
        }
        return { status: 200, body: { sessionToken: "tok-1" } };
      });
      mockServer = server;

      const auth = new RemoteUserAuthenticator({
        serverUrl: url,
        defaultCharacterDescription,
      });

      await auth.onClientConnect(1, "tok-1");

      const result = await auth.onClientUserIdentityUpdate(1, {
        username: "NewName",
        characterDescription:
          defaultCharacterDescription as import("@mml-io/3d-web-user-networking").CharacterDescription,
        colors: [] as Array<[number, number, number]>,
      });
      expect(result).not.toBeInstanceOf(Error);
      const update = result as import("@mml-io/3d-web-user-networking").UserIdentityUpdate;
      expect(update.username).toBe("User 1");
      expect(update.characterDescription).toEqual(defaultCharacterDescription);
      auth.dispose();
    });

    it("returns existing user data when auth server returns invalid JSON", async () => {
      const srv = await new Promise<{ server: http.Server; url: string }>((resolve) => {
        let connectHandled = false;
        const httpServer = http.createServer((req, res) => {
          let body = "";
          req.on("data", (chunk: Buffer) => {
            body += chunk.toString();
          });
          req.on("end", () => {
            if (req.url === "/session/connect" && !connectHandled) {
              connectHandled = true;
              res.writeHead(200, { "content-type": "application/json" });
              res.end(JSON.stringify({}));
              return;
            }
            if (req.url === "/session/update") {
              res.writeHead(200, { "content-type": "application/json" });
              res.end("not valid json{{{");
              return;
            }
            res.writeHead(200, { "content-type": "application/json" });
            res.end(JSON.stringify({}));
          });
        });
        httpServer.listen(0, "127.0.0.1", () => {
          const addr = httpServer.address() as { port: number };
          resolve({ server: httpServer, url: `http://127.0.0.1:${addr.port}` });
        });
      });
      mockServer = srv.server;

      const auth = new RemoteUserAuthenticator({
        serverUrl: srv.url,
        defaultCharacterDescription,
      });

      await auth.onClientConnect(1, "tok-1");

      const result = await auth.onClientUserIdentityUpdate(1, {
        username: "NewName",
        characterDescription:
          defaultCharacterDescription as import("@mml-io/3d-web-user-networking").CharacterDescription,
        colors: [] as Array<[number, number, number]>,
      });
      expect(result).not.toBeInstanceOf(Error);
      const update = result as import("@mml-io/3d-web-user-networking").UserIdentityUpdate;
      expect(update.username).toBe("User 1");
      expect(update.characterDescription).toEqual(defaultCharacterDescription);
      auth.dispose();
    });

    it("returns Error for unknown connectionId", async () => {
      const auth = new RemoteUserAuthenticator({
        serverUrl: "http://localhost:1",
        defaultCharacterDescription,
      });

      const identity = {
        username: "Ghost",
        characterDescription:
          defaultCharacterDescription as import("@mml-io/3d-web-user-networking").CharacterDescription,
        colors: [] as Array<[number, number, number]>,
      };
      const result = await auth.onClientUserIdentityUpdate(999, identity);
      expect(result).toBeInstanceOf(Error);
      expect((result as Error).message).toBe("Unknown connectionId 999");
      auth.dispose();
    });
  });

  describe("onClientDisconnect", () => {
    it("removes connectionId mapping and notifies auth server with sessionToken", async () => {
      let resolveDisconnect: (body: string) => void;
      const disconnectPromise = new Promise<string>((resolve) => {
        resolveDisconnect = resolve;
      });

      const { server, url } = await createMockAuthServer((req, body) => {
        if (req.url === "/session/disconnect" && req.method === "POST") {
          resolveDisconnect(body);
          return { status: 200, body: {} };
        }
        if (req.url === "/session/connect") {
          return { status: 200, body: {} };
        }
        return { status: 200, body: { sessionToken: "tok-1" } };
      });
      mockServer = server;

      const auth = new RemoteUserAuthenticator({
        serverUrl: url,
        defaultCharacterDescription,
      });

      await auth.onClientConnect(1, "tok-1");
      expect(auth.getClientIdForSessionToken("tok-1")).toEqual({ id: 1 });

      auth.onClientDisconnect(1);
      expect(auth.getClientIdForSessionToken("tok-1")).toBeNull();

      // Wait for fire-and-forget fetch to reach the mock server
      const receivedBody = await Promise.race([
        disconnectPromise,
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error("Disconnect notification not received within 5s")),
            5000,
          ),
        ),
      ]);
      const parsed = JSON.parse(receivedBody);
      expect(parsed.connectionId).toBe(1);
      expect(parsed.sessionToken).toBe("tok-1");
      auth.dispose();
    });
  });

  describe("getSessionAuthToken", () => {
    it("returns auth token from remote server", async () => {
      const { server, url } = await createMockAuthServer((req, body) => {
        if (req.url === "/session/auth-token" && req.method === "POST") {
          const parsed = JSON.parse(body);
          if (parsed.sessionToken === "tok-abc") {
            return { status: 200, body: { authToken: "jwt-secret" } };
          }
        }
        return { status: 404, body: {} };
      });
      mockServer = server;

      const auth = new RemoteUserAuthenticator({
        serverUrl: url,
        defaultCharacterDescription,
      });

      const token = await auth.getSessionAuthToken("tok-abc");
      expect(token).toBe("jwt-secret");
      auth.dispose();
    });

    it("returns null when auth server returns non-200", async () => {
      const { server, url } = await createMockAuthServer(() => {
        return { status: 404, body: {} };
      });
      mockServer = server;

      const auth = new RemoteUserAuthenticator({
        serverUrl: url,
        defaultCharacterDescription,
      });

      const token = await auth.getSessionAuthToken("unknown");
      expect(token).toBeNull();
      auth.dispose();
    });

    it("returns null when auth server is unreachable", async () => {
      const auth = new RemoteUserAuthenticator({
        serverUrl: "http://127.0.0.1:1",
        defaultCharacterDescription,
      });

      const token = await auth.getSessionAuthToken("tok-1");
      expect(token).toBeNull();
      auth.dispose();
    });
  });

  describe("constructor allowInsecureHttp validation", () => {
    it("throws for non-localhost HTTP without allowInsecureHttp", () => {
      expect(
        () =>
          new RemoteUserAuthenticator({
            serverUrl: "http://remote.example.com",
            defaultCharacterDescription,
          }),
      ).toThrow(/uses HTTP for a non-localhost host/);
    });

    it("accepts HTTPS URLs without allowInsecureHttp", () => {
      expect(
        () =>
          new RemoteUserAuthenticator({
            serverUrl: "https://remote.example.com",
            defaultCharacterDescription,
          }),
      ).not.toThrow();
    });

    it("accepts localhost HTTP without allowInsecureHttp", () => {
      expect(
        () =>
          new RemoteUserAuthenticator({
            serverUrl: "http://localhost:9000",
            defaultCharacterDescription,
          }),
      ).not.toThrow();
    });

    it("accepts non-localhost HTTP with allowInsecureHttp: true", () => {
      expect(
        () =>
          new RemoteUserAuthenticator({
            serverUrl: "http://remote.example.com",
            defaultCharacterDescription,
            allowInsecureHttp: true,
          }),
      ).not.toThrow();
    });
  });

  describe("dispose", () => {
    it("clears all session mappings", async () => {
      const { server, url } = await createMockAuthServer((req) => {
        if (req.url === "/session/connect") {
          return { status: 200, body: {} };
        }
        return { status: 200, body: { sessionToken: "tok-1" } };
      });
      mockServer = server;

      const auth = new RemoteUserAuthenticator({
        serverUrl: url,
        defaultCharacterDescription,
      });

      await auth.onClientConnect(1, "tok-1");
      expect(auth.getClientIdForSessionToken("tok-1")).toEqual({ id: 1 });

      auth.dispose();
      expect(auth.getClientIdForSessionToken("tok-1")).toBeNull();
    });
  });
});
