import {
  CollisionsManager,
  type SpawnConfiguration,
  getSpawnData,
  normalizeSpawnConfiguration,
} from "@mml-io/3d-web-client-core";
import { WorldConnection } from "@mml-io/3d-web-experience-client";
import {
  experienceClientSubProtocols,
  type SessionConfigPayload,
  type WorldConfigPayload,
} from "@mml-io/3d-web-experience-protocol";
import type { CharacterDescription } from "@mml-io/3d-web-user-networking";
// eslint-disable-next-line import/no-unresolved
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
// eslint-disable-next-line import/no-unresolved
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import WebSocket from "ws";

import { AvatarController } from "./AvatarController";
import { HeadlessMMLScene } from "./HeadlessMMLScene";
import { debug } from "./logger";
import { getNavMeshDebugPage } from "./NavMeshDebugPage";
import { NavMeshManager } from "./NavMeshManager";
import { EventBuffer } from "./tools/EventBuffer";
import { loadTools, type ToolContext, type ToolDefinition } from "./tools/registry";
import { WebhookEmitter } from "./WebhookEmitter";

export { WorldConnection } from "@mml-io/3d-web-experience-client";
export { AvatarController } from "./AvatarController";
export { HeadlessMMLScene } from "./HeadlessMMLScene";
export { NavMeshManager } from "./NavMeshManager";
export { WebhookEmitter } from "./WebhookEmitter";
export { GeometryCache } from "./GeometryCache";
export { findSurfaceSpots } from "./SurfaceAnalyzer";
export type { SurfaceSpot, SurfaceSpotOptions } from "./SurfaceAnalyzer";
export { getNavMeshDebugPage } from "./NavMeshDebugPage";
export type { PlacementSpot } from "./NavMeshManager";
export { ProgrammaticInputProvider } from "./ProgrammaticInputProvider";
export { HeadlessCameraManager } from "./HeadlessCameraManager";
export { createCollisionMesh } from "./ColliderUtils";
export { loadTools } from "./tools/registry";
export type { ToolContext, ToolDefinition, ToolResult } from "./tools/registry";

export type BridgeConfig = {
  /** Base URL of the experience server (e.g. "http://localhost:8080") */
  serverUrl: string;
  /** Port for the bridge's HTTP/MCP server */
  bridgePort: number;
  /** Display name for the bot */
  botName: string;
  /**
   * Identity token (JWT) to present to the experience server.
   * The bridge authenticates via the same URL path as a browser: it GETs
   * the server URL with `?token=<identityToken>` and `Accept: application/json`,
   * receiving the session token as JSON. This works with any authenticator
   * (webhook, remote auth server, etc.) without the bridge needing to know
   * which one is configured.
   */
  identityToken: string;
  /** Character description for the avatar */
  characterDescription?: CharacterDescription | null;
  /** Webhook configuration (optional) */
  webhook?: {
    url: string;
    token?: string;
    events?: string[];
    batchMs?: number;
  };
  /** Single MML document to load (overrides fetching from server config) */
  mmlDocument?: string;
  /** Spawn configuration (overrides server-provided config) */
  spawnConfiguration?: SpawnConfiguration;
  /** Called when the server pushes a world config update */
  onWorldConfig?: (config: WorldConfigPayload) => void;
  /** Called when the server sends a session config (e.g., auth token for MML documents) */
  onSessionConfig?: (config: SessionConfigPayload) => void;
  /** Called when the server sends a broadcast message */
  onServerBroadcast?: (broadcastType: string, payload: any) => void;
  /**
   * API key required to access bridge HTTP endpoints (tools, MCP, status).
   * When set, requests must include `Authorization: Bearer <apiKey>`.
   * Health endpoint remains unauthenticated.
   */
  apiKey?: string;
  /**
   * Enable debug endpoints for navmesh visualization.
   * When true, serves GET /navmesh, /navmesh-stream (SSE), /navmesh-debug (viewer).
   */
  enableDebug?: boolean;
};

