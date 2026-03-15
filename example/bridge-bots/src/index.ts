// Install DOM polyfills BEFORE importing the bridge, which transitively
// imports @mml-io/mml-web (MElement extends HTMLElement at module load time).
import { installNodePolyfills } from "@mml-io/3d-web-experience-bridge/node-polyfills";
installNodePolyfills();

// Dynamic imports — these must come AFTER polyfills are installed.
const fs = await import("fs");
const path = await import("path");
const url = await import("url");
const { startBridge } = await import("@mml-io/3d-web-experience-bridge");
type BridgeHandle = Awaited<ReturnType<typeof startBridge>>;
const { AnonymousAuthenticator, Networked3dWebExperienceServer } = await import(
  "@mml-io/3d-web-experience-server"
);
const expressModule = await import("express");
const express = expressModule.default;

const dirname = url.fileURLToPath(new URL(".", import.meta.url));
const PORT = 9080;
const DEBUG = !!process.env.DEBUG;

// ---------------------------------------------------------------------------
// Waypoints for each bot
// ---------------------------------------------------------------------------
type Pos = { x: number; y: number; z: number };

// Waypoints form a star/cross pattern — each leg crosses the center
// diagonally, forcing the navmesh to route around the central building
// (x: 6-14, z: -3 to 3) and side walls. Clickable cubes sit near each
// waypoint for the bots to interact with on arrival.
const ALPHA_WAYPOINTS: Pos[] = [
  { x: 2, y: 0, z: 8 },
  { x: 18, y: 0, z: -8 },
  { x: 2, y: 0, z: -8 },
  { x: 18, y: 0, z: 8 },
];

const BETA_WAYPOINTS: Pos[] = [
  { x: 18, y: 0, z: 8 },
  { x: 2, y: 0, z: -8 },
  { x: 18, y: 0, z: -8 },
  { x: 2, y: 0, z: 8 },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function fetchJson(port: number, urlPath: string): Promise<any> {
  const res = await fetch(`http://localhost:${port}${urlPath}`);
  if (!res.ok) throw new Error(`GET ${urlPath} → ${res.status}`);
  return res.json();
}

async function postJson(port: number, urlPath: string, body: any): Promise<any> {
  const res = await fetch(`http://localhost:${port}${urlPath}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${urlPath} → ${res.status}`);
  return res.json();
}

function parseToolResult(body: any): any {
  return JSON.parse(body.content[0].text);
}

function xzDistance(a: Pos, b: Pos): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}

