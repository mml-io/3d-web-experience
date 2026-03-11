import fs from "fs";
import http from "http";
import os from "os";
import path from "path";
import url from "url";

import { jest } from "@jest/globals";

import type { WorldConfig } from "../src/config";

// The serve module depends on @mml-io/3d-web-experience-server.
// We mock the heavy server dependency so tests run without building the full stack.

const mockBroadcastMessage = jest.fn();
const mockRegisterExpressRoutes = jest.fn<(app: unknown) => void>();
const mockDispose = jest.fn();
const mockSetIndexContent = jest.fn();
const mockSetWorldConfig = jest.fn();
const mockSetEnableChat = jest.fn();

jest.unstable_mockModule("@mml-io/3d-web-experience-server", () => ({
  Networked3dWebExperienceServer: jest.fn().mockImplementation(() => ({
    registerExpressRoutes: mockRegisterExpressRoutes,
    dispose: mockDispose,
    setIndexContent: mockSetIndexContent,
    setWorldConfig: mockSetWorldConfig,
    setEnableChat: mockSetEnableChat,
    userNetworkingServer: { broadcastMessage: mockBroadcastMessage },
  })),
}));

// Dynamic import after mocking
const { serve, escapeJsonForScript } = await import("../src/serve");
const { Networked3dWebExperienceServer: MockServerConstructor } =
  await import("@mml-io/3d-web-experience-server");

// serve.ts resolves client/index.html relative to its own location via import.meta.url.
// When running from source (ts-jest), dirname resolves to src/, so it looks for
// src/client/index.html which doesn't exist (it's a build artifact). Create a stub.
const dirname = url.fileURLToPath(new URL(".", import.meta.url));
const clientDir = path.resolve(dirname, "../src/client");
const stubIndexPath = path.join(clientDir, "index.html");
let createdStubFile = false;
let createdStubDir = false;

beforeAll(() => {
  if (!fs.existsSync(stubIndexPath)) {
    if (!fs.existsSync(clientDir)) {
      fs.mkdirSync(clientDir, { recursive: true });
      createdStubDir = true;
    }
    fs.writeFileSync(
      stubIndexPath,
      "<html><head><script>window.CONFIG = CONFIG_PLACEHOLDER;</script></head><body>test-stub</body></html>",
    );
    createdStubFile = true;
  }
});

afterAll(() => {
  if (createdStubFile) {
    try {
      fs.unlinkSync(stubIndexPath);
    } catch {
      // ignore cleanup errors
    }
  }
  if (createdStubDir) {
    try {
      fs.rmdirSync(clientDir);
    } catch {
      // ignore cleanup errors (directory may not be empty if build artifacts exist)
    }
  }
});

function fetchJson(port: number, urlPath: string): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://127.0.0.1:${port}${urlPath}`, (res) => {
      let data = "";
      res.on("data", (chunk: string) => (data += chunk));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode!, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode!, body: data });
        }
      });
    });
    req.on("error", reject);
  });
}

function fetchRaw(port: number, urlPath: string): Promise<{ status: number; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://127.0.0.1:${port}${urlPath}`, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        resolve({ status: res.statusCode!, body: Buffer.concat(chunks) });
      });
    });
    req.on("error", reject);
  });
}

function fetchWithHeaders(
  port: number,
  urlPath: string,
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://127.0.0.1:${port}${urlPath}`, (res) => {
      let data = "";
      res.on("data", (chunk: string) => (data += chunk));
      res.on("end", () => {
        resolve({ status: res.statusCode!, headers: res.headers, body: data });
      });
    });
    req.on("error", reject);
  });
}

function fetchPost(
  port: number,
  urlPath: string,
  body: unknown,
  headers?: Record<string, string>,
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(body);
    const reqOptions = {
      hostname: "127.0.0.1",
      port,
      path: urlPath,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(postData),
        ...headers,
      },
    };
    const req = http.request(reqOptions, (res) => {
      let data = "";
      res.on("data", (chunk: string) => (data += chunk));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode!, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode!, body: data });
        }
      });
    });
    req.on("error", reject);
    req.write(postData);
    req.end();
  });
}

// TOCTOU: the port may be reused between close and serve(). ServeHandle does
// not expose the actual listening port, so we cannot use port 0 and read back
// the assigned port. In practice this is unlikely to cause flakes.
async function findFreePort(): Promise<number> {
  return new Promise((resolve) => {
    const srv = http.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const port = (srv.address() as { port: number }).port;
      srv.close(() => resolve(port));
    });
  });
}

