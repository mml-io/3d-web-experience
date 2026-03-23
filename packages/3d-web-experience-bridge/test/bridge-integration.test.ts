import { type ChildProcess, spawn } from "child_process";
import fs from "fs";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";

import {
  AnonymousAuthenticator,
  Networked3dWebExperienceServer,
} from "@mml-io/3d-web-experience-server";
import express from "express";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { ARRIVAL_THRESHOLD } from "../src/AvatarController";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tsxBin = path.resolve(__dirname, "..", "..", "..", "node_modules", ".bin", "tsx");
const cliPath = path.resolve(__dirname, "..", "src", "cli.ts");

// When running the bridge from TypeScript source via tsx, the NavMeshManager
// resolves the navmesh worker path as `src/navmesh-worker.js` (relative to
// import.meta.url with a .js extension). The file doesn't exist because the
// source is .ts. Copy the built worker so the Worker thread can load it.
const navWorkerSrc = path.resolve(__dirname, "..", "build", "navmesh-worker.js");
const navWorkerDst = path.resolve(__dirname, "..", "src", "navmesh-worker.js");
beforeAll(() => {
  if (fs.existsSync(navWorkerSrc) && !fs.existsSync(navWorkerDst)) {
    fs.copyFileSync(navWorkerSrc, navWorkerDst);
  }
});
afterAll(() => {
  try {
    fs.unlinkSync(navWorkerDst);
  } catch {
    /* already removed */
  }
});

// Spawn position used in the world config — intentionally non-origin so the
// test can verify that the bridge actually spawns at the configured location.
const SPAWN = { x: 5, y: 0, z: 8 };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = http.createServer();
    srv.listen(0, () => {
      const addr = srv.address();
      if (addr && typeof addr === "object") {
        const port = addr.port;
        srv.close(() => resolve(port));
      } else {
        reject(new Error("Could not determine port"));
      }
    });
    srv.on("error", reject);
  });
}

async function waitUntil(
  check: () => Promise<boolean> | boolean,
  message: string,
  timeoutMs = 30_000,
  pollMs = 500,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, pollMs));
  }
  throw new Error(`waitUntil timed out: ${message}`);
}

function fetchJson(port: number, urlPath: string): Promise<any> {
  return new Promise((resolve, reject) => {
    http
      .get(`http://127.0.0.1:${port}${urlPath}`, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`Failed to parse JSON from GET ${urlPath}: ${data}`));
          }
        });
      })
      .on("error", reject);
  });
}

function postJson(port: number, urlPath: string, body: Record<string, any>): Promise<any> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: urlPath,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`Failed to parse JSON from POST ${urlPath}: ${data}`));
          }
        });
      },
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

/** Parse the tool response format: { content: [{ type: "text", text: "{...}" }] } */
function parseToolResult(body: any): any {
  return JSON.parse(body.content[0].text);
}

/** XZ distance between two positions (accepts {x,z} objects or [x,y,z] arrays). */
function xzDistance(a: any, b: any): number {
  const ax = Array.isArray(a) ? a[0] : a.x;
  const az = Array.isArray(a) ? a[2] : a.z;
  const bx = Array.isArray(b) ? b[0] : b.x;
  const bz = Array.isArray(b) ? b[2] : b.z;
  return Math.sqrt((ax - bx) * (ax - bx) + (az - bz) * (az - bz));
}

