/**
 * CLI entry point for the 3D Web Experience Bridge.
 *
 * Subcommands:
 *   start         — Start the bridge server (long-running process)
 *   interactive   — Start the interactive TUI mode
 *   <tool-name>   — Invoke a tool on a running bridge via HTTP
 *   help / --help — Print usage information
 *
 * The tool registry is safe to import statically (only depends on Zod),
 * so help text and tool subcommands work without DOM polyfills.
 * Polyfills are only installed for the `start` and `interactive` paths.
 */
import { parseArgs, coerceParams } from "./cli/args";
import { printGlobalHelp, printStartHelp, printToolHelp } from "./cli/help";
import { DEFAULT_HOST, DEFAULT_PORT, findAvailablePort } from "./cli/shared";
import {
  executeGetCommand,
  executeShutdownCommand,
  executeToolCommand,
  printToolResult,
} from "./cli/tool-client";
import { loadTools } from "./tools/registry";

import type { BridgeConfig } from "./index";

/**
 * Build the common BridgeConfig fields from parsed CLI flags and env vars.
 * Requires bridgePort to be resolved separately (port scanning is async).
 */
function buildBridgeConfig(flags: Record<string, string>, bridgePort: number): BridgeConfig {
  const serverUrl = flags["server-url"] ?? process.env.SERVER_URL ?? "http://localhost:8080";
  const botName = flags["bot-name"] ?? process.env.BOT_NAME ?? "Agent";
  const token = flags["token"] ?? process.env.BOT_TOKEN;
  const botAvatarUrl = flags["bot-avatar-url"] ?? process.env.BOT_AVATAR_URL;
  const apiKey = flags["api-key"] ?? process.env.BRIDGE_API_KEY;
  const mmlDocument = flags["mml-document"] ?? process.env.MML_DOCUMENT;

  if (!token) {
    console.error("Error: --token <value> (or BOT_TOKEN env) is required");
    process.exit(1);
  }

  const webhookUrl = flags["webhook-url"] ?? process.env.WEBHOOK_URL;
  const webhookToken = flags["webhook-token"] ?? process.env.WEBHOOK_TOKEN;
  const webhookEvents = flags["webhook-events"] ?? process.env.WEBHOOK_EVENTS;
  const webhookBatchMs = parseInt(
    flags["webhook-batch-ms"] ?? process.env.WEBHOOK_BATCH_MS ?? "2000",
    10,
  );

  // Navmesh options from CLI flags
  const navMeshMaxY = flags["navmesh-max-y"] ? parseFloat(flags["navmesh-max-y"]) : undefined;
  const navMeshJumpLinks = flags["navmesh-jump-links"] === "false" ? false : undefined;
  const navMeshCs = flags["navmesh-cs"] ? parseFloat(flags["navmesh-cs"]) : undefined;
  const navMeshCh = flags["navmesh-ch"] ? parseFloat(flags["navmesh-ch"]) : undefined;
  const navMeshWalkableRadius = flags["navmesh-walkable-radius"]
    ? parseInt(flags["navmesh-walkable-radius"], 10)
    : undefined;
  const navMeshWalkableHeight = flags["navmesh-walkable-height"]
    ? parseInt(flags["navmesh-walkable-height"], 10)
    : undefined;

  const hasNavMeshOverrides =
    navMeshMaxY !== undefined ||
    navMeshJumpLinks !== undefined ||
    navMeshCs !== undefined ||
    navMeshCh !== undefined ||
    navMeshWalkableRadius !== undefined ||
    navMeshWalkableHeight !== undefined;

  const navMeshOptions = hasNavMeshOverrides
    ? {
        maxY: navMeshMaxY,
        jumpLinksEnabled: navMeshJumpLinks,
        config: {
          ...(navMeshCs !== undefined ? { cs: navMeshCs } : {}),
          ...(navMeshCh !== undefined ? { ch: navMeshCh } : {}),
          ...(navMeshWalkableRadius !== undefined ? { walkableRadius: navMeshWalkableRadius } : {}),
          ...(navMeshWalkableHeight !== undefined ? { walkableHeight: navMeshWalkableHeight } : {}),
        },
      }
    : undefined;

  return {
    serverUrl,
    bridgePort,
    botName,
    token,
    characterDescription: botAvatarUrl ? { mmlCharacterUrl: botAvatarUrl } : null,
    mmlDocument,
    ...(webhookUrl
      ? {
          webhook: {
            url: webhookUrl,
            token: webhookToken,
            events: webhookEvents ? webhookEvents.split(",").map((s) => s.trim()) : undefined,
            batchMs: webhookBatchMs,
          },
        }
      : {}),
    apiKey,
    navMeshOptions,
  };
}

const { subcommand, flags, help } = parseArgs(process.argv);
const tools = loadTools();
const prettyPrint = "pretty-print" in flags || "pretty_print" in flags;

/**
 * Resolve a CLI subcommand to a tool name. Accepts the exact tool name
 * (snake_case) or a kebab-case equivalent (e.g. `navigate-to` → `navigate_to`).
 */
function resolveToolName(name: string, toolMap: Map<string, unknown>): string | undefined {
  if (toolMap.has(name)) return name;
  const snake = name.replace(/-/g, "_");
  if (toolMap.has(snake)) return snake;
  return undefined;
}

