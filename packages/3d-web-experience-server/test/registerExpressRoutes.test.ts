import { jest, describe, expect, it, beforeEach, afterEach } from "@jest/globals";
import type { WorldConfigPayload } from "@mml-io/3d-web-experience-protocol";
import type { UserData } from "@mml-io/3d-web-user-networking";

import type { UserAuthenticator } from "../src/Networked3dWebExperienceServer";

// Mock @mml-io/networked-dom-server
jest.unstable_mockModule("@mml-io/networked-dom-server", () => ({
  NetworkedDOM: {
    handleWebsocketSubprotocol: jest.fn<any>().mockReturnValue("networked-dom-v1"),
  },
  EditableNetworkedDOM: jest.fn(),
  LocalObservableDOMFactory: jest.fn(),
}));

// Mock express-ws
const mockWsRoutes = new Map<string, (ws: any, req?: any) => void>();
const mockGetRoutes = new Map<string, (req: any, res: any) => void>();
const mockUseArgs: Array<any[]> = [];

const mockApp = {
  ws: jest.fn<any>().mockImplementation((path: string, handler: any) => {
    mockWsRoutes.set(path, handler);
  }),
  get: jest.fn<any>().mockImplementation((path: string, handler: any) => {
    mockGetRoutes.set(path, handler);
  }),
  use: jest.fn<any>().mockImplementation((...args: any[]) => {
    mockUseArgs.push(args);
  }),
};

jest.unstable_mockModule("express-ws", () => ({
  default: jest.fn<any>().mockImplementation(() => ({
    app: mockApp,
  })),
}));

jest.unstable_mockModule("express", () => ({
  default: {
    static: jest.fn<any>().mockReturnValue("static-middleware"),
  },
}));

jest.unstable_mockModule("cors", () => ({
  default: jest.fn<any>().mockReturnValue("cors-middleware"),
}));

// Mock chokidar for websocketDirectoryChangeListener
jest.unstable_mockModule("chokidar", () => ({
  watch: jest.fn<any>().mockReturnValue({
    on: jest.fn<any>().mockReturnThis(),
    close: jest.fn(),
  }),
}));

const { Networked3dWebExperienceServer } = await import("../src/Networked3dWebExperienceServer");

function createMockAuthenticator(): UserAuthenticator {
  return {
    generateAuthorizedSessionToken: jest.fn<any>().mockResolvedValue("test-token"),
    getClientIdForSessionToken: jest.fn<any>().mockReturnValue({ id: 1 }),
    onClientConnect: jest.fn<any>().mockReturnValue({
      userId: "user-1",
      username: "TestUser",
      characterDescription: null,
      colors: null,
    } as UserData),
    onClientUserIdentityUpdate: jest
      .fn<any>()
      .mockImplementation((_connectionId: number, identity: UserData) => identity),
    onClientDisconnect: jest.fn(),
    dispose: jest.fn(),
  };
}