export type BridgeHandle = {
  /** Gracefully shut down the bridge */
  close: () => Promise<void>;
};

async function obtainAuthToken(config: BridgeConfig): Promise<string> {
  // Authenticate via the same URL path as a browser: GET the index URL with ?token=<identityToken>.
  // The Accept header tells the server to return JSON instead of HTML.
  const pageUrl = `${config.serverUrl}/?token=${encodeURIComponent(config.identityToken)}`;
  debug(`[bridge] Authenticating via identity token: ${config.serverUrl}/?token=...`);
  const authAbort = new AbortController();
  const authTimeout = setTimeout(() => authAbort.abort(), 15_000);
  let authRes: Response;
  try {
    authRes = await fetch(pageUrl, {
      headers: { Accept: "application/json" },
      redirect: "manual",
      signal: authAbort.signal,
    });
  } finally {
    clearTimeout(authTimeout);
  }
  if (authRes.status >= 300 && authRes.status < 400) {
    const location = authRes.headers.get("location") ?? "(unknown)";
    throw new Error(
      `Identity token auth requires interactive login (redirect to ${location}). ` +
        `Check that the identity token is valid and the auth server is configured correctly.`,
    );
  }
  if (!authRes.ok) {
    throw new Error(`Identity token auth failed: ${authRes.status}`);
  }
  let body: unknown;
  try {
    body = await authRes.json();
  } catch {
    throw new Error("Identity token auth returned non-JSON response");
  }
  if (
    typeof body !== "object" ||
    body === null ||
    typeof (body as Record<string, unknown>).sessionToken !== "string"
  ) {
    throw new Error(
      `Auth response missing "sessionToken" field. Got: ${JSON.stringify(body).substring(0, 200)}`,
    );
  }
  debug("[bridge] Got session token via identity token");
  return (body as Record<string, string>).sessionToken;
}

async function connectToWorld(
  config: BridgeConfig,
  token: string,
): Promise<{ worldConnection: WorldConnection; worldConfig: WorldConfigPayload | null }> {
  const wsUrl = config.serverUrl.replace(/^http/, "ws") + "/network";
  const worldConnection = new WorldConnection({
    url: wsUrl,
    sessionToken: token,
    websocketFactory: (url: string) =>
      new WebSocket(url, [...experienceClientSubProtocols]) as unknown as globalThis.WebSocket,
    initialUserState: {
      userId: "",
      username: config.botName,
      characterDescription: config.characterDescription ?? null,
      colors: null,
    },
  });
  const connectionTimeout = 30_000;
  const connected = await Promise.race([
    worldConnection.waitForConnection().then(() => true),
    new Promise<false>((resolve) => setTimeout(() => resolve(false), connectionTimeout)),
  ]);
  if (!connected) {
    throw new Error(`Failed to connect to ${wsUrl} within ${connectionTimeout / 1000}s`);
  }

  // Wait briefly for world config (pushed over WebSocket right after auth).
  // Use a short timeout — if it doesn't arrive quickly, proceed without it.
  // The world event listener will pick it up when it arrives.
  const worldConfig = await worldConnection.waitForWorldConfig(2000);
  if (worldConfig) {
    debug("[bridge] Received world config from server");
  } else {
    debug("[bridge] World config not received within 2s — proceeding, will apply when it arrives");
  }

  return { worldConnection, worldConfig };
}

type NavmeshWatcherHandle = {
  navmeshSetupPromise: Promise<void>;
  cleanup: () => void;
};

