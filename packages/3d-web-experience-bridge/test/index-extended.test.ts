/**
 * Extended tests for index.ts — covers paths not hit by the basic tests:
 * - obtainAuthToken via authUrl (HTTP POST flow)
 * - createBridgeCore with mmlDocument config
 * - createBridgeCore with webhook config
 * - createBridgeCore with spawnConfiguration override
 * - createBridgeCore with world config callback
 * - tool validation error (invalid tool body → 500)
 * - autoStartFromEnv idempotency
 */
import { describe, expect, test, beforeEach, afterEach, vi, beforeAll } from "vitest";

// We need to mock heavy dependencies before importing index.ts

// Create mock instances for WorldConnection
const mockWorldConnectionInstance = {
  waitForConnection: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  waitForWorldConfig: vi.fn<() => Promise<any>>().mockResolvedValue(null),
  isConnected: vi.fn().mockReturnValue(true),
  getConnectionId: vi.fn().mockReturnValue(42),
  getOtherUsers: vi.fn().mockReturnValue([]),
  getChatHistory: vi.fn().mockReturnValue([]),
  sendUpdate: vi.fn(),
  sendChatMessage: vi.fn(),
  sendCustomMessage: vi.fn(),
  updateCharacterDescription: vi.fn(),
  updateUsername: vi.fn(),
  updateColors: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  stop: vi.fn(),
};

vi.mock("@mml-io/3d-web-experience-client", () => ({
  WorldConnection: vi.fn().mockImplementation(function () {
    return mockWorldConnectionInstance;
  }),
}));

if (typeof globalThis.MutationObserver === "undefined") {
  (globalThis as any).MutationObserver = class MutationObserver {
    constructor(_callback: (...args: Array<unknown>) => void) {}
    observe() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  };
}

vi.mock("@mml-io/3d-web-client-core", () => ({
  CollisionsManager: vi.fn().mockImplementation(function () {
    return {
      addMeshesGroup: vi.fn(),
      setCharacterPosition: vi.fn(),
      updateMeshesGroup: vi.fn(),
      removeMeshesGroup: vi.fn(),
    };
  }),
  LocalController: vi.fn().mockImplementation(function () {
    return {
      update: vi.fn(),
      config: {
        position: { x: 0, y: 0, z: 0, set: vi.fn() },
        quaternion: { y: 0, w: 1 },
      },
      characterOnGround: true,
      getTargetAnimation: vi.fn().mockReturnValue(0),
      jump: vi.fn().mockReturnValue(true),
      resetVelocity: vi.fn(),
      jumpForce: 10,
      doubleJumpForce: 8,
      gravity: -9.8,
      verticalVelocity: 0,
      jumpCounter: 0,
      updateSpawnConfig: vi.fn(),
    };
  }),
  Vect3: vi.fn().mockImplementation(function (x: number, y: number, z: number) {
    return {
      x,
      y,
      z,
      set(nx: number, ny: number, nz: number) {
        this.x = nx;
        this.y = ny;
        this.z = nz;
      },
    };
  }),
  Quat: vi.fn().mockImplementation(function (x: number, y: number, z: number, w: number) {
    return { x, y, z, w };
  }),
  Matr4: vi.fn().mockImplementation(function () {
    return { fromArray: vi.fn().mockReturnThis() };
  }),
  getSpawnData: vi.fn().mockReturnValue({
    spawnPosition: { x: 0, y: 0, z: 0 },
    spawnRotation: { x: 0, y: 0, z: 0, w: 1 },
  }),
  normalizeSpawnConfiguration: vi.fn().mockImplementation((config: any) => ({
    spawnPosition: config?.spawnPosition ?? { x: 0, y: 0, z: 0 },
    spawnRotation: config?.spawnRotation ?? { x: 0, y: 0, z: 0, w: 1 },
  })),
  createDefaultCharacterControllerValues: vi.fn().mockReturnValue({}),
  SpawnConfiguration: vi.fn(),
}));