async function waitForHealthy(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const health = await fetchJson(port, "/health");
      if (health.connected) return;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Bridge on port ${port} not healthy within ${timeoutMs}ms`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// 1. Start the experience server
// ---------------------------------------------------------------------------

const defaultAvatars = [
  { meshFileUrl: "/assets/models/avatar-1-bodyA-skin01.glb" },
  { meshFileUrl: "/assets/models/avatar-2-bodyB-skin03.glb" },
  { meshFileUrl: "/assets/models/avatar-3-bodyA-skin05.glb" },
  { meshFileUrl: "/assets/models/avatar-4-bodyB-skin07.glb" },
];
const authenticator = new AnonymousAuthenticator({
  defaultCharacterDescriptions: defaultAvatars,
});
const mmlDocumentsDirectoryRoot = path.resolve(dirname, "../mml-documents");

// Reuse the multi-user example's built web client so browsers can connect
const webClientBuildDir = path.resolve(
  dirname,
  "../../multi-user-3d-web-experience/client/build",
);
const indexContent = fs.readFileSync(path.join(webClientBuildDir, "index.html"), "utf8");

const app = express();
app.enable("trust proxy");

// Bot-auth endpoint (the bridge POSTs here to get a session token)
app.post("/api/v1/bot-auth", async (_req, res) => {
  const token = await authenticator.generateAuthorizedSessionToken();
  res.json({ token });
});

const experienceServer = new Networked3dWebExperienceServer({
  networkPath: "/network",
  userAuthenticator: authenticator,
  webClientServing: {
    indexUrl: "/",
    indexContent,
    clientBuildDir: webClientBuildDir,
    clientUrl: "/web-client/",
  },
  mmlServing: {
    documentsWatchPath: "**/*.html",
    documentsDirectoryRoot: mmlDocumentsDirectoryRoot,
    documentsUrl: "/mml-documents/",
  },
  assetServing: {
    assetsDir: path.resolve(dirname, "../../assets/"),
    assetsUrl: "/assets/",
  },
  worldConfig: {
    // Key must match the filename on disk — the bridge constructs WebSocket
    // URLs from the key, and MMLDocumentsServer looks up documents by filename.
    mmlDocuments: { "playground.html": { url: "ws:///mml-documents/playground.html" } },
    spawnConfiguration: {
      spawnPosition: { x: 0, y: 0, z: 0 },
    },
    avatarConfiguration: {
      allowCustomAvatars: true,
      availableAvatars: [
        { name: "Avatar 1", meshFileUrl: "/assets/models/avatar-1-bodyA-skin01.glb" },
        { name: "Avatar 2", meshFileUrl: "/assets/models/avatar-2-bodyB-skin03.glb" },
        { name: "Avatar 3", meshFileUrl: "/assets/models/avatar-3-bodyA-skin05.glb" },
        { name: "Avatar 4", meshFileUrl: "/assets/models/avatar-4-bodyB-skin07.glb" },
      ],
    },
    enableChat: true,
  },
});
experienceServer.registerExpressRoutes(app);

// ---------------------------------------------------------------------------
// 2. Main (async entry point)
// ---------------------------------------------------------------------------

const bridges: BridgeHandle[] = [];

async function main() {
  console.log(`[orchestrator] Starting server on port ${PORT}...`);
  app.listen(PORT);
  console.log(`[orchestrator] Server listening on http://localhost:${PORT}`);

  // Start bridges in-process
  const serverUrl = `http://localhost:${PORT}`;

  if (DEBUG) console.log("[orchestrator] Starting bridge for Alpha on port 9101...");
  const alpha = await startBridge({
    serverUrl,
    bridgePort: 9101,
    botName: "Alpha",
    authUrl: `${serverUrl}/api/v1/bot-auth`,
  });
  bridges.push(alpha);
  if (DEBUG) console.log("[orchestrator] Alpha bridge started");

  if (DEBUG) console.log("[orchestrator] Starting bridge for Beta on port 9102...");
  const beta = await startBridge({
    serverUrl,
    bridgePort: 9102,
    botName: "Beta",
    authUrl: `${serverUrl}/api/v1/bot-auth`,
  });
  bridges.push(beta);
  if (DEBUG) console.log("[orchestrator] Beta bridge started");

  // Wait for both bots to be healthy
  if (DEBUG) console.log("[orchestrator] Waiting for bots to connect...");
  await waitForHealthy(9101, 60_000);
  if (DEBUG) console.log("[orchestrator] Alpha is connected");
  await waitForHealthy(9102, 60_000);
  if (DEBUG) console.log("[orchestrator] Beta is connected");

  // Collect bot client IDs so we can resolve their server-assigned usernames
  const alphaHealth = await fetchJson(9101, "/health");
  const betaHealth = await fetchJson(9102, "/health");
  const botConnectionIds = new Set<number>([alphaHealth.connectionId, betaHealth.connectionId]);
  if (DEBUG) console.log(`[orchestrator] Bot connection IDs: ${[...botConnectionIds].join(", ")}`);

  // Give the navmesh time to generate
  if (DEBUG) console.log("[orchestrator] Waiting for navmesh generation...");
  await sleep(5000);

  // Run both bot loops concurrently
  if (DEBUG) console.log("[orchestrator] Starting bot patrol loops...");
  Promise.all([
    runBotLoop("Alpha", 9101, ALPHA_WAYPOINTS, botConnectionIds),
    runBotLoop("Beta", 9102, BETA_WAYPOINTS, botConnectionIds),
  ]).catch((err) => {
    console.error("[orchestrator] Bot loop error:", err);
    shutdown();
  });
}

// ---------------------------------------------------------------------------
// 3. Bot loop
// ---------------------------------------------------------------------------