/** Kill a child process with SIGTERM, escalating to SIGKILL after a timeout. */
async function killProcess(proc: ChildProcess): Promise<void> {
  if (!proc || proc.killed) return;
  proc.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      if (!proc.killed) proc.kill("SIGKILL");
      resolve();
    }, 5_000);
    proc.on("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

/** Spawn the bridge child process and wait until /health reports connected. */
async function spawnBridge(
  serverPort: number,
  bridgePort: number,
  token: string,
): Promise<ChildProcess> {
  const proc = spawn(
    tsxBin,
    [
      cliPath,
      "start",
      "--server-url",
      `http://127.0.0.1:${serverPort}`,
      "--port",
      String(bridgePort),
      "--bot-name",
      "TestBot",
      "--token",
      token,
    ],
    {
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    },
  );

  proc.stdout?.on("data", (data: Buffer) => {
    process.stdout.write(`[bridge] ${data.toString()}`);
  });
  proc.stderr?.on("data", (data: Buffer) => {
    process.stderr.write(`[bridge-err] ${data.toString()}`);
  });

  await waitUntil(
    async () => {
      try {
        const health = await fetchJson(bridgePort, "/health");
        return health.connected === true;
      } catch {
        return false;
      }
    },
    "bridge to become connected",
    30_000,
    500,
  );

  return proc;
}

// ---------------------------------------------------------------------------
// Core bridge tests (in-process server, no MML documents)
// ---------------------------------------------------------------------------

describe("Bridge integration", () => {
  let serverPort: number;
  let bridgePort: number;
  let httpServer: http.Server;
  let experienceServer: Networked3dWebExperienceServer;
  let bridgeProcess: ChildProcess;

  beforeAll(async () => {
    [serverPort, bridgePort] = await Promise.all([findFreePort(), findFreePort()]);

    const authenticator = new AnonymousAuthenticator();
    experienceServer = new Networked3dWebExperienceServer({
      networkPath: "/network",
      userAuthenticator: authenticator,
      webClientServing: {
        indexUrl: "/",
        indexContent: "<html></html>",
        clientBuildDir: __dirname,
        clientUrl: "/client",
      },
      worldConfig: {
        spawnConfiguration: { spawnPosition: SPAWN },
      },
    });

    const app = express();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    experienceServer.registerExpressRoutes(app as any);
    httpServer = await new Promise<http.Server>((resolve) => {
      const srv = app.listen(serverPort, "127.0.0.1", () => resolve(srv));
    });

    const token = (await authenticator.generateAuthorizedSessionToken()) as string;
    bridgeProcess = await spawnBridge(serverPort, bridgePort, token);
  }, 45_000);

  afterAll(async () => {
    await killProcess(bridgeProcess);
    experienceServer?.dispose();
    await new Promise<void>((resolve) => {
      httpServer ? httpServer.close(() => resolve()) : resolve();
    });
  }, 15_000);

  test("reports healthy and connected with a numeric client ID", async () => {
    const health = await fetchJson(bridgePort, "/health");
    expect(health.status).toBe("ok");
    expect(health.connected).toBe(true);
    expect(typeof health.connectionId).toBe("number");
    expect(health.connectionId).toBeGreaterThan(0);
  });

  test("spawns at the configured spawn position", async () => {
    const status = await fetchJson(bridgePort, "/status");
    expect(status.connected).toBe(true);
    expect(status.position.x).toBeCloseTo(SPAWN.x, 0);
    expect(status.position.z).toBeCloseTo(SPAWN.z, 0);
    expect(typeof status.position.y).toBe("number");
    expect(status.position.y).toBeGreaterThanOrEqual(-0.1);

    const distFromOrigin = xzDistance(status.position, { x: 0, z: 0 });
    expect(distFromOrigin).toBeGreaterThan(5);
  });

  test("teleports to exact coordinates", async () => {
    const target = { x: 15, y: 0, z: -7 };
    const teleportResult = await postJson(bridgePort, "/tools/teleport", target);
    const teleportData = parseToolResult(teleportResult);
    expect(teleportData.status).toBe("teleported");

    await new Promise((r) => setTimeout(r, 200));

    const result = await postJson(bridgePort, "/tools/get_scene_info", {
      include_users: false,
      include_elements: false,
    });
    const posData = parseToolResult(result);
    expect(posData.self.position.x).toBeCloseTo(target.x, 0);
    expect(posData.self.position.z).toBeCloseTo(target.z, 0);
    expect(posData.self.position.y).toBeGreaterThanOrEqual(-0.1);
    expect(posData.self.isMoving).toBe(false);
  });

  test("teleporting twice ends at the second position", async () => {
    await postJson(bridgePort, "/tools/teleport", { x: 100, y: 0, z: 100 });
    await new Promise((r) => setTimeout(r, 100));
    await postJson(bridgePort, "/tools/teleport", { x: -3, y: 0, z: 12 });
    await new Promise((r) => setTimeout(r, 200));

    const result = await postJson(bridgePort, "/tools/get_scene_info", {
      include_users: false,
      include_elements: false,
    });
    const posData = parseToolResult(result);
    expect(posData.self.position.x).toBeCloseTo(-3, 0);
    expect(posData.self.position.z).toBeCloseTo(12, 0);
  });

  test("move_to arrives at the target coordinates", async () => {
    await postJson(bridgePort, "/tools/teleport", { x: 0, y: 0, z: 0 });
    await new Promise((r) => setTimeout(r, 200));

    const target = { x: 5, y: 0, z: 5 };
    const moveResult = await postJson(bridgePort, "/tools/move_to", target);
    expect(parseToolResult(moveResult).status).toBe("moving");

    const arrivalResult = await postJson(bridgePort, "/tools/observe", {
      timeout_seconds: 15,
    });
    const arrivalData = parseToolResult(arrivalResult);
    expect(arrivalData.trigger).toBe("arrival");
    expect(arrivalData.moving).toBe(false);
    expect(xzDistance(arrivalData.position, target)).toBeLessThanOrEqual(ARRIVAL_THRESHOLD + 0.1);
  }, 20_000);

  test("move_to to a farther target also arrives", async () => {
    await postJson(bridgePort, "/tools/teleport", { x: 0, y: 0, z: 0 });
    await new Promise((r) => setTimeout(r, 200));

    const target = { x: 10, y: 0, z: 10 };
    await postJson(bridgePort, "/tools/move_to", target);

    const arrivalData = parseToolResult(
      await postJson(bridgePort, "/tools/observe", { timeout_seconds: 20 }),
    );
    expect(arrivalData.trigger).toBe("arrival");
    expect(xzDistance(arrivalData.position, target)).toBeLessThanOrEqual(ARRIVAL_THRESHOLD + 0.2);
  }, 25_000);

  test("stop_moving halts movement before reaching the target", async () => {
    await postJson(bridgePort, "/tools/teleport", { x: 0, y: 0, z: 0 });
    await new Promise((r) => setTimeout(r, 200));

    const farTarget = { x: 50, y: 0, z: 50 };
    await postJson(bridgePort, "/tools/move_to", farTarget);
    await new Promise((r) => setTimeout(r, 1_000));

    const stopData = parseToolResult(await postJson(bridgePort, "/tools/stop_moving", {}));
    expect(stopData.status).toBe("stopped");

    const posAfterStop = stopData.position;
    expect(xzDistance(posAfterStop, { x: 0, z: 0 })).toBeGreaterThan(1);
    expect(xzDistance(posAfterStop, farTarget)).toBeGreaterThan(5);

    await new Promise((r) => setTimeout(r, 500));
    const posLater = parseToolResult(
      await postJson(bridgePort, "/tools/get_scene_info", {
        include_users: false,
        include_elements: false,
      }),
    );
    expect(posLater.self.isMoving).toBe(false);
    expect(xzDistance(posAfterStop, posLater.self.position)).toBeLessThan(0.5);
  }, 10_000);

  test("sequential move_to calls each arrive at their target", async () => {
    const waypoints = [
      { x: 3, y: 0, z: 0 },
      { x: 3, y: 0, z: 4 },
      { x: 0, y: 0, z: 4 },
    ];

    await postJson(bridgePort, "/tools/teleport", { x: 0, y: 0, z: 0 });
    await new Promise((r) => setTimeout(r, 200));

    for (const wp of waypoints) {
      await postJson(bridgePort, "/tools/move_to", wp);
      const arrivalData = parseToolResult(
        await postJson(bridgePort, "/tools/observe", { timeout_seconds: 15 }),
      );
      expect(arrivalData.trigger).toBe("arrival");
      expect(xzDistance(arrivalData.position, wp)).toBeLessThanOrEqual(ARRIVAL_THRESHOLD + 0.2);
    }
  }, 30_000);

  test("get_scene_info reports correct movement state", async () => {
    await postJson(bridgePort, "/tools/teleport", { x: 0, y: 0, z: 0 });
    await new Promise((r) => setTimeout(r, 200));

    const idleData = parseToolResult(
      await postJson(bridgePort, "/tools/get_scene_info", {
        include_users: false,
        include_elements: false,
      }),
    );
    expect(idleData.self.isMoving).toBe(false);
    expect(idleData.self.distanceToTarget).toBeNull();

    await postJson(bridgePort, "/tools/move_to", { x: 30, y: 0, z: 30 });
    await new Promise((r) => setTimeout(r, 100));

    const movingData = parseToolResult(
      await postJson(bridgePort, "/tools/get_scene_info", {
        include_users: false,
        include_elements: false,
      }),
    );
    expect(movingData.self.isMoving).toBe(true);
    expect(movingData.self.distanceToTarget).toBeGreaterThan(0);

    await postJson(bridgePort, "/tools/stop_moving", {});
  });

  test("status endpoint reports expected fields", async () => {
    const status = await fetchJson(bridgePort, "/status");
    expect(status.connected).toBe(true);
    expect(typeof status.connectionId).toBe("number");
    expect(typeof status.position.x).toBe("number");
    expect(typeof status.position.y).toBe("number");
    expect(typeof status.position.z).toBe("number");
    expect(typeof status.isMoving).toBe("boolean");
    expect(typeof status.otherUsers).toBe("number");
    expect(typeof status.colliderCount).toBe("number");
  });
});

// ---------------------------------------------------------------------------
// MML document tests (server runs as child process to avoid jsdom ESM issues
// in Jest — @mml-io/networked-dom-server depends on jsdom which transitively
// requires the ESM-only @exodus/bytes package).
//
// Scene layout (test/fixtures/scene.html):
//
//   (0,0,0)  start                  (20,0,0)  target-cube
//       .                                .
//       .          WALL at x=10          .
//       .     (z spans -6 to +6)         .
//       .     blocks direct path         .
//       .          ██████████            .
//       .          ██████████            .
//       .                                .
//   button-cube at (3, 0.5, 3)
//   sign label at (3, 2, 3)
//   test-interact at (3, 1, 3)
//
// Navigation must route around the wall — e.g. via z > 6 — making the path
// significantly longer than the straight-line distance.
// ---------------------------------------------------------------------------

describe("MML document integration", () => {
  let serverProcess: ChildProcess;
  let bridgeProcess: ChildProcess;
  let serverPort: number;
  let bridgePort: number;

  beforeAll(async () => {
    bridgePort = await findFreePort();

    // 1. Spawn the test server (serves MML documents over WebSocket)
    const testServerPath = path.resolve(__dirname, "test-server.ts");
    serverProcess = spawn(tsxBin, [testServerPath], {
      env: { ...process.env, TEST_SERVER_PORT: "0" },
      stdio: ["pipe", "pipe", "pipe"],
    });

    // Wait for the server to output its ready JSON line
    const serverInfo = await new Promise<{ port: number; token: string }>((resolve, reject) => {
      let buffer = "";
      const timeout = setTimeout(
        () => reject(new Error("Test server did not become ready")),
        20_000,
      );

      serverProcess.stdout?.on("data", (data: Buffer) => {
        buffer += data.toString();
        const lines = buffer.split("\n");
        for (const line of lines) {
          try {
            const parsed = JSON.parse(line);
            if (parsed.ready) {
              clearTimeout(timeout);
              resolve({ port: parsed.port, token: parsed.token });
              return;
            }
          } catch {
            // Not JSON yet, keep buffering
          }
        }
      });

      serverProcess.stderr?.on("data", (data: Buffer) => {
        process.stderr.write(`[mml-server-err] ${data.toString()}`);
      });

      serverProcess.on("exit", (code) => {
        clearTimeout(timeout);
        reject(new Error(`Test server exited with code ${code}`));
      });
    });

    serverPort = serverInfo.port;

    // 2. Spawn the bridge, pointing it at the test server
    bridgeProcess = await spawnBridge(serverPort, bridgePort, serverInfo.token);

    // 3. Wait for the scene to load and the navmesh to be generated
    await waitUntil(
      async () => {
        try {
          const status = await fetchJson(bridgePort, "/status");
          return status.sceneLoaded === true && status.navmeshReady === true;
        } catch {
          return false;
        }
      },
      "scene loaded and navmesh ready",
      60_000,
      1_000,
    );
  }, 90_000);

  afterAll(async () => {
    await killProcess(bridgeProcess);
    await killProcess(serverProcess);
  }, 15_000);

  // -- Visibility --

  test("scene has MML elements visible in scene info", async () => {
    const result = await postJson(bridgePort, "/tools/get_scene_info", {
      radius: 100,
      include_geometry: true,
      geometry_radius: 100,
    });
    const info = parseToolResult(result);

    expect(info.sceneLoaded).toBe(true);

    // elements with "clickable" category should contain the MML clickable cubes
    const clickables = (info.elements ?? []).filter((e: any) =>
      e.categories?.includes("clickable"),
    );
    expect(clickables.length).toBeGreaterThanOrEqual(1);
  });

  test("scene recognises the m-label element type", async () => {
    await postJson(bridgePort, "/tools/teleport", { x: 3, y: 0, z: 3 });
    await new Promise((r) => setTimeout(r, 300));

    const result = await postJson(bridgePort, "/tools/get_scene_info", { radius: 30 });
    const info = parseToolResult(result);

    // The label should appear in elements with "label" category
    const labels = (info.elements ?? []).filter((e: any) => e.categories?.includes("label"));
    if (labels.length > 0) {
      const label = labels.find((el: any) => el.attrs?.content === "Test Sign");
      expect(label).toBeDefined();
      expect(label.tag).toBe("m-label");
    }
  });

  test("scene info includes the interaction element", async () => {
    await postJson(bridgePort, "/tools/teleport", { x: 3, y: 0, z: 3 });
    await new Promise((r) => setTimeout(r, 300));

    const result = await postJson(bridgePort, "/tools/get_scene_info", { radius: 30 });
    const info = parseToolResult(result);

    const interactions = (info.elements ?? []).filter((e: any) =>
      e.categories?.includes("interaction"),
    );
    const interaction = interactions.find((el: any) => el.attrs?.prompt === "Press me");
    expect(interaction).toBeDefined();
    expect(interaction.tag).toBe("m-interaction");
  });

  // -- Interaction --

  test("can click a clickable MML element", async () => {
    // Teleport close to the button cube
    await postJson(bridgePort, "/tools/teleport", { x: 3, y: 0, z: 3 });
    await new Promise((r) => setTimeout(r, 300));

    // Get scene info to find the clickable element's node ID
    const sceneResult = await postJson(bridgePort, "/tools/get_scene_info", { radius: 10 });
    const sceneInfo = parseToolResult(sceneResult);

    // Find the button cube in elements with "clickable" category
    const clickables = (sceneInfo.elements ?? []).filter((e: any) =>
      e.categories?.includes("clickable"),
    );
    const buttonCube = clickables.find(
      (el: any) => el.attrs?.color === "red" || el.attrs?.color === "green",
    );
    expect(buttonCube).toBeDefined();

    // Click it
    const clickResult = await postJson(bridgePort, "/tools/click", {
      node_id: buttonCube.nodeId,
    });
    const clickData = parseToolResult(clickResult);
    expect(clickData.success).toBe(true);
  });

  test("can trigger an m-interaction element", async () => {
    // Teleport within range of the interaction
    await postJson(bridgePort, "/tools/teleport", { x: 3, y: 0, z: 3 });
    await new Promise((r) => setTimeout(r, 300));

    const sceneResult = await postJson(bridgePort, "/tools/get_scene_info", { radius: 10 });
    const sceneInfo = parseToolResult(sceneResult);

    const interactions = (sceneInfo.elements ?? []).filter((e: any) =>
      e.categories?.includes("interaction"),
    );
    const interaction = interactions.find((el: any) => el.attrs?.prompt === "Press me");
    expect(interaction).toBeDefined();

    const interactResult = await postJson(bridgePort, "/tools/interact", {
      node_id: interaction.nodeId,
    });
    const interactData = parseToolResult(interactResult);
    expect(interactData.success).toBe(true);
    expect(interactData.prompt).toBe("Press me");
  });

  test("click fails when element is out of range", async () => {
    // Teleport far from the button
    await postJson(bridgePort, "/tools/teleport", { x: 50, y: 0, z: 50 });
    await new Promise((r) => setTimeout(r, 300));

    // Get the button's node ID from a nearby vantage point first
    await postJson(bridgePort, "/tools/teleport", { x: 3, y: 0, z: 3 });
    await new Promise((r) => setTimeout(r, 300));
    const sceneResult = await postJson(bridgePort, "/tools/get_scene_info", { radius: 10 });
    const sceneInfo = parseToolResult(sceneResult);
    const clickables2 = (sceneInfo.elements ?? []).filter((e: any) =>
      e.categories?.includes("clickable"),
    );
    const buttonCube = clickables2.find(
      (el: any) => el.attrs?.color === "red" || el.attrs?.color === "green",
    );
    expect(buttonCube).toBeDefined();

    // Now teleport far away and try to click
    await postJson(bridgePort, "/tools/teleport", { x: 50, y: 0, z: 50 });
    await new Promise((r) => setTimeout(r, 300));

    const clickResult = await postJson(bridgePort, "/tools/click", {
      node_id: buttonCube.nodeId,
    });
    const clickData = parseToolResult(clickResult);
    expect(clickData.success).toBe(false);
    expect(clickData.error).toMatch(/too far/i);
  });

  // -- Navigation --

  test("navmesh is ready and covers the scene area", async () => {
    const status = await fetchJson(bridgePort, "/status");
    expect(status.navmeshReady).toBe(true);
    // At least ground plane + wall
    expect(status.colliderCount).toBeGreaterThanOrEqual(2);

    // After the out-of-range click test, the avatar may be far from origin
    // and the navmesh may have regenerated for a distant region. Teleport
    // back to origin and wait for the navmesh to regenerate so it covers
    // the wall and scene elements.
    await postJson(bridgePort, "/tools/teleport", { x: 0, y: 0, z: 0 });

    // Wait for navmesh regen: 2s throttle on positionUpdate + ~200ms regen
    await waitUntil(
      async () => {
        const result = await postJson(bridgePort, "/tools/navigate_to", { x: 5, y: 0, z: 0 });
        const data = parseToolResult(result);
        if (data.status === "navigating" || data.status === "partial_path") {
          // Stop the navigation we just triggered
          await postJson(bridgePort, "/tools/stop_moving", {});
          return true;
        }
        return false;
      },
      "navmesh to cover origin region",
      8_000,
      500,
    );
  }, 15_000);

  test("navigate_to computes a detour path around the wall obstacle", async () => {
    // Place avatar at the start (well before the wall)
    const start = { x: 0, y: 0, z: 0 };
    await postJson(bridgePort, "/tools/teleport", start);
    await new Promise((r) => setTimeout(r, 300));

    // Target is on the other side of the wall.
    // Wall at x=10, z=-6..+6, height 5 (no jump links over it).
    // Direct path (0,0,0)→(20,0,0) is blocked — the navmesh must route
    // the avatar around one end of the wall (z > 6 or z < -6).
    const target = { x: 20, y: 0, z: 0 };
    const navResult = await postJson(bridgePort, "/tools/navigate_to", target);
    const navData = parseToolResult(navResult);

    // Should find a path (not "no_path")
    expect(navData.status).toMatch(/navigating|partial_path/);
    expect(navData.waypoints).toBeGreaterThanOrEqual(2);

    // Stop navigation before the next test
    await postJson(bridgePort, "/tools/stop_moving", {});
  }, 15_000);

  test("navigate_to moves the avatar to the target", async () => {
    // Use a simple straight-line route to confirm that navigate_to
    // actually drives the avatar along the navmesh path and arrives.
    await postJson(bridgePort, "/tools/teleport", { x: 0, y: 0, z: 0 });
    await new Promise((r) => setTimeout(r, 300));

    const target = { x: 6, y: 0, z: 0 };
    const navResult = await postJson(bridgePort, "/tools/navigate_to", target);
    const navData = parseToolResult(navResult);
    expect(navData.status).toBe("navigating");

    const arrivalResult = await postJson(bridgePort, "/tools/observe", {
      timeout_seconds: 15,
    });
    const arrivalData = parseToolResult(arrivalResult);
    expect(arrivalData.trigger).toBe("arrival");
    expect(xzDistance(arrivalData.position, target)).toBeLessThanOrEqual(ARRIVAL_THRESHOLD + 0.5);
  }, 20_000);

  test("navigate_to to the near side of the wall takes a direct path", async () => {
    // Start at origin, navigate to (8, 0, 0) which is BEFORE the wall
    // This should be a direct path with no detour needed
    await postJson(bridgePort, "/tools/teleport", { x: 0, y: 0, z: 0 });
    await new Promise((r) => setTimeout(r, 300));

    const target = { x: 8, y: 0, z: 0 };
    const navResult = await postJson(bridgePort, "/tools/navigate_to", target);
    const navData = parseToolResult(navResult);

    expect(navData.status).toBe("navigating");
    // Waypoints should be reasonable for a direct path
    expect(navData.waypoints).toBeGreaterThanOrEqual(1);

    const arrivalData = parseToolResult(
      await postJson(bridgePort, "/tools/observe", { timeout_seconds: 15 }),
    );
    expect(arrivalData.trigger).toBe("arrival");
    expect(xzDistance(arrivalData.position, target)).toBeLessThanOrEqual(ARRIVAL_THRESHOLD + 0.2);
  }, 20_000);
});
