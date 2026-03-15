import type { ToolDefinition } from "../tools/registry";
import { getDefaultValue, getDescription, getZodTypeName, isOptional } from "../zod-utils";

import { DEFAULT_HOST, DEFAULT_PORT } from "./shared";

/** Ordered list of group labels for display. Tools without a group go last. */
const GROUP_ORDER = ["Movement", "Observation", "Interaction", "Communication", "Avatar"];

/**
 * Print the top-level help text listing all available subcommands.
 */
export function printGlobalHelp(tools: Map<string, ToolDefinition>): void {
  const lines: string[] = [
    "",
    "Usage: 3d-web-bridge <command> [options]",
    "",
    "Commands:",
    "  start                Start the bridge server (long-running)",
    "  stop                 Stop a running bridge server",
    "  interactive          Start the interactive TUI mode",
    "",
    "Tool commands (invoke a tool on a running bridge):",
    "  All tool commands return JSON to stdout.",
    "",
  ];

  // Group tools by category
  const grouped = new Map<string, ToolDefinition[]>();
  const ungrouped: ToolDefinition[] = [];
  for (const tool of tools.values()) {
    if (tool.group) {
      const list = grouped.get(tool.group) ?? [];
      list.push(tool);
      grouped.set(tool.group, list);
    } else {
      ungrouped.push(tool);
    }
  }

  for (const group of GROUP_ORDER) {
    const groupTools = grouped.get(group);
    if (!groupTools || groupTools.length === 0) continue;
    lines.push(`  ${group}:`);
    for (const tool of groupTools) {
      lines.push(`    ${tool.name.padEnd(26)} ${tool.description}`);
    }
    lines.push("");
  }

  if (ungrouped.length > 0) {
    lines.push("  Other:");
    for (const tool of ungrouped) {
      lines.push(`    ${tool.name.padEnd(26)} ${tool.description}`);
    }
    lines.push("");
  }

  lines.push("Quickstart workflow:");
  lines.push("  1. 3d-web-bridge start --server-url http://localhost:8080");
  lines.push("  2. 3d-web-bridge get_scene_info                   # survey the scene");
  lines.push("  3. 3d-web-bridge navigate_to --x 5 --z 10         # walk somewhere");
  lines.push("  4. 3d-web-bridge observe                           # wait for arrival");
  lines.push("  5. 3d-web-bridge observe --resume-from last        # continue listening");
  lines.push("");

  lines.push("Interaction workflow:");
  lines.push("  1. 3d-web-bridge get_scene_info                   # find clickable elements");
  lines.push("  2. 3d-web-bridge navigate_to --x 5 --z 10 --wait  # walk to an element");
  lines.push("  3. 3d-web-bridge click --node-id 42                # click it");
  lines.push("  4. 3d-web-bridge observe                           # see what changed");
  lines.push("");
  lines.push("MML scene changes:");
  lines.push("  Clicking or interacting with elements often triggers MML document logic");
  lines.push("  that changes the scene (colors, positions, visibility, new elements).");
  lines.push("  Use observe to detect these changes — they arrive as scene_changed events");
  lines.push("  with attribute diffs, nearby labels, and updated clickable elements.");
  lines.push("");

  lines.push("The resume_from pattern:");
  lines.push("  Every observe response includes a resume_from cursor (a timestamp).");
  lines.push("  Pass --resume-from last to automatically continue from the previous");
  lines.push("  observe call's cursor, or pass a numeric timestamp for manual control.");
  lines.push("");

  lines.push("Global options (for tool commands):");
  lines.push(
    `  --port <port>          Bridge server port (default: ${DEFAULT_PORT}, env: BRIDGE_PORT)`,
  );
  lines.push(`  --host <host>          Bridge server host (default: ${DEFAULT_HOST})`);
  lines.push("  --api-key <key>        API key for authentication (env: BRIDGE_API_KEY)");
  lines.push("  --pretty-print         Pretty-print JSON output (default: compact)");
  lines.push("");
  lines.push("Tool names accept both snake_case and kebab-case (e.g. navigate_to or navigate-to).");
  lines.push("");
  lines.push("Run '3d-web-bridge <command> --help' for command-specific help.");
  lines.push("");

  console.log(lines.join("\n"));
}