async function runBotLoop(
  botName: string,
  port: number,
  waypoints: Pos[],
  botConnectionIds: Set<number>,
): Promise<void> {
  let waypointIndex = 0;
  let lastTimestamp = Date.now();

  while (true) {
    const target = waypoints[waypointIndex % waypoints.length];
    if (DEBUG)
      console.log(
        `[${botName}] Navigating to waypoint ${waypointIndex % waypoints.length}: (${target.x}, ${target.z})`,
      );

    // Try navigate_to (pathfinding), fall back to move_to (direct)
    try {
      const navResult = await postJson(port, "/tools/navigate_to", {
        x: target.x,
        y: target.y,
        z: target.z,
      });
      const navData = parseToolResult(navResult);
      if (navData.status === "error" || navData.status === "no_path") {
        if (DEBUG) console.log(`[${botName}] navigate_to failed (${navData.status}), using move_to`);
        await postJson(port, "/tools/move_to", {
          x: target.x,
          y: target.y,
          z: target.z,
        });
      }
    } catch (err: any) {
      if (DEBUG) console.log(`[${botName}] navigate_to error: ${err.message}, using move_to`);
      try {
        await postJson(port, "/tools/move_to", {
          x: target.x,
          y: target.y,
          z: target.z,
        });
      } catch (err2: any) {
        console.error(`[${botName}] move_to also failed: ${err2.message}`);
        await sleep(3000);
        continue;
      }
    }

    // Wait for arrival, echoing chat messages along the way
    let arrived = false;
    while (!arrived) {
      try {
        const waitResult = await postJson(port, "/tools/observe", {
          timeout_seconds: 10,
          resume_from: lastTimestamp,
        });
        const waitData = parseToolResult(waitResult);
        lastTimestamp = waitData.resume_from;

        // Echo any chat messages with distance (skip messages from other bots)
        const chatEvents = (waitData.events ?? []).filter((e: any) => e.type === "chat");
        if (chatEvents.length > 0) {
          for (const chat of chatEvents) {
            try {
              const worldResult = await postJson(port, "/tools/get_scene_info", {
                include_elements: false,
              });
              const worldData = parseToolResult(worldResult);

              // Resolve bot usernames from users by matching connection IDs
              const botUsernamesNow = new Set<string>(
                (worldData.users ?? [])
                  .filter((u: any) => botConnectionIds.has(u.connectionId))
                  .map((u: any) => u.username),
              );
              if (botUsernamesNow.has(chat.from)) continue;

              const botPos = worldData.self.position;
              const sender = (worldData.users ?? []).find(
                (u: any) => u.username === chat.from,
              );
              const dist = sender
                ? Math.round(xzDistance(botPos, sender.position) * 10) / 10
                : "?";

              await postJson(port, "/tools/send_chat_message", {
                message: `Echo: ${chat.text} (${dist}m away)`,
              });
              if (DEBUG)
                console.log(
                  `[${botName}] Echoed "${chat.text}" from ${chat.from} (${dist}m)`,
                );
            } catch (err: any) {
              console.error(`[${botName}] Error echoing chat: ${err.message}`);
            }
          }
        }

        arrived = waitData.trigger === "arrival" || waitData.trigger === "stuck";
      } catch (err: any) {
        console.error(`[${botName}] observe error: ${err.message}`);
        arrived = true; // break out on error
      }
    }

    // Arrived at waypoint — interact with nearby elements
    if (DEBUG) console.log(`[${botName}] Arrived at waypoint ${waypointIndex % waypoints.length}`);
    try {
      const sceneResult = await postJson(port, "/tools/get_scene_info", { radius: 5 });
      const sceneData = parseToolResult(sceneResult);

      const clickables = (sceneData.elements ?? []).filter(
        (e: any) => e.categories?.includes("clickable"),
      );
      if (clickables.length > 0) {
        for (const el of clickables) {
          try {
            await postJson(port, "/tools/click", { node_id: el.nodeId });
            if (DEBUG) console.log(`[${botName}] Clicked ${el.tag} (node ${el.nodeId})`);
          } catch (err: any) {
            console.error(`[${botName}] Click error: ${err.message}`);
          }
        }
      }
    } catch (err: any) {
      console.error(`[${botName}] get_scene_info error: ${err.message}`);
    }

    await sleep(2000);
    waypointIndex++;
  }
}

// ---------------------------------------------------------------------------
// 4. Shutdown
// ---------------------------------------------------------------------------

let shuttingDown = false;

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("\n[orchestrator] Shutting down...");

  experienceServer.dispose();
  await Promise.all(bridges.map((b) => b.close()));

  process.exit(0);
}

process.on("SIGINT", () => shutdown());
process.on("SIGTERM", () => shutdown());

main().catch((err) => {
  console.error("[orchestrator] Fatal error:", err);
  shutdown();
});