function setupNavmeshWatcher(
  headlessScene: HeadlessMMLScene,
  avatarController: AvatarController,
  navMeshManager: NavMeshManager,
): NavmeshWatcherHandle {
  let sceneChangeListener: ((changes: string[]) => void) | null = null;
  let regionCheckListener: (() => void) | null = null;
  let isRegeneratingNavmesh = false;

  const navmeshSetupPromise = (async () => {
    try {
      const ready = await headlessScene.waitForSceneReady(30000);
      if (ready) {
        const success = await navMeshManager.generateFromScene(
          headlessScene.scene,
          avatarController.getPosition(),
        );
        if (success) {
          debug("[bridge] NavMesh ready for pathfinding");
        } else {
          console.warn("[bridge] NavMesh generation failed — pathfinding unavailable");
        }
      } else {
        console.warn("[bridge] Scene not ready — navmesh not generated");
      }

      sceneChangeListener = async (changes) => {
        if (isRegeneratingNavmesh) return;
        const geometryRelevant = changes.some(
          (c) => c === "elements_added" || c === "elements_removed" || c === "geometry_changed",
        );
        if (!geometryRelevant) return;

        isRegeneratingNavmesh = true;
        try {
          const pos = avatarController.getPosition();
          debug(`[bridge] Scene geometry changed (${changes.join(", ")}), regenerating navmesh…`);
          const ok = await navMeshManager.regenerate(headlessScene.scene, pos);
          debug(ok ? "[bridge] NavMesh regenerated" : "[bridge] NavMesh regeneration failed");
        } catch (err) {
          console.error("[bridge] Error regenerating navmesh on scene change:", err);
        } finally {
          isRegeneratingNavmesh = false;
        }
      };
      headlessScene.onSceneChanged(sceneChangeListener);

      let lastRegionCheck = 0;
      regionCheckListener = async () => {
        if (isRegeneratingNavmesh) return;
        const now = Date.now();
        if (now - lastRegionCheck < 2000) return;
        lastRegionCheck = now;
        const pos = avatarController.getPosition();
        if (!navMeshManager.shouldRegenerate(pos)) return;

        isRegeneratingNavmesh = true;
        try {
          debug(`[bridge] Avatar moved far from navmesh region center, regenerating…`);
          const ok = await navMeshManager.regenerate(headlessScene.scene, pos);
          debug(
            ok
              ? "[bridge] NavMesh regenerated for new region"
              : "[bridge] NavMesh regeneration failed",
          );
        } catch (err) {
          console.error("[bridge] Error during region check navmesh regeneration:", err);
        } finally {
          isRegeneratingNavmesh = false;
        }
      };
      avatarController.on("positionUpdate", regionCheckListener);
    } catch (err) {
      console.error("[bridge] Error setting up scene/navmesh:", err);
    }
  })();

  return {
    navmeshSetupPromise,
    cleanup: () => {
      if (sceneChangeListener) headlessScene.offSceneChanged(sceneChangeListener);
      if (regionCheckListener) avatarController.off("positionUpdate", regionCheckListener);
    },
  };
}

function createMcpServer(tools: Map<string, any>, toolCtx: ToolContext): McpServer {
  const server = new McpServer({
    name: "3d-web-experience-bridge",
    version: "0.1.0",
  });
  for (const [name, tool] of tools) {
    const schema = tool.inputSchema;
    if (!("shape" in schema) || typeof schema.shape !== "object" || schema.shape === null) {
      console.warn(`[mcp] Skipping tool "${name}": inputSchema is not a Zod object schema`);
      continue;
    }
    const shape = schema.shape as Record<string, any>;
    server.tool(name, tool.description, shape, async (params: any) => {
      return await tool.execute(params, toolCtx);
    });
  }
  return server;
}