vi.mock("@mml-io/3d-web-experience-protocol", () => ({
  experienceClientSubProtocols: ["v1"],
}));

vi.mock("@mml-io/3d-web-user-networking", () => ({}));

const mockMcpServerInstance = {
  tool: vi.fn(),
  connect: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  close: vi.fn(),
};
vi.mock("@modelcontextprotocol/sdk/server/mcp.js", () => ({
  McpServer: vi.fn().mockImplementation(function () {
    return mockMcpServerInstance;
  }),
}));

const mockTransportInstance = {
  handleRequest: vi
    .fn<(req: any, res: any, body: any) => Promise<void>>()
    .mockImplementation(async (_req: any, res: any) => {
      res.json({ jsonrpc: "2.0", result: {}, id: 1 });
    }),
  close: vi.fn(),
};
vi.mock("@modelcontextprotocol/sdk/server/streamableHttp.js", () => ({
  StreamableHTTPServerTransport: vi.fn().mockImplementation(function () {
    return mockTransportInstance;
  }),
}));

vi.mock("ws", () => ({
  default: vi.fn().mockImplementation(function () {
    return {};
  }),
  WebSocket: vi.fn().mockImplementation(function () {
    return {};
  }),
}));

const mockHeadlessSceneInstance = {
  scene: {},
  rootGroup: {},
  isLoaded: true,
  colliderCount: 3,
  connectToDocument: vi.fn(),
  connectToDocumentByKey: vi.fn(),
  disconnectFromDocument: vi.fn(),
  setMMLDocuments: vi.fn(),
  startTicking: vi.fn(),
  registerGroundPlaneCollider: vi.fn(),
  waitForSceneReady: vi.fn<() => Promise<boolean>>().mockResolvedValue(true),
  countMeshes: vi.fn().mockReturnValue(5),
  collectMeshes: vi.fn().mockReturnValue([]),
  getSceneSummary: vi.fn().mockReturnValue({
    meshCount: 5,
    boundingBox: { min: [-10, 0, -10], max: [10, 5, 10] },
    landmarks: [],
  }),
  getClickableElements: vi.fn().mockReturnValue([]),
  getInteractionElements: vi.fn().mockReturnValue([]),
  getLabelElements: vi.fn().mockReturnValue([]),
  getAllElements: vi.fn().mockReturnValue([]),
  getElementTypeCounts: vi.fn().mockReturnValue({}),
  getElementByNodeId: vi.fn().mockReturnValue(null),
  clickNode: vi.fn().mockReturnValue({ success: true }),
  triggerInteraction: vi.fn().mockReturnValue({ success: true }),
  getFilteredSceneInfo: vi.fn().mockReturnValue([]),
  onSceneChanged: vi.fn(),
  offSceneChanged: vi.fn(),
  dispose: vi.fn(),
};
vi.mock("../src/HeadlessMMLScene", () => ({
  HeadlessMMLScene: vi.fn().mockImplementation(function () {
    return mockHeadlessSceneInstance;
  }),
}));

vi.mock("../src/NavMeshManager", () => ({
  NavMeshManager: vi.fn().mockImplementation(function () {
    return {
      isReady: false,
      currentRegionCenter: null,
      generateFromScene: vi.fn<() => Promise<boolean>>().mockResolvedValue(false),
      regenerate: vi.fn<() => Promise<boolean>>().mockResolvedValue(false),
      shouldRegenerate: vi.fn().mockReturnValue(false),
      computePathWithJumpInfo: vi.fn().mockReturnValue({
        path: [
          { x: 0, y: 0, z: 0 },
          { x: 5, y: 0, z: 5 },
        ],
        jumpIndices: new Set(),
      }),
      isWithinRegion: vi.fn().mockReturnValue(true),
      computeEdgePoint: vi.fn().mockReturnValue({ x: 5, y: 0, z: 5 }),
      waitForReady: vi.fn<() => Promise<boolean>>().mockResolvedValue(true),
      once: vi.fn(),
      removeListener: vi.fn(),
      dispose: vi.fn(),
    };
  }),
}));