/**
 * Print help text for a specific tool subcommand.
 */
export function printToolHelp(tool: ToolDefinition): void {
  const lines: string[] = [
    "",
    `Usage: 3d-web-bridge ${tool.name} [options]`,
    "",
    `  ${tool.description}`,
    "",
  ];

  const schema = tool.inputSchema;
  if ("shape" in schema && typeof schema.shape === "object" && schema.shape !== null) {
    const shape = schema.shape as Record<string, any>;
    const entries = Object.entries(shape);
    if (entries.length > 0) {
      lines.push("Parameters:");
      for (const [key, zodType] of entries) {
        const typeName = getZodTypeName(zodType);
        const opt = isOptional(zodType);
        const desc = getDescription(zodType);
        const defaultVal = getDefaultValue(zodType);
        const flag = `--${key.replace(/_/g, "-")}`;
        let reqLabel = opt ? "optional" : "required";
        if (defaultVal !== undefined) {
          reqLabel += ` (default: ${JSON.stringify(defaultVal)})`;
        }
        const descSuffix = desc ? `  ${desc}` : "";
        lines.push(`  ${flag.padEnd(24)} ${typeName}, ${reqLabel}${descSuffix}`);
      }
      lines.push("");
    }
  }

  if (tool.name === "get_scene_info") {
    lines.push("Examples:");
    lines.push("  # Full scene overview (default)");
    lines.push("  3d-web-bridge get_scene_info");
    lines.push("");
    lines.push("  # Quick position check — just your own state");
    lines.push("  3d-web-bridge get_scene_info --include-users false --include-elements false");
    lines.push("");
    lines.push("  # Self + users only, no elements");
    lines.push("  3d-web-bridge get_scene_info --include-elements false");
    lines.push("");
    lines.push("  # Nearby elements within 10 units, max 5");
    lines.push("  3d-web-bridge get_scene_info --radius 10 --max-elements 5");
    lines.push("");
  }

  if (tool.name === "navigate_to") {
    lines.push("Extra CLI options:");
    lines.push("  --wait                     Block until arrival (chains observe automatically)");
    lines.push(
      "  --timeout-seconds <n>      Arrival timeout in seconds (used with --wait, default: 60)",
    );
    lines.push("");
  }

  if (tool.returns) {
    lines.push("Returns (JSON):");
    lines.push(`  ${tool.returns}`);
    lines.push("");
  }

  lines.push("Global options:");
  lines.push(
    `  --port <port>          Bridge server port (default: ${DEFAULT_PORT}, env: BRIDGE_PORT)`,
  );
  lines.push(`  --host <host>          Bridge server host (default: ${DEFAULT_HOST})`);
  lines.push("  --api-key <key>        API key for authentication (env: BRIDGE_API_KEY)");
  lines.push("  --pretty-print         Pretty-print JSON output (default: compact)");
  lines.push("");

  console.log(lines.join("\n"));
}

/**
 * Print help text for the `start` subcommand.
 */
export function printStartHelp(): void {
  const lines = [
    "",
    "Usage: 3d-web-bridge start [options]",
    "",
    "  Start the bridge server (runs in the foreground).",
    "",
    "Options:",
    "  --server-url <url>     Experience server URL (default: http://localhost:8080)",
    `  --port <port>          Bridge server port (default: ${DEFAULT_PORT})`,
    "  --bot-name <name>      Bot display name (default: Agent)",
    "  --bot-auth-token <tok>  Pre-obtained session token",
    "  --bot-avatar-url <url>  Avatar model URL",
    "  --api-key <key>        API key for bridge endpoints",
    "  --mml-document <name>  Single MML document to load",
    "  --webhook-url <url>    Webhook URL for event delivery",
    "  --webhook-token <tok>  Webhook auth token",
    "  --webhook-events <ev>  Comma-separated event types",
    "  --webhook-batch-ms <n> Webhook batch interval (default: 2000)",
    "  --debug                Enable navmesh debug endpoints (/navmesh-debug viewer)",
    "",
    "Environment variables are used as fallbacks (e.g. SERVER_URL, BRIDGE_PORT).",
    "CLI flags take precedence over environment variables.",
    "",
  ];
  console.log(lines.join("\n"));
}