function setupHttpServer(
  config: BridgeConfig,
  toolCtx: ToolContext,
  tools: Map<string, any>,
): express.Application {
  const app = express();
  app.use(express.json());

  if (!config.apiKey) {
    console.warn(
      "[bridge] WARNING: No apiKey configured — all tool, MCP, and status endpoints are unauthenticated. " +
        "Set apiKey in BridgeConfig or the BRIDGE_API_KEY environment variable.",
    );
  }

  const requireAuth: express.RequestHandler = (req, res, next) => {
    if (!config.apiKey) {
      next();
      return;
    }
    const authHeader = req.headers.authorization;
    if (!authHeader || authHeader !== `Bearer ${config.apiKey}`) {
      res.status(401).json({ error: "Unauthorized: invalid or missing API key" });
      return;
    }
    next();
  };

  const { worldConnection, avatarController, headlessScene, navMeshManager } = toolCtx;

  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      connected: worldConnection.isConnected(),
      connectionId: worldConnection.getConnectionId(),
    });
  });

  app.get("/status", requireAuth, (_req, res) => {
    const pos = avatarController.getPosition();
    const others = worldConnection.getOtherUsers();
    res.json({
      connected: worldConnection.isConnected(),
      connectionId: worldConnection.getConnectionId(),
      position: pos,
      isMoving: avatarController.isMoving(),
      otherUsers: others.length,
      sceneLoaded: headlessScene?.isLoaded ?? false,
      navmeshReady: navMeshManager?.isReady ?? false,
      navmeshRegionCenter: navMeshManager?.currentRegionCenter ?? null,
      colliderCount: headlessScene?.colliderCount ?? 0,
      meshCount: headlessScene?.countMeshes() ?? 0,
    });
  });

  app.get("/tools", requireAuth, (_req, res) => {
    const list: Array<{ name: string; description: string; parameters: Record<string, unknown> }> =
      [];
    for (const [name, tool] of tools) {
      const params: Record<string, unknown> = {};
      const schema = tool.inputSchema;
      if ("shape" in schema && typeof schema.shape === "object" && schema.shape !== null) {
        const shape = schema.shape as Record<string, any>;
        for (const [key, zodType] of Object.entries(shape)) {
          params[key] = {
            description: zodType?.description ?? zodType?._def?.description,
            required: !zodType?.isOptional?.(),
          };
        }
      }
      list.push({ name, description: tool.description, parameters: params });
    }
    res.json({ tools: list });
  });

  let shutdownFn: (() => Promise<void>) | null = null;

  app.post("/shutdown", requireAuth, async (_req, res) => {
    res.json({ status: "shutting_down" });
    if (shutdownFn) {
      await shutdownFn();
    }
  });

  /** Allow the caller to wire up the shutdown function after server.listen(). */
  (app as any)._setShutdownFn = (fn: () => Promise<void>) => {
    shutdownFn = fn;
  };

  // Track the active observe request so a new one can abort the previous
  let activeObserveAbort: AbortController | null = null;

  app.post("/tools/:name", requireAuth, async (req, res) => {
    const tool = tools.get(req.params.name);
    if (!tool) {
      res.status(404).json({ error: `Unknown tool: ${req.params.name}` });
      return;
    }
    try {
      const parsed = tool.inputSchema.parse(req.body);

      let signal: AbortSignal | undefined;
      if (req.params.name === "observe") {
        // Abort any previous observe that is still pending
        if (activeObserveAbort) {
          activeObserveAbort.abort();
        }
        const ac = new AbortController();
        activeObserveAbort = ac;
        signal = ac.signal;

        // Clean up when this request finishes (whether normally or via abort)
        res.on("close", () => {
          if (activeObserveAbort === ac) {
            activeObserveAbort = null;
          }
        });
      }

      const result = await tool.execute(parsed, toolCtx, signal);
      res.json(result);
    } catch (err: any) {
      const status = err?.name === "ZodError" ? 400 : 500;
      console.error(`[tools] Error executing ${req.params.name}:`, err);
      res.status(status).json({ error: err.message });
    }
  });

  const MCP_REQUEST_TIMEOUT_MS = 30_000;
  app.post("/mcp", requireAuth, async (req, res) => {
    let transport: StreamableHTTPServerTransport | null = null;
    let mcpServer: McpServer | null = null;
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      try {
        mcpServer?.close();
      } catch (e) {
        console.error("[mcp] Error closing server:", e);
      }
      try {
        transport?.close();
      } catch (e) {
        console.error("[mcp] Error closing transport:", e);
      }
    };
    try {
      transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      mcpServer = createMcpServer(tools, toolCtx);
      const timer = setTimeout(cleanup, MCP_REQUEST_TIMEOUT_MS);
      res.on("close", () => {
        clearTimeout(timer);
        cleanup();
      });
      await mcpServer.connect(transport);
      await transport.handleRequest(req, res, req.body);
      clearTimeout(timer);
    } catch (err) {
      console.error("[mcp] Error handling POST /mcp:", err);
      cleanup();
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });

  app.get("/mcp", (_req, res) => {
    res.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed. Use POST." },
      id: null,
    });
  });

  app.delete("/mcp", (_req, res) => {
    res.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed." },
      id: null,
    });
  });

  // Debug endpoints (behind enableDebug flag)
  if (config.enableDebug) {
    app.get("/navmesh", requireAuth, (_req, res) => {
      const debugData = navMeshManager?.getDebugData();
      if (!debugData) {
        res.status(503).json({ error: "NavMesh not available" });
        return;
      }
      res.json(debugData);
    });

    // SSE stream for real-time debug data (agent position, navmesh updates)
    app.get("/navmesh-stream", requireAuth, (req, res) => {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders();

      let closed = false;
      req.on("close", () => {
        closed = true;
      });

      const sendEvent = (event: string, data: any) => {
        if (closed) return;
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      // Send initial navmesh data
      const debugData = navMeshManager?.getDebugData();
      if (debugData) {
        sendEvent("navmesh", debugData);
      }

      // Periodic updates
      const interval = setInterval(() => {
        if (closed) {
          clearInterval(interval);
          return;
        }

        // Agent state
        const pos = avatarController.getPosition();
        sendEvent("agent", {
          position: pos,
          isMoving: avatarController.isMoving(),
          path: avatarController.getCurrentPath(),
          waypointIndex: avatarController.getWaypointIndex(),
        });

        // Other users
        const users = worldConnection.getOtherUsers().map((u: any) => ({
          id: u.connectionId ?? u.id,
          username: u.username,
          position: u.position,
        }));
        sendEvent("users", users);
      }, 500);

      // Navmesh updates on regeneration
      const navmeshListener = () => {
        if (closed) return;
        const data = navMeshManager?.getDebugData();
        if (data) {
          sendEvent("navmesh", data);
        }
      };
      navMeshManager?.on("ready", navmeshListener);

      req.on("close", () => {
        clearInterval(interval);
        navMeshManager?.off("ready", navmeshListener);
      });
    });

    app.get("/navmesh-debug", (_req, res) => {
      res.setHeader("Content-Type", "text/html");
      res.send(getNavMeshDebugPage());
    });

    debug("[bridge] Debug endpoints enabled: /navmesh, /navmesh-stream, /navmesh-debug");
  }

  return app;
}