describe("registerExpressRoutes", () => {
  let server: InstanceType<typeof Networked3dWebExperienceServer>;
  let mockAuth: UserAuthenticator;

  beforeEach(() => {
    jest.clearAllMocks();
    mockWsRoutes.clear();
    mockGetRoutes.clear();
    mockUseArgs.length = 0;

    mockAuth = createMockAuthenticator();
  });

  afterEach(() => {
    server?.dispose();
  });

  it("registers network WebSocket route", () => {
    server = new Networked3dWebExperienceServer({
      networkPath: "/ws",
      userAuthenticator: mockAuth,
    });

    server.registerExpressRoutes({} as any);

    expect(mockWsRoutes.has("/ws")).toBe(true);
  });

  describe("webClientServing", () => {
    it("registers index route and static serving", () => {
      server = new Networked3dWebExperienceServer({
        networkPath: "/ws",
        userAuthenticator: mockAuth,
        webClientServing: {
          indexUrl: "/",
          indexContent: '<script>token="SESSION.TOKEN.PLACEHOLDER"</script>',
          clientBuildDir: "/build",
          clientUrl: "/client/",
        },
      });

      server.registerExpressRoutes({} as any);

      expect(mockGetRoutes.has("/")).toBe(true);
    });

    it("index route returns HTML with escaped token", async () => {
      server = new Networked3dWebExperienceServer({
        networkPath: "/ws",
        userAuthenticator: mockAuth,
        webClientServing: {
          indexUrl: "/",
          indexContent: '<script>token="SESSION.TOKEN.PLACEHOLDER"</script>',
          clientBuildDir: "/build",
          clientUrl: "/client/",
        },
      });

      server.registerExpressRoutes({} as any);

      const handler = mockGetRoutes.get("/")!;
      const mockReq = {};
      const mockRes = { send: jest.fn(), redirect: jest.fn() };

      await handler(mockReq, mockRes);

      expect(mockRes.send).toHaveBeenCalledWith('<script>token="test-token"</script>');
    });

    it("index route escapes JS string special characters in token", async () => {
      (mockAuth.generateAuthorizedSessionToken as jest.Mock<any>).mockResolvedValue(
        '<script>alert("xss")</script>',
      );

      server = new Networked3dWebExperienceServer({
        networkPath: "/ws",
        userAuthenticator: mockAuth,
        webClientServing: {
          indexUrl: "/",
          indexContent: "TOKEN:SESSION.TOKEN.PLACEHOLDER",
          clientBuildDir: "/build",
          clientUrl: "/client/",
        },
      });

      server.registerExpressRoutes({} as any);

      const handler = mockGetRoutes.get("/")!;
      const mockRes = { send: jest.fn(), redirect: jest.fn() };

      await handler({}, mockRes);

      const sent = mockRes.send.mock.calls[0][0] as string;
      // </script> should be escaped to prevent breaking out of script blocks
      expect(sent).not.toContain("</script>");
      // Double quotes should be backslash-escaped for JS string safety
      expect(sent).toContain('\\"');
    });

    it("index route returns error when token is null", async () => {
      (mockAuth.generateAuthorizedSessionToken as jest.Mock<any>).mockResolvedValue(null);

      server = new Networked3dWebExperienceServer({
        networkPath: "/ws",
        userAuthenticator: mockAuth,
        webClientServing: {
          indexUrl: "/",
          indexContent: "content",
          clientBuildDir: "/build",
          clientUrl: "/client/",
        },
      });

      server.registerExpressRoutes({} as any);

      const handler = mockGetRoutes.get("/")!;
      const mockRes = { send: jest.fn(), redirect: jest.fn() };

      await handler({}, mockRes);

      expect(mockRes.send).toHaveBeenCalledWith("Error: Could not generate token");
    });

    it("index route redirects when token is redirect object", async () => {
      (mockAuth.generateAuthorizedSessionToken as jest.Mock<any>).mockResolvedValue({
        redirect: "https://example.com/login",
      });

      server = new Networked3dWebExperienceServer({
        networkPath: "/ws",
        userAuthenticator: mockAuth,
        webClientServing: {
          indexUrl: "/",
          indexContent: "content",
          clientBuildDir: "/build",
          clientUrl: "/client/",
        },
      });

      server.registerExpressRoutes({} as any);

      const handler = mockGetRoutes.get("/")!;
      const mockRes = { send: jest.fn(), redirect: jest.fn() };

      await handler({}, mockRes);

      expect(mockRes.redirect).toHaveBeenCalledWith("https://example.com/login");
    });

    it("index route rejects redirect with non-http protocol", async () => {
      const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

      (mockAuth.generateAuthorizedSessionToken as jest.Mock<any>).mockResolvedValue({
        redirect: "javascript:alert(1)",
      });

      server = new Networked3dWebExperienceServer({
        networkPath: "/ws",
        userAuthenticator: mockAuth,
        webClientServing: {
          indexUrl: "/",
          indexContent: "content",
          clientBuildDir: "/build",
          clientUrl: "/client/",
        },
      });

      server.registerExpressRoutes({} as any);

      const handler = mockGetRoutes.get("/")!;
      const mockRes = { send: jest.fn(), redirect: jest.fn() };

      await handler({}, mockRes);

      expect(mockRes.send).toHaveBeenCalledWith("Error: Invalid redirect URL");
      expect(mockRes.redirect).not.toHaveBeenCalled();
      errorSpy.mockRestore();
    });

    it("index route rejects malformed redirect URL", async () => {
      const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

      (mockAuth.generateAuthorizedSessionToken as jest.Mock<any>).mockResolvedValue({
        redirect: "not-a-valid-url",
      });

      server = new Networked3dWebExperienceServer({
        networkPath: "/ws",
        userAuthenticator: mockAuth,
        webClientServing: {
          indexUrl: "/",
          indexContent: "content",
          clientBuildDir: "/build",
          clientUrl: "/client/",
        },
      });

      server.registerExpressRoutes({} as any);

      const handler = mockGetRoutes.get("/")!;
      const mockRes = { send: jest.fn(), redirect: jest.fn() };

      await handler({}, mockRes);

      expect(mockRes.send).toHaveBeenCalledWith("Error: Invalid redirect URL");
      errorSpy.mockRestore();
    });

    it("registers client watch websocket when path provided", () => {
      server = new Networked3dWebExperienceServer({
        networkPath: "/ws",
        userAuthenticator: mockAuth,
        webClientServing: {
          indexUrl: "/",
          indexContent: "content",
          clientBuildDir: "/build",
          clientUrl: "/client/",
          clientWatchWebsocketPath: "/ws-watch",
        },
      });

      server.registerExpressRoutes({} as any);

      expect(mockWsRoutes.has("/ws-watch")).toBe(true);
    });

    it("uses custom sessionTokenPlaceholder", async () => {
      server = new Networked3dWebExperienceServer({
        networkPath: "/ws",
        userAuthenticator: mockAuth,
        webClientServing: {
          indexUrl: "/",
          indexContent: "CUSTOM_PLACEHOLDER_HERE",
          sessionTokenPlaceholder: "CUSTOM_PLACEHOLDER_HERE",
          clientBuildDir: "/build",
          clientUrl: "/client/",
        },
      });

      server.registerExpressRoutes({} as any);

      const handler = mockGetRoutes.get("/")!;
      const mockRes = { send: jest.fn(), redirect: jest.fn() };

      await handler({}, mockRes);

      expect(mockRes.send).toHaveBeenCalledWith("test-token");
    });
  });

  describe("mmlServing", () => {
    it("registers MML document websocket routes", () => {
      server = new Networked3dWebExperienceServer({
        networkPath: "/ws",
        userAuthenticator: mockAuth,
        mmlServing: {
          documentsWatchPath: "**/*.html",
          documentsDirectoryRoot: "/tmp/test-docs",
          documentsUrl: "/mml/",
        },
      });

      server.registerExpressRoutes({} as any);

      expect(mockWsRoutes.has("/mml/*")).toBe(true);
    });
  });

  describe("assetServing", () => {
    it("registers asset serving with CORS", () => {
      server = new Networked3dWebExperienceServer({
        networkPath: "/ws",
        userAuthenticator: mockAuth,
        assetServing: {
          assetsDir: "/assets",
          assetsUrl: "/static/",
        },
      });

      server.registerExpressRoutes({} as any);

      // Should have called app.use with the assets URL path
      const assetCall = mockUseArgs.find((args) => args[0] === "/static/");
      expect(assetCall).toBeDefined();
    });
  });
});