function getConnectionOpts() {
  const portStr = flags.port ?? process.env.BRIDGE_PORT;
  return {
    port: portStr ? parseInt(portStr, 10) : DEFAULT_PORT,
    host: flags.host ?? DEFAULT_HOST,
    apiKey: flags["api-key"] ?? process.env.BRIDGE_API_KEY,
  };
}

// ── start ─────────────────────────────────────────────────────────
if (subcommand === "start") {
  if (help) {
    printStartHelp();
    process.exit(0);
  }

  // Redirect console.log/info to stderr so stdout stays clean for machine output
  const origLog = console.log;
  console.log = (...args: any[]) => console.error(...args);
  console.info = (...args: any[]) => console.error(...args);

  // Resolve port and load modules in parallel
  const explicitPort = flags.port ?? process.env.BRIDGE_PORT;
  const portPromise = explicitPort
    ? Promise.resolve(parseInt(explicitPort, 10))
    : findAvailablePort(DEFAULT_PORT);

  // Install polyfills and dynamically import the main entry
  const { installNodePolyfills } =
    // eslint-disable-next-line import/no-unresolved -- .js extensions resolve after ESM build
    await import("./node-polyfills.js");
  installNodePolyfills();

  // eslint-disable-next-line import/no-unresolved
  const [{ startBridge }, bridgePort] = await Promise.all([import("./index.js"), portPromise]);

  if (isNaN(bridgePort) || bridgePort < 1 || bridgePort > 65535) {
    console.error(`Invalid port: "${explicitPort}"`);
    process.exit(1);
  }

  console.error(`[bridge] Port: ${bridgePort}`);

  const enableDebug = "debug" in flags;

  const bridgeConfig: BridgeConfig = {
    ...buildBridgeConfig(flags, bridgePort),
    enableDebug,
  };

  try {
    await startBridge(bridgeConfig);
    // Print machine-readable port to stdout
    origLog(`BRIDGE_PORT=${bridgePort}`);
  } catch (err) {
    console.error("[bridge] Fatal error:", err);
    process.exit(1);
  }
}

// ── interactive ───────────────────────────────────────────────────
else if (subcommand === "interactive") {
  const { installNodePolyfills } =
    // eslint-disable-next-line import/no-unresolved -- .js extensions resolve after ESM build
    await import("./node-polyfills.js");
  installNodePolyfills();

  const { startInteractive } =
    // eslint-disable-next-line import/no-unresolved
    await import("./interactive.js");

  const explicitPort = flags.port ?? process.env.BRIDGE_PORT;
  let bridgePort: number;
  if (explicitPort) {
    bridgePort = parseInt(explicitPort, 10);
    if (isNaN(bridgePort) || bridgePort < 1 || bridgePort > 65535) {
      console.error(`Invalid port: "${explicitPort}"`);
      process.exit(1);
    }
  } else {
    bridgePort = await findAvailablePort(DEFAULT_PORT);
  }

  const bridgeConfig: BridgeConfig = buildBridgeConfig(flags, bridgePort);

  try {
    await startInteractive(bridgeConfig);
  } catch (err) {
    console.error("[bridge] Fatal error:", err);
    process.exit(1);
  }
}

// ── health / status (GET endpoints) ──────────────────────────────
else if (subcommand === "health" || subcommand === "status") {
  await executeGetCommand(subcommand, getConnectionOpts(), prettyPrint);
  process.exit(process.exitCode ?? 0);
}

// ── stop ──────────────────────────────────────────────────────────
else if (subcommand === "stop") {
  await executeShutdownCommand(getConnectionOpts());
  process.exit(process.exitCode ?? 0);
}

// ── tool subcommands ─────────────────────────────────────────────
else if (subcommand && resolveToolName(subcommand, tools)) {
  const resolvedName = resolveToolName(subcommand, tools)!;
  const tool = tools.get(resolvedName)!;

  if (help) {
    printToolHelp(tool);
    process.exit(0);
  }

  try {
    const params = coerceParams(flags, tool.inputSchema);
    const opts = getConnectionOpts();
    const result = await executeToolCommand(resolvedName, params, opts);

    // --wait on navigate_to: automatically chain observe and merge into one response
    if (resolvedName === "navigate_to" && flags.wait && result) {
      const timeoutFlag = flags["timeout-seconds"] ?? flags.timeout_seconds;
      const waitParams: Record<string, unknown> = { resume_from: "last" };
      if (timeoutFlag) {
        const parsed = parseFloat(timeoutFlag);
        if (!isNaN(parsed) && parsed > 0) {
          waitParams.timeout_seconds = parsed;
        }
      }
      const observeResult = await executeToolCommand("observe", waitParams, opts);
      printToolResult({ ...result, ...(observeResult ?? {}) }, prettyPrint);
    } else if (result) {
      printToolResult(result, prettyPrint);
    }
  } catch (err: any) {
    if (err.name === "ZodError") {
      console.error(`Validation error: ${err.message}`);
      console.error(`\nRun '3d-web-bridge ${subcommand} --help' for parameter info.`);
    } else {
      console.error(`Error: ${err.message}`);
    }
    process.exitCode = 1;
  }
  process.exit(process.exitCode ?? 0);
}

// ── help ──────────────────────────────────────────────────────────
else if (subcommand === "help" || help || !subcommand) {
  printGlobalHelp(tools);
}

// ── unknown subcommand ───────────────────────────────────────────
else {
  console.error(`Unknown command: "${subcommand}"`);
  printGlobalHelp(tools);
  process.exitCode = 1;
}