export type BridgeCoreHandle = {
  worldConnection: WorldConnection;
  avatarController: AvatarController;
  headlessScene: HeadlessMMLScene;
  navMeshManager: NavMeshManager;
  tools: Map<string, ToolDefinition>;
  toolCtx: ToolContext;
  cleanup: () => Promise<void>;
};

export async function createBridgeCore(config: BridgeConfig): Promise<BridgeCoreHandle> {
  // 1. Authenticate
  const token = await obtainAuthToken(config);

  // 2. Connect to the world
  const { worldConnection, worldConfig } = await connectToWorld(config, token);

  // 3. Set up avatar with spawn config
  const spawnConfig =
    config.spawnConfiguration ??
    (worldConfig?.spawnConfiguration as SpawnConfiguration | undefined);
  const spawnConfiguration = normalizeSpawnConfiguration(spawnConfig);
  const spawnData = getSpawnData(spawnConfiguration, false);

  const collisionsManager = new CollisionsManager();
  const avatarController = new AvatarController(collisionsManager, spawnConfig);
  avatarController.teleport(
    spawnData.spawnPosition.x,
    spawnData.spawnPosition.y,
    spawnData.spawnPosition.z,
  );

  avatarController.on("positionUpdate", (update) => {
    worldConnection.sendUpdate(update);
  });

  // Set up webhook push (if configured)
  let webhookEmitter: WebhookEmitter | null = null;
  if (config.webhook) {
    webhookEmitter = await WebhookEmitter.create(
      {
        url: config.webhook.url,
        token: config.webhook.token,
        events: config.webhook.events,
        batchMs: config.webhook.batchMs ?? 2000,
      },
      worldConnection,
      avatarController,
    );
  }

  // 4. Set up headless MML scene
  const headlessScene = new HeadlessMMLScene(() => {
    const pos = avatarController.getPosition();
    return { position: pos, rotation: { x: 0, y: 0, z: 0 } };
  }, collisionsManager);

  const initialGroundPlane =
    (worldConfig?.environmentConfiguration as { groundPlane?: boolean } | undefined)?.groundPlane ??
    true;
  if (initialGroundPlane) {
    headlessScene.registerGroundPlaneCollider();
    debug("[bridge] Ground plane collider registered");
  } else {
    debug("[bridge] Ground plane disabled by world config");
  }

  const navMeshManager = new NavMeshManager();
  avatarController.setNavMeshManager(navMeshManager);

  // Connect to MML documents
  const wsBase = config.serverUrl.replace(/^http/, "ws");
  if (config.mmlDocument) {
    const mmlWsUrl = `${wsBase}/mml-documents/${config.mmlDocument}`;
    headlessScene.connectToDocument(mmlWsUrl);
    debug(`[bridge] Loading single document: ${config.mmlDocument}`);
  } else if (worldConfig?.mmlDocuments) {
    headlessScene.setMMLDocuments(worldConfig.mmlDocuments, wsBase);
    const docNames = Object.keys(worldConfig.mmlDocuments);
    debug(
      `[bridge] Loading ${docNames.length} documents from world config: ${docNames.join(", ")}`,
    );
  } else {
    console.warn("[bridge] No MML documents configured");
  }
  headlessScene.startTicking();

  const applyGroundPlaneConfig = (envConfig: Record<string, unknown> | undefined) => {
    if (!envConfig || typeof envConfig !== "object") return;
    if ("groundPlane" in envConfig) {
      const enabled = envConfig.groundPlane ?? true;
      if (enabled && !headlessScene.hasGroundPlaneCollider) {
        headlessScene.registerGroundPlaneCollider();
        debug("[bridge] Ground plane collider enabled by config update");
      } else if (!enabled && headlessScene.hasGroundPlaneCollider) {
        headlessScene.unregisterGroundPlaneCollider();
        debug("[bridge] Ground plane collider disabled by config update");
      }
    }
  };

  // Listen for subsequent world config pushes
  const worldEventListener = (event: { type: string; [key: string]: any }) => {
    if (event.type === "session_config") {
      config.onSessionConfig?.(event.config);
    } else if (event.type === "world_config") {
      if (!event.config || typeof event.config !== "object") {
        console.warn("[bridge] Received world_config event with invalid config, skipping");
        return;
      }
      if (event.config.spawnConfiguration && typeof event.config.spawnConfiguration === "object") {
        avatarController.updateSpawnConfig(event.config.spawnConfiguration as SpawnConfiguration);
        debug("[bridge] Updated spawn config from server push");
      }
      if (!config.mmlDocument && event.config.mmlDocuments) {
        headlessScene.setMMLDocuments(event.config.mmlDocuments, wsBase);
        debug(
          `[bridge] Updated MML documents from server push: ${Object.keys(event.config.mmlDocuments).join(", ") || "(none)"}`,
        );
      }
      applyGroundPlaneConfig(event.config.environmentConfiguration);
      toolCtx.worldConfig = event.config as Record<string, unknown>;
      config.onWorldConfig?.(event.config);
    } else if (event.type === "server_broadcast") {
      if (event.broadcastType === "world-config-update" && !config.mmlDocument) {
        const payload = event.payload;
        if (!payload || typeof payload !== "object") {
          console.warn(
            "[bridge] Received world-config-update broadcast with invalid payload, skipping",
          );
        } else {
          if (payload.spawnConfiguration && typeof payload.spawnConfiguration === "object") {
            avatarController.updateSpawnConfig(payload.spawnConfiguration as SpawnConfiguration);
            debug("[bridge] Updated spawn config from world-config-update broadcast");
          }
          if (payload.mmlDocuments) {
            headlessScene.setMMLDocuments(payload.mmlDocuments, wsBase);
            debug(
              `[bridge] Updated MML documents from world-config-update broadcast: ${Object.keys(payload.mmlDocuments).join(", ") || "(none)"}`,
            );
          }
          applyGroundPlaneConfig(payload.environmentConfiguration);
          toolCtx.worldConfig = payload as Record<string, unknown>;
          config.onWorldConfig?.(payload);
        }
      }
      config.onServerBroadcast?.(event.broadcastType, event.payload);
    }
  };

  // 5. Set up navmesh with scene change watching
  const navmeshWatcher = setupNavmeshWatcher(headlessScene, avatarController, navMeshManager);

  // 6. Load tools
  const tools = loadTools();
  const toolCtx: ToolContext = {
    worldConnection,
    avatarController,
    headlessScene,
    navMeshManager,
    serverUrl: config.serverUrl,
    bridgePort: config.bridgePort,
    worldConfig:
      worldConfig && typeof worldConfig === "object"
        ? (worldConfig as Record<string, unknown>)
        : null,
  };
  toolCtx.eventBuffer = new EventBuffer(toolCtx);

  // Register world event listener (after toolCtx so the closure can update it)
  worldConnection.addEventListener(worldEventListener);

  const cleanup = async () => {
    debug("[bridge] Shutting down...");
    toolCtx.eventBuffer?.dispose();
    await webhookEmitter?.dispose();
    await navmeshWatcher.navmeshSetupPromise.catch((err) => {
      console.warn("[bridge] Navmesh setup error during shutdown:", err);
    });
    navmeshWatcher.cleanup();
    worldConnection.removeEventListener(worldEventListener);
    navMeshManager.dispose();
    avatarController.destroy();
    headlessScene.dispose();
    worldConnection.stop();
  };

  return {
    worldConnection,
    avatarController,
    headlessScene,
    navMeshManager,
    tools,
    toolCtx,
    cleanup,
  };
}