describe("serve", () => {
  let tmpDir: string;
  let configPath: string;
  let serveHandle: { close(): void } | null = null;
  beforeEach(() => {
    tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "3d-web-serve-test-")));
    configPath = path.join(tmpDir, "world.json");
    mockBroadcastMessage.mockClear();
    mockRegisterExpressRoutes.mockClear();
    mockDispose.mockClear();
    mockSetIndexContent.mockClear();
    mockSetWorldConfig.mockClear();
    mockSetEnableChat.mockClear();
    serveHandle = null;
    jest.spyOn(process, "exit").mockImplementation((_code?: number) => {
      throw new Error("process.exit called");
    });
  });

  afterEach(() => {
    serveHandle?.close();
    jest.restoreAllMocks();
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("bakes page config into indexContent passed to the server", async () => {
    const port = await findFreePort();
    const worldConfig: WorldConfig = {
      chat: true,
      loadingScreen: { title: "Hello" },
    };
    fs.writeFileSync(configPath, JSON.stringify(worldConfig));

    serveHandle = await serve(worldConfig, {
      port,
      host: "127.0.0.1",
      watch: false,
      configPath,
      mmlWsPath: "/mml-documents/",
      assetsUrlPath: "/assets/",
    });

    const mockCtor = MockServerConstructor as jest.Mock;
    const constructorArg = mockCtor.mock.calls[mockCtor.mock.calls.length - 1][0] as Record<
      string,
      unknown
    >;
    const webClientServing = constructorArg.webClientServing as Record<string, unknown>;
    const indexContent = webClientServing.indexContent as string;
    expect(indexContent).toContain('"title":"Hello"');
    expect(indexContent).not.toContain("CONFIG_PLACEHOLDER");
  }, 10000);

  it("indexContent contains only PageConfig (loading screen)", async () => {
    const port = await findFreePort();
    const worldConfig: WorldConfig = {
      loadingScreen: { background: "#111", title: "Test" },
      chat: false,
      allowOrbitalCamera: false,
    };
    fs.writeFileSync(configPath, JSON.stringify(worldConfig));

    serveHandle = await serve(worldConfig, {
      port,
      host: "127.0.0.1",
      watch: false,
      configPath,
      mmlWsPath: "/mml-documents/",
      assetsUrlPath: "/assets/",
    });

    const mockCtor = MockServerConstructor as jest.Mock;
    const constructorArg = mockCtor.mock.calls[mockCtor.mock.calls.length - 1][0] as Record<
      string,
      unknown
    >;
    const webClientServing = constructorArg.webClientServing as Record<string, unknown>;
    const indexContent = webClientServing.indexContent as string;

    // Extract the JSON from window.CONFIG = {...};
    const match = indexContent.match(/window\.CONFIG\s*=\s*(\{[^;]*\})\s*;/);
    expect(match).not.toBeNull();
    const config = JSON.parse(match![1]);
    // Only loading screen should be present
    expect(config.loadingScreen).toEqual({ background: "#111", title: "Test" });
    // World config fields should NOT be on the page
    expect(config.enableChat).toBeUndefined();
    expect(config.allowOrbitalCamera).toBeUndefined();
  }, 10000);

  it("GET /avatars/<file>.glb returns a GLB file", async () => {
    const port = await findFreePort();
    const worldConfig: WorldConfig = {};
    fs.writeFileSync(configPath, JSON.stringify(worldConfig));

    serveHandle = await serve(worldConfig, {
      port,
      host: "127.0.0.1",
      watch: false,
      configPath,
      mmlWsPath: "/mml-documents/",
      assetsUrlPath: "/assets/",
    });

    const { status, body } = await fetchRaw(port, "/avatars/avatar-1-bodyA-skin01.glb");
    expect(status).toBe(200);
    expect(body.length).toBeGreaterThan(0);
    // GLB files start with the magic bytes "glTF"
    expect(body.subarray(0, 4).toString("ascii")).toBe("glTF");
  }, 10000);

  it("includes security headers on responses", async () => {
    const port = await findFreePort();
    const worldConfig: WorldConfig = {};
    fs.writeFileSync(configPath, JSON.stringify(worldConfig));

    serveHandle = await serve(worldConfig, {
      port,
      host: "127.0.0.1",
      watch: false,
      configPath,
      mmlWsPath: "/mml-documents/",
      assetsUrlPath: "/assets/",
    });

    const { headers } = await fetchWithHeaders(port, "/avatars/avatar-1-bodyA-skin01.glb");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-frame-options"]).toBe("SAMEORIGIN");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  }, 10000);

  it("registers Networked3dWebExperienceServer routes on the app", async () => {
    const port = await findFreePort();
    const worldConfig: WorldConfig = {};
    fs.writeFileSync(configPath, JSON.stringify(worldConfig));

    serveHandle = await serve(worldConfig, {
      port,
      host: "127.0.0.1",
      watch: false,
      configPath,
      mmlWsPath: "/mml-documents/",
      assetsUrlPath: "/assets/",
    });

    expect(mockRegisterExpressRoutes).toHaveBeenCalledTimes(1);
  }, 10000);

  // --- Bot auth rate limiting tests ---

  it("POST /api/v1/bot-auth returns 401 without API key when key is configured", async () => {
    const port = await findFreePort();
    const worldConfig: WorldConfig = { auth: { allowBots: true, botApiKey: "test-secret-key" } };
    fs.writeFileSync(configPath, JSON.stringify(worldConfig));

    serveHandle = await serve(worldConfig, {
      port,
      host: "127.0.0.1",
      watch: false,
      configPath,
      mmlWsPath: "/mml-documents/",
      assetsUrlPath: "/assets/",
    });

    // POST without auth header
    const { status, body } = await fetchPost(port, "/api/v1/bot-auth", {});
    expect(status).toBe(401);
    expect((body as Record<string, unknown>).error).toBe("Invalid or missing bot API key");
  }, 10000);

  it("POST /api/v1/bot-auth returns 401 with wrong API key", async () => {
    const port = await findFreePort();
    const worldConfig: WorldConfig = { auth: { allowBots: true, botApiKey: "test-secret-key" } };
    fs.writeFileSync(configPath, JSON.stringify(worldConfig));

    serveHandle = await serve(worldConfig, {
      port,
      host: "127.0.0.1",
      watch: false,
      configPath,
      mmlWsPath: "/mml-documents/",
      assetsUrlPath: "/assets/",
    });

    const { status, body } = await fetchPost(
      port,
      "/api/v1/bot-auth",
      {},
      {
        Authorization: "Bearer wrong-key-here",
      },
    );
    expect(status).toBe(401);
    expect((body as Record<string, unknown>).error).toBe("Invalid or missing bot API key");
  }, 10000);

  it("POST /api/v1/bot-auth returns token with correct API key", async () => {
    const port = await findFreePort();
    const apiKey = "test-secret-key-abc123";
    const worldConfig: WorldConfig = {
      auth: { allowBots: true, botApiKey: apiKey, allowAnonymous: true },
    };
    fs.writeFileSync(configPath, JSON.stringify(worldConfig));

    serveHandle = await serve(worldConfig, {
      port,
      host: "127.0.0.1",
      watch: false,
      configPath,
      mmlWsPath: "/mml-documents/",
      assetsUrlPath: "/assets/",
    });

    const { status, body } = await fetchPost(
      port,
      "/api/v1/bot-auth",
      {},
      {
        Authorization: `Bearer ${apiKey}`,
      },
    );
    expect(status).toBe(200);
    const responseBody = body as Record<string, unknown>;
    expect(responseBody.token).toBeDefined();
    expect(typeof responseBody.token).toBe("string");
    expect((responseBody.token as string).length).toBeGreaterThan(0);
  }, 10000);

  it("POST /api/v1/bot-auth rate limits after too many failed requests", async () => {
    const port = await findFreePort();
    const worldConfig: WorldConfig = {
      auth: { allowBots: true, allowAnonymous: true, botApiKey: "correct-key" },
    };
    fs.writeFileSync(configPath, JSON.stringify(worldConfig));

    serveHandle = await serve(worldConfig, {
      port,
      host: "127.0.0.1",
      watch: false,
      configPath,
      mmlWsPath: "/mml-documents/",
      assetsUrlPath: "/assets/",
    });

    const wrongAuth = { Authorization: "Bearer wrong-key" };
    const correctAuth = { Authorization: "Bearer correct-key" };

    // Make 10 requests with wrong API key — all should fail with 401
    for (let i = 0; i < 10; i++) {
      const { status } = await fetchPost(port, "/api/v1/bot-auth", {}, wrongAuth);
      expect(status).toBe(401);
    }

    // The 11th failed request should be rate limited
    const { status, body } = await fetchPost(port, "/api/v1/bot-auth", {}, wrongAuth);
    expect(status).toBe(429);
    expect((body as Record<string, unknown>).error).toBe(
      "Too many bot auth requests. Please try again later.",
    );

    // Even correct-key requests are blocked once the IP is rate-limited
    const { status: blockedStatus } = await fetchPost(port, "/api/v1/bot-auth", {}, correctAuth);
    expect(blockedStatus).toBe(429);
  }, 15000);

  // --- Assets directory handling ---

  it("throws when configured assets directory does not exist", async () => {
    const port = await findFreePort();
    const worldConfig: WorldConfig = {};
    fs.writeFileSync(configPath, JSON.stringify(worldConfig));

    await expect(
      serve(worldConfig, {
        port,
        host: "127.0.0.1",
        watch: false,
        configPath,
        mmlWsPath: "/mml-documents/",
        assetsUrlPath: "/assets/",
        assets: "/nonexistent/path/to/assets",
      }),
    ).rejects.toThrow("Assets directory not found");
  }, 10000);

  // --- Client script URL escaping ---

  it("escapes special characters in HTTP client script URLs", async () => {
    const port = await findFreePort();
    const worldConfig: WorldConfig = {
      clientScripts: ["https://example.com/script.js?a=1&b=<script>"],
    };
    fs.writeFileSync(configPath, JSON.stringify(worldConfig));

    serveHandle = await serve(worldConfig, {
      port,
      host: "127.0.0.1",
      watch: false,
      configPath,
      mmlWsPath: "/mml-documents/",
      assetsUrlPath: "/assets/",
    });

    // The serve function injects escaped script tags into indexContent and passes
    // that to the Networked3dWebExperienceServer constructor. Inspect the config
    // passed to the mock constructor to verify escaping.
    const mockCtor = MockServerConstructor as jest.Mock;
    const constructorArg = mockCtor.mock.calls[mockCtor.mock.calls.length - 1][0] as Record<
      string,
      unknown
    >;
    const webClientServing = constructorArg.webClientServing as Record<string, unknown>;
    const indexContent = webClientServing.indexContent as string;

    // Should NOT contain raw < or > in script src
    expect(indexContent).not.toContain('src="https://example.com/script.js?a=1&b=<script>"');
    expect(indexContent).toContain("&amp;");
    expect(indexContent).toContain("&lt;");
    expect(indexContent).toContain("&gt;");
  }, 10000);

  // --- MML documents directory ---

  it("throws when configured MML documents directory does not exist", async () => {
    const port = await findFreePort();
    const worldConfig: WorldConfig = {};
    fs.writeFileSync(configPath, JSON.stringify(worldConfig));

    await expect(
      serve(worldConfig, {
        port,
        host: "127.0.0.1",
        watch: false,
        configPath,
        mmlDocuments: "/nonexistent/mml/dir",
        mmlWsPath: "/mml-documents/",
        assetsUrlPath: "/assets/",
      }),
    ).rejects.toThrow("MML documents directory not found");
  }, 10000);

  // --- Local client script injection ---

  it("injects local client script and serves it", async () => {
    const port = await findFreePort();
    // Create a local script file
    const scriptPath = path.join(tmpDir, "my-script.js");
    fs.writeFileSync(scriptPath, 'console.log("hello");');

    const worldConfig: WorldConfig = { clientScripts: [scriptPath] };
    fs.writeFileSync(configPath, JSON.stringify(worldConfig));

    serveHandle = await serve(worldConfig, {
      port,
      host: "127.0.0.1",
      watch: false,
      configPath,
      mmlWsPath: "/mml-documents/",
      assetsUrlPath: "/assets/",
    });

    // The script injection should have modified the indexContent
    const mockCtor = MockServerConstructor as jest.Mock;
    const constructorArg = mockCtor.mock.calls[mockCtor.mock.calls.length - 1][0] as Record<
      string,
      unknown
    >;
    const webClientServing = constructorArg.webClientServing as Record<string, unknown>;
    const indexContent = webClientServing.indexContent as string;
    expect(indexContent).toContain("/client-scripts/");
    expect(indexContent).toContain("my-script.js");
  }, 10000);

  it("throws when local client script does not exist", async () => {
    const port = await findFreePort();
    // Use a relative path within the config directory so it passes the escapes check
    const worldConfig: WorldConfig = {
      clientScripts: ["nonexistent-script.js"],
    };
    fs.writeFileSync(configPath, JSON.stringify(worldConfig));

    await expect(
      serve(worldConfig, {
        port,
        host: "127.0.0.1",
        watch: false,
        configPath,
        mmlWsPath: "/mml-documents/",
        assetsUrlPath: "/assets/",
      }),
    ).rejects.toThrow("Client script not found");
  }, 10000);

  it("throws when local client script path escapes config directory", async () => {
    const port = await findFreePort();
    // Create a real file outside the config directory so it passes the existence
    // check and reaches the path-escape validation.
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "3d-web-escape-test-"));
    const outsideScript = path.join(outsideDir, "evil.js");
    fs.writeFileSync(outsideScript, "console.log('escape');");
    const relativePath = path.relative(path.dirname(configPath), outsideScript);
    try {
      const worldConfig: WorldConfig = {
        clientScripts: [relativePath],
      };
      fs.writeFileSync(configPath, JSON.stringify(worldConfig));

      await expect(
        serve(worldConfig, {
          port,
          host: "127.0.0.1",
          watch: false,
          configPath,
          mmlWsPath: "/mml-documents/",
          assetsUrlPath: "/assets/",
        }),
      ).rejects.toThrow("Client script path escapes config directory");
    } finally {
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  }, 10000);

  // --- Config file watching ---

  it("starts server with watch mode enabled", async () => {
    const port = await findFreePort();
    const worldConfig: WorldConfig = { chat: true };
    fs.writeFileSync(configPath, JSON.stringify(worldConfig));

    serveHandle = await serve(worldConfig, {
      port,
      host: "127.0.0.1",
      watch: true,
      configPath,
      mmlWsPath: "/mml-documents/",
      assetsUrlPath: "/assets/",
    });

    // Server should start successfully with watch enabled
    expect(mockRegisterExpressRoutes).toHaveBeenCalledTimes(1);
  }, 10000);

  it("warns on every config reload when a restart-required field was changed", async () => {
    const port = await findFreePort();
    const worldConfig: WorldConfig = {
      auth: { webhookUrl: "https://original.example.com/auth" },
    };
    fs.writeFileSync(configPath, JSON.stringify(worldConfig));

    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    jest.spyOn(console, "log").mockImplementation(() => {});

    serveHandle = await serve(worldConfig, {
      port,
      host: "127.0.0.1",
      watch: true,
      configPath,
      mmlWsPath: "/mml-documents/",
      assetsUrlPath: "/assets/",
    });

    // Allow chokidar's FSEvents backend to finish initialization
    await new Promise((r) => setTimeout(r, 1000));

    // First config change: modify a restart-required field
    const updatedConfig1: WorldConfig = {
      auth: { webhookUrl: "https://changed.example.com/auth" },
    };
    fs.writeFileSync(configPath, JSON.stringify(updatedConfig1));

    // Wait for chokidar + debounce (300ms debounce + filesystem event delay)
    await new Promise((r) => setTimeout(r, 1500));

    const warningCalls1 = warnSpy.mock.calls.filter(
      (call) => typeof call[0] === "string" && call[0].includes("require a server restart"),
    );
    expect(warningCalls1.length).toBe(1);
    expect(warningCalls1[0][0]).toContain("auth.webhookUrl");

    // Second config change: same restart-required field stays at the changed value.
    // The warning should appear again because the running server still uses the
    // original value.
    const updatedConfig2: WorldConfig = {
      auth: { webhookUrl: "https://changed.example.com/auth" },
      chat: false,
    };
    fs.writeFileSync(configPath, JSON.stringify(updatedConfig2));

    await new Promise((r) => setTimeout(r, 1500));

    const warningCalls2 = warnSpy.mock.calls.filter(
      (call) => typeof call[0] === "string" && call[0].includes("require a server restart"),
    );
    // Should have two warnings total — one per reload
    expect(warningCalls2.length).toBe(2);

    // setEnableChat should have been called instead of direct config mutation
    expect(mockSetEnableChat).toHaveBeenCalled();
  }, 20000);

  it("calls server.setEnableChat on config reload instead of mutating serverConfig", async () => {
    const port = await findFreePort();
    const worldConfig: WorldConfig = { chat: true };
    fs.writeFileSync(configPath, JSON.stringify(worldConfig));

    jest.spyOn(console, "log").mockImplementation(() => {});

    serveHandle = await serve(worldConfig, {
      port,
      host: "127.0.0.1",
      watch: true,
      configPath,
      mmlWsPath: "/mml-documents/",
      assetsUrlPath: "/assets/",
    });

    // Allow chokidar's FSEvents backend to finish initialization
    await new Promise((r) => setTimeout(r, 1000));

    // Update config to disable chat
    const updatedConfig: WorldConfig = { chat: false };
    fs.writeFileSync(configPath, JSON.stringify(updatedConfig));

    await new Promise((r) => setTimeout(r, 1500));

    expect(mockSetEnableChat).toHaveBeenCalledWith(false);
  }, 15000);

  // --- Auth config variations ---

  it("logs warning when both webhookUrl and serverUrl are set", async () => {
    const port = await findFreePort();
    const worldConfig: WorldConfig = {
      auth: {
        webhookUrl: "https://example.com/auth",
        serverUrl: "https://example.com/server",
      },
    };
    fs.writeFileSync(configPath, JSON.stringify(worldConfig));

    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

    serveHandle = await serve(worldConfig, {
      port,
      host: "127.0.0.1",
      watch: false,
      configPath,
      mmlWsPath: "/mml-documents/",
      assetsUrlPath: "/assets/",
    });

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Both auth.webhookUrl and auth.serverUrl"),
    );
  }, 10000);

  // --- Assets directory with valid path ---

  it("serves assets when valid assets directory is provided", async () => {
    const port = await findFreePort();
    const assetsDir = path.join(tmpDir, "assets");
    fs.mkdirSync(assetsDir);
    const worldConfig: WorldConfig = {};
    fs.writeFileSync(configPath, JSON.stringify(worldConfig));

    serveHandle = await serve(worldConfig, {
      port,
      host: "127.0.0.1",
      watch: false,
      configPath,
      mmlWsPath: "/mml-documents/",
      assetsUrlPath: "/assets/",
      assets: assetsDir,
    });

    expect(mockRegisterExpressRoutes).toHaveBeenCalledTimes(1);
  }, 10000);

  it("normalizes mmlWsPath without leading slash", async () => {
    const port = await findFreePort();
    const mmlDocsDir = path.join(tmpDir, "mml-docs-norm");
    fs.mkdirSync(mmlDocsDir);
    fs.writeFileSync(path.join(mmlDocsDir, "test.html"), "<m-cube></m-cube>");
    const worldConfig: WorldConfig = {};
    fs.writeFileSync(configPath, JSON.stringify(worldConfig));

    serveHandle = await serve(worldConfig, {
      port,
      host: "127.0.0.1",
      watch: false,
      configPath,
      mmlDocuments: mmlDocsDir,
      mmlWsPath: "mml-documents",
      assetsUrlPath: "assets",
    });

    // The Networked3dWebExperienceServer constructor should receive normalized paths
    const mockCtor = MockServerConstructor as jest.Mock;
    const arg = mockCtor.mock.calls[mockCtor.mock.calls.length - 1][0] as Record<string, any>;
    expect(arg.mmlServing.documentsUrl).toBe("/mml-documents/");
    expect(arg.assetServing).toBeUndefined();
  }, 10000);

  it("starts server with auth.maxConnections set", async () => {
    const port = await findFreePort();
    const worldConfig: WorldConfig = {
      auth: { maxConnections: 50 },
    };
    fs.writeFileSync(configPath, JSON.stringify(worldConfig));

    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});

    serveHandle = await serve(worldConfig, {
      port,
      host: "127.0.0.1",
      watch: false,
      configPath,
      mmlWsPath: "/mml-documents/",
      assetsUrlPath: "/assets/",
    });

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("max connections = 50"));
  }, 10000);

  it("starts server with MML documents config and logs document names", async () => {
    const port = await findFreePort();
    const worldConfig: WorldConfig = {
      mmlDocuments: {
        "hello.html": { url: "https://example.com/hello.html" },
      },
    };
    fs.writeFileSync(configPath, JSON.stringify(worldConfig));

    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});

    serveHandle = await serve(worldConfig, {
      port,
      host: "127.0.0.1",
      watch: false,
      configPath,
      mmlWsPath: "/mml-documents/",
      assetsUrlPath: "/assets/",
    });

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("hello.html"));
  }, 10000);

  it("starts server with serverUrl auth config and logs it", async () => {
    const port = await findFreePort();
    const worldConfig: WorldConfig = {
      auth: { serverUrl: "https://auth.example.com" },
    };
    fs.writeFileSync(configPath, JSON.stringify(worldConfig));

    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});

    serveHandle = await serve(worldConfig, {
      port,
      host: "127.0.0.1",
      watch: false,
      configPath,
      mmlWsPath: "/mml-documents/",
      assetsUrlPath: "/assets/",
    });

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("Auth: remote server (https://auth.example.com)"),
    );
  }, 10000);

  it("starts server with webhookUrl auth config and logs it", async () => {
    const port = await findFreePort();
    const worldConfig: WorldConfig = {
      auth: { webhookUrl: "https://hook.example.com/auth" },
    };
    fs.writeFileSync(configPath, JSON.stringify(worldConfig));

    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});

    serveHandle = await serve(worldConfig, {
      port,
      host: "127.0.0.1",
      watch: false,
      configPath,
      mmlWsPath: "/mml-documents/",
      assetsUrlPath: "/assets/",
    });

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("Auth: webhook (https://hook.example.com/auth)"),
    );
  }, 10000);

  it("rejects with error when port is already in use", async () => {
    const port = await findFreePort();
    const worldConfig: WorldConfig = {};
    fs.writeFileSync(configPath, JSON.stringify(worldConfig));

    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    // Start first server
    serveHandle = await serve(worldConfig, {
      port,
      host: "127.0.0.1",
      watch: false,
      configPath,
      mmlWsPath: "/mml-documents/",
      assetsUrlPath: "/assets/",
    });

    // Try to start a second server on the same port — should fail with EADDRINUSE
    await expect(
      serve(worldConfig, {
        port,
        host: "127.0.0.1",
        watch: false,
        configPath,
        mmlWsPath: "/mml-documents/",
        assetsUrlPath: "/assets/",
      }),
    ).rejects.toThrow();

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("already in use"));
  }, 10000);

  it("auto-detects mml-documents directory next to config file", async () => {
    const port = await findFreePort();
    const worldConfig: WorldConfig = {};
    const mmlDocsDir = path.join(tmpDir, "mml-documents");
    fs.mkdirSync(mmlDocsDir);
    // Create a dummy MML document
    fs.writeFileSync(path.join(mmlDocsDir, "test.html"), "<m-cube></m-cube>");
    fs.writeFileSync(configPath, JSON.stringify(worldConfig));

    // Don't pass mmlDocuments option — let it auto-detect
    serveHandle = await serve(worldConfig, {
      port,
      host: "127.0.0.1",
      watch: false,
      configPath,
      mmlWsPath: "/mml-documents/",
      assetsUrlPath: "/assets/",
    });

    // Server should start without error
    expect(mockRegisterExpressRoutes).toHaveBeenCalledTimes(1);
  }, 10000);

  // --- Reserved path conflict tests ---

  it("throws when mmlWsPath is /", async () => {
    const port = await findFreePort();
    const worldConfig: WorldConfig = {};
    fs.writeFileSync(configPath, JSON.stringify(worldConfig));

    await expect(
      serve(worldConfig, {
        port,
        host: "127.0.0.1",
        watch: false,
        configPath,
        mmlWsPath: "/",
        assetsUrlPath: "/assets/",
      }),
    ).rejects.toThrow('--mml-ws-path cannot be "/"');
  }, 10000);

  it("throws when assetsUrlPath is /", async () => {
    const port = await findFreePort();
    const worldConfig: WorldConfig = {};
    fs.writeFileSync(configPath, JSON.stringify(worldConfig));

    await expect(
      serve(worldConfig, {
        port,
        host: "127.0.0.1",
        watch: false,
        configPath,
        mmlWsPath: "/mml-documents/",
        assetsUrlPath: "/",
      }),
    ).rejects.toThrow('--assets-url-path cannot be "/"');
  }, 10000);

  it("throws when assetsUrlPath is a prefix of a reserved route", async () => {
    const port = await findFreePort();
    const worldConfig: WorldConfig = {};
    fs.writeFileSync(configPath, JSON.stringify(worldConfig));

    // "/net/" is a prefix of "/network", so this should conflict
    await expect(
      serve(worldConfig, {
        port,
        host: "127.0.0.1",
        watch: false,
        configPath,
        mmlWsPath: "/mml-documents/",
        assetsUrlPath: "/net",
      }),
    ).rejects.toThrow('--assets-url-path "/net" conflicts with reserved route "/network"');
  }, 10000);

  it("throws when mmlWsPath and assetsUrlPath conflict with each other", async () => {
    const port = await findFreePort();
    const worldConfig: WorldConfig = {};
    fs.writeFileSync(configPath, JSON.stringify(worldConfig));

    await expect(
      serve(worldConfig, {
        port,
        host: "127.0.0.1",
        watch: false,
        configPath,
        mmlWsPath: "/shared/mml/",
        assetsUrlPath: "/shared/",
      }),
    ).rejects.toThrow("conflicts with --assets-url-path");
  }, 10000);

  // --- escapeJsonForScript safety ---

  it("escapeJsonForScript neutralizes </script> and <!-- in config values", () => {
    const input = JSON.stringify({
      title: '</script><script>alert("xss")</script>',
      comment: "<!-- html comment -->",
    });
    const escaped = escapeJsonForScript(input);
    // The escaped output must not contain literal "<" characters
    expect(escaped).not.toContain("</script>");
    expect(escaped).not.toContain("<!--");
    expect(escaped).not.toContain("<");
    // The escaped output is valid JSON (\\u003c is a standard JSON unicode escape)
    expect(JSON.parse(escaped)).toEqual({
      title: '</script><script>alert("xss")</script>',
      comment: "<!-- html comment -->",
    });
  });

  // --- BOT_API_KEY env var override ---

  it("BOT_API_KEY env var overrides config botApiKey", async () => {
    const port = await findFreePort();
    const envKey = "env-override-key-" + Date.now();
    const worldConfig: WorldConfig = {
      auth: { allowBots: true, botApiKey: "config-key", allowAnonymous: true },
    };
    fs.writeFileSync(configPath, JSON.stringify(worldConfig));

    process.env.BOT_API_KEY = envKey;
    try {
      serveHandle = await serve(worldConfig, {
        port,
        host: "127.0.0.1",
        watch: false,
        configPath,
        mmlWsPath: "/mml-documents/",
        assetsUrlPath: "/assets/",
      });

      // Config key should NOT work
      const { status: configKeyStatus } = await fetchPost(
        port,
        "/api/v1/bot-auth",
        {},
        { Authorization: "Bearer config-key" },
      );
      expect(configKeyStatus).toBe(401);

      // Env var key should work
      const { status: envKeyStatus } = await fetchPost(
        port,
        "/api/v1/bot-auth",
        {},
        { Authorization: `Bearer ${envKey}` },
      );
      expect(envKeyStatus).toBe(200);
    } finally {
      delete process.env.BOT_API_KEY;
    }
  }, 10000);

  // --- Bot auth endpoint not registered ---

  it("bot auth endpoint not registered when allowBots without botApiKey and anonymous disabled", async () => {
    const port = await findFreePort();
    const worldConfig: WorldConfig = { auth: { allowBots: true } };
    fs.writeFileSync(configPath, JSON.stringify(worldConfig));

    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

    serveHandle = await serve(worldConfig, {
      port,
      host: "127.0.0.1",
      watch: false,
      configPath,
      mmlWsPath: "/mml-documents/",
      assetsUrlPath: "/assets/",
    });

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("bot auth endpoint will not be registered"),
    );

    // Endpoint should not be reachable
    const { status } = await fetchPost(port, "/api/v1/bot-auth", {});
    expect(status).toBe(404);
  }, 10000);

  // --- Bot auth with RemoteUserAuthenticator (fallback path) ---

  it("bot auth falls back to RemoteUserAuthenticator when serverUrl is set", async () => {
    const port = await findFreePort();
    const apiKey = "remote-bot-key";

    // Stand up a mock auth server that returns a session token
    const mockAuthServer = http.createServer((req, res) => {
      let body = "";
      req.on("data", (chunk: string) => (body += chunk));
      req.on("end", () => {
        // The bot-auth fallback strips the Authorization header before
        // calling generateAuthorizedSessionToken, which POSTs to /session.
        if (req.url === "/session") {
          // Verify the Authorization header was stripped
          if (req.headers.authorization) {
            res.writeHead(400, { "content-type": "application/json" });
            res.end(JSON.stringify({ error: "Authorization header should have been stripped" }));
            return;
          }
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ sessionToken: "remote-session-token-123" }));
          return;
        }
        res.writeHead(404);
        res.end();
      });
    });
    const authServerUrl = await new Promise<string>((resolve) => {
      mockAuthServer.listen(0, "127.0.0.1", () => {
        const addr = mockAuthServer.address() as { port: number };
        resolve(`http://127.0.0.1:${addr.port}`);
      });
    });

    try {
      const worldConfig: WorldConfig = {
        auth: { serverUrl: authServerUrl, allowBots: true, botApiKey: apiKey },
      };
      fs.writeFileSync(configPath, JSON.stringify(worldConfig));

      serveHandle = await serve(worldConfig, {
        port,
        host: "127.0.0.1",
        watch: false,
        configPath,
        mmlWsPath: "/mml-documents/",
        assetsUrlPath: "/assets/",
      });

      const { status, body } = await fetchPost(
        port,
        "/api/v1/bot-auth",
        {},
        { Authorization: `Bearer ${apiKey}` },
      );
      expect(status).toBe(200);
      expect((body as Record<string, unknown>).token).toBe("remote-session-token-123");
    } finally {
      mockAuthServer.close();
    }
  }, 15000);

  it("bot auth fallback returns 500 when remote auth server returns a redirect", async () => {
    const port = await findFreePort();
    const apiKey = "remote-bot-key";

    const mockAuthServer = http.createServer((req, res) => {
      let body = "";
      req.on("data", (chunk: string) => (body += chunk));
      req.on("end", () => {
        if (req.url === "/session") {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ redirect: "https://login.example.com/oauth" }));
          return;
        }
        res.writeHead(404);
        res.end();
      });
    });
    const authServerUrl = await new Promise<string>((resolve) => {
      mockAuthServer.listen(0, "127.0.0.1", () => {
        const addr = mockAuthServer.address() as { port: number };
        resolve(`http://127.0.0.1:${addr.port}`);
      });
    });

    try {
      const worldConfig: WorldConfig = {
        auth: { serverUrl: authServerUrl, allowBots: true, botApiKey: apiKey },
      };
      fs.writeFileSync(configPath, JSON.stringify(worldConfig));

      serveHandle = await serve(worldConfig, {
        port,
        host: "127.0.0.1",
        watch: false,
        configPath,
        mmlWsPath: "/mml-documents/",
        assetsUrlPath: "/assets/",
      });

      const { status, body } = await fetchPost(
        port,
        "/api/v1/bot-auth",
        {},
        { Authorization: `Bearer ${apiKey}` },
      );
      expect(status).toBe(500);
      expect((body as Record<string, unknown>).error).toBe("Failed to generate bot token");
    } finally {
      mockAuthServer.close();
    }
  }, 15000);

  it("bot auth fallback returns 500 when remote auth server is unreachable", async () => {
    const port = await findFreePort();
    const apiKey = "remote-bot-key";

    // Use a URL that will fail to connect (closed port)
    const closedPort = await findFreePort();
    const worldConfig: WorldConfig = {
      auth: {
        serverUrl: `http://127.0.0.1:${closedPort}`,
        allowBots: true,
        botApiKey: apiKey,
      },
    };
    fs.writeFileSync(configPath, JSON.stringify(worldConfig));

    jest.spyOn(console, "error").mockImplementation(() => {});

    serveHandle = await serve(worldConfig, {
      port,
      host: "127.0.0.1",
      watch: false,
      configPath,
      mmlWsPath: "/mml-documents/",
      assetsUrlPath: "/assets/",
    });

    const { status, body } = await fetchPost(
      port,
      "/api/v1/bot-auth",
      {},
      { Authorization: `Bearer ${apiKey}` },
    );
    expect(status).toBe(500);
    expect((body as Record<string, unknown>).error).toBe("Failed to generate bot token");
  }, 15000);

  // --- SIGINT/SIGTERM handler cleanup ---

  it("removes SIGINT and SIGTERM handlers after close()", async () => {
    const port = await findFreePort();
    const worldConfig: WorldConfig = {};
    fs.writeFileSync(configPath, JSON.stringify(worldConfig));

    const sigintBefore = process.listenerCount("SIGINT");
    const sigtermBefore = process.listenerCount("SIGTERM");

    const handle = await serve(worldConfig, {
      port,
      host: "127.0.0.1",
      watch: false,
      configPath,
      mmlWsPath: "/mml-documents/",
      assetsUrlPath: "/assets/",
    });

    // Handlers should have been added
    expect(process.listenerCount("SIGINT")).toBe(sigintBefore + 1);
    expect(process.listenerCount("SIGTERM")).toBe(sigtermBefore + 1);

    handle.close();

    // Handlers should have been removed
    expect(process.listenerCount("SIGINT")).toBe(sigintBefore);
    expect(process.listenerCount("SIGTERM")).toBe(sigtermBefore);

    // Prevent afterEach from calling close() again on an already-closed handle
    serveHandle = null;
  }, 10000);
});