const mockWebhookEmitterDispose = vi.fn();
const MockWebhookEmitterConstructor = vi.fn().mockImplementation(function () {
  return {
    dispose: mockWebhookEmitterDispose,
  };
});
(MockWebhookEmitterConstructor as any).create = vi
  .fn()
  .mockImplementation((...args: any[]) =>
    Promise.resolve(new (MockWebhookEmitterConstructor as any)(...args)),
  );
vi.mock("../src/WebhookEmitter", () => ({
  WebhookEmitter: MockWebhookEmitterConstructor,
}));

let indexModule: typeof import("../src/index");

beforeAll(async () => {
  indexModule = await import("../src/index");
});

// Mock the identity token → session token exchange; pass through other requests
const originalFetch = globalThis.fetch;
const identityTokenFetchMock = vi
  .fn<typeof fetch>()
  .mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes("?token=")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ sessionToken: "test-session-token" }),
        headers: new Headers(),
      } as Response;
    }
    return originalFetch(input, init);
  }) as typeof fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("index.ts extended", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.fetch = identityTokenFetchMock;
    mockWorldConnectionInstance.waitForConnection.mockResolvedValue(undefined);
    mockWorldConnectionInstance.waitForWorldConfig.mockResolvedValue(null);
  });

  // authUrl tests removed — bridge now uses identityToken exclusively.

  describe("createBridgeCore with mmlDocument", () => {
    test("loads single MML document", async () => {
      const core = await indexModule.createBridgeCore({
        serverUrl: "http://localhost:8080",
        bridgePort: 3101,
        botName: "TestBot",
        identityToken: "test-token",
        mmlDocument: "test-doc",
      });

      expect(mockHeadlessSceneInstance.connectToDocument).toHaveBeenCalledWith(
        "ws://localhost:8080/mml-documents/test-doc",
      );

      await core.cleanup();
    });
  });

  describe("createBridgeCore with world config containing mmlDocuments", () => {
    test("loads MML documents from world config", async () => {
      mockWorldConnectionInstance.waitForWorldConfig.mockResolvedValueOnce({
        mmlDocuments: {
          scene: { url: "/scene" },
          ui: { url: "/ui" },
        },
      });

      const core = await indexModule.createBridgeCore({
        serverUrl: "http://localhost:8080",
        bridgePort: 3101,
        botName: "TestBot",
        identityToken: "test-token",
      });

      expect(mockHeadlessSceneInstance.setMMLDocuments).toHaveBeenCalledWith(
        { scene: { url: "/scene" }, ui: { url: "/ui" } },
        "ws://localhost:8080",
      );

      await core.cleanup();
    });
  });

  describe("createBridgeCore with webhook config", () => {
    test("creates WebhookEmitter when webhook config provided", async () => {
      const { WebhookEmitter } = await import("../src/WebhookEmitter");

      const core = await indexModule.createBridgeCore({
        serverUrl: "http://localhost:8080",
        bridgePort: 3101,
        botName: "TestBot",
        identityToken: "test-token",
        webhook: {
          url: "https://hooks.example.com/events",
          token: "webhook-secret",
          events: ["chat"],
          batchMs: 5000,
        },
      });

      expect((WebhookEmitter as any).create).toHaveBeenCalledWith(
        expect.objectContaining({
          url: "https://hooks.example.com/events",
          token: "webhook-secret",
          events: ["chat"],
          batchMs: 5000,
        }),
        expect.anything(),
        expect.anything(),
      );

      await core.cleanup();
      // Verify webhook emitter was disposed during cleanup
      expect(mockWebhookEmitterDispose).toHaveBeenCalled();
    });
  });

  describe("createBridgeCore with spawnConfiguration", () => {
    test("uses provided spawn configuration over world config", async () => {
      const core = await indexModule.createBridgeCore({
        serverUrl: "http://localhost:8080",
        bridgePort: 3101,
        botName: "TestBot",
        identityToken: "test-token",
        spawnConfiguration: {
          spawnPosition: { x: 10, y: 5, z: 20 },
        },
      });

      expect(core.avatarController).toBeDefined();
      await core.cleanup();
    });
  });

  describe("createBridgeCore with characterDescription", () => {
    test("passes characterDescription to WorldConnection", async () => {
      const { WorldConnection } = await import("@mml-io/3d-web-experience-client");

      const core = await indexModule.createBridgeCore({
        serverUrl: "http://localhost:8080",
        bridgePort: 3101,
        botName: "TestBot",
        identityToken: "test-token",
        characterDescription: { mmlCharacterUrl: "https://example.com/avatar.html" },
      });

      expect(WorldConnection).toHaveBeenCalledWith(
        expect.objectContaining({
          initialUserState: expect.objectContaining({
            characterDescription: { mmlCharacterUrl: "https://example.com/avatar.html" },
          }),
        }),
      );

      await core.cleanup();
    });
  });

  describe("createBridgeCore — world config event listener", () => {
    test("calls onWorldConfig callback when world_config event fires", async () => {
      const worldEventListeners: Array<(event: any) => void> = [];
      mockWorldConnectionInstance.addEventListener.mockImplementation(
        (listener: (event: any) => void) => {
          worldEventListeners.push(listener);
        },
      );

      const onWorldConfig = vi.fn();

      const core = await indexModule.createBridgeCore({
        serverUrl: "http://localhost:8080",
        bridgePort: 3101,
        botName: "TestBot",
        identityToken: "test-token",
        onWorldConfig,
      });

      // Simulate world_config event — notify all registered listeners
      const event = {
        type: "world_config",
        config: { spawnConfiguration: { spawnPosition: { x: 5, y: 0, z: 5 } } },
      };
      for (const listener of worldEventListeners) listener(event);

      expect(onWorldConfig).toHaveBeenCalledWith(
        expect.objectContaining({ spawnConfiguration: expect.any(Object) }),
      );

      await core.cleanup();
    });

    test("calls onServerBroadcast callback when server_broadcast event fires", async () => {
      const worldEventListeners: Array<(event: any) => void> = [];
      mockWorldConnectionInstance.addEventListener.mockImplementation(
        (listener: (event: any) => void) => {
          worldEventListeners.push(listener);
        },
      );

      const onServerBroadcast = vi.fn();

      const core = await indexModule.createBridgeCore({
        serverUrl: "http://localhost:8080",
        bridgePort: 3101,
        botName: "TestBot",
        identityToken: "test-token",
        onServerBroadcast,
      });

      // Notify all registered listeners
      const event = {
        type: "server_broadcast",
        broadcastType: "test",
        payload: { data: "hello" },
      };
      for (const listener of worldEventListeners) listener(event);

      expect(onServerBroadcast).toHaveBeenCalledWith("test", { data: "hello" });

      await core.cleanup();
    });
  });

  describe("startBridge — tool execution error", () => {
    let handle: import("../src/index").BridgeHandle | null = null;
    const port = 13210;

    beforeEach(async () => {
      handle = await indexModule.startBridge({
        serverUrl: "http://localhost:8080",
        bridgePort: port,
        botName: "TestBot",
        identityToken: "test-token",
      });
    });

    afterEach(async () => {
      if (handle) {
        await handle.close();
        handle = null;
      }
    });

    test("POST /tools/:name returns 400 for invalid input (ZodError)", async () => {
      // send_chat_message requires a 'message' field
      const res = await fetch(`http://localhost:${port}/tools/send_chat_message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}), // missing required 'message' field
      });
      expect(res.status).toBe(400);
    });
  });

  describe("createBridgeCore with serverUrl edge cases", () => {
    test("handles HTTPS server URL", async () => {
      const core = await indexModule.createBridgeCore({
        serverUrl: "https://example.com:8443",
        bridgePort: 3101,
        botName: "TestBot",
        identityToken: "test-token",
      });

      expect(core.toolCtx.serverUrl).toBe("https://example.com:8443");
      await core.cleanup();
    });
  });
});