export async function startBridge(config: BridgeConfig): Promise<BridgeHandle> {
  debug("[bridge] Starting Experience Bridge...");

  // Start the HTTP server immediately so the bridge port is available for
  // commands while the world connection and scene are still initialising.
  // Tools that need the scene already handle the "not ready" case gracefully.
  const core = await createBridgeCore(config);
  const app = setupHttpServer(config, core.toolCtx, core.tools);

  const handle = await new Promise<BridgeHandle>((resolve) => {
    const server = app.listen(config.bridgePort, () => {
      debug(`[bridge] Experience Bridge ready on port ${config.bridgePort}`);

      const shutdown = async () => {
        await core.cleanup();
        await new Promise<void>((res) => server.close(() => res()));
      };

      // Wire up the /shutdown endpoint
      if ((app as any)._setShutdownFn) {
        (app as any)._setShutdownFn(shutdown);
      }

      const signalHandler = () => {
        // Keep the event loop alive until shutdown completes
        const keepAlive = setInterval(() => {}, 1000);
        shutdown()
          .catch((err) => {
            console.error("[bridge] Error during shutdown:", err);
          })
          .finally(() => {
            clearInterval(keepAlive);
            process.exitCode = 0;
            process.exit();
          });
      };
      process.once("SIGINT", signalHandler);
      process.once("SIGTERM", signalHandler);

      resolve({ close: shutdown });
    });
  });

  return handle;
}
