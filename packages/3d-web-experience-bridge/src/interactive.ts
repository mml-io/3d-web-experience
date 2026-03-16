import type { WorldEvent } from "@mml-io/3d-web-experience-client";

import type { ToolDefinition } from "./tools/registry";
import { coerceValue, getDescription, getZodTypeName, isOptional } from "./zod-utils";

import type { BridgeConfig, BridgeCoreHandle } from "./index";

type ToolCategory = {
  label: string;
  tools: string[];
};

const TOOL_CATEGORIES: ToolCategory[] = [
  {
    label: "Movement",
    tools: [
      "navigate_to",
      "move_to",
      "teleport",
      "stop_moving",
      "follow_user",
      "stop_following",
      "jump",
    ],
  },
  {
    label: "Query",
    tools: ["get_scene_info", "search_nearby", "get_element", "get_chat_history"],
  },
  {
    label: "Chat",
    tools: ["send_chat_message"],
  },
  {
    label: "Interaction",
    tools: ["click", "interact"],
  },
  {
    label: "Observe",
    tools: ["observe"],
  },
  {
    label: "Animation",
    tools: ["set_animation_state"],
  },
];

// ─── ANSI helpers ────────────────────────────────────────────────

const ESC = "\x1b[";

function moveTo(row: number, col: number): string {
  return `${ESC}${row};${col}H`;
}

function clearLine(): string {
  return `${ESC}2K`;
}

/** Strip ANSI escape sequences to get visible character count. */
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]/g;
function visibleLength(str: string): number {
  return str.replace(ANSI_RE, "").length;
}

/** Remove ANSI escape sequences from a string to prevent terminal injection. */
function stripAnsi(str: string): string {
  return str.replace(ANSI_RE, "");
}

const HIDE_CURSOR = `${ESC}?25l`;
const SHOW_CURSOR = `${ESC}?25h`;
const ENTER_ALT_SCREEN = `${ESC}?1049h`;
const LEAVE_ALT_SCREEN = `${ESC}?1049l`;
const RESET_ATTRS = "\x1b[0m";

// ─── SplitPaneUI ─────────────────────────────────────────────────
//
// Alternate-screen, two-pane layout (H = terminal height):
//
//   rows 1 .. topH            — event pane  (chat, joins/leaves)
//   row  topH+1               — separator   ─── Tab to switch ───
//   rows topH+2 .. H-2        — bottom pane (tool menus, results)
//   row  H-1                  — input prompt
//   row  H                    — status bar (dim)
//
// Tab switches scroll focus between panes.
// PgUp / PgDn scroll the focused pane.
// Up / Down arrow recall command history in the input line.

const MAX_BUFFER = 10000;
const TRIM_TO = 5000;

type FocusedPane = "events" | "interactive";

class SplitPaneUI {
  private rows = 0;
  private cols = 0;

  // Two independent line buffers
  private eventBuffer: string[] = [];
  private bottomBuffer: string[] = [];

  // Scroll offsets (0 = pinned to newest)
  private eventScroll = 0;
  private bottomScroll = 0;

  // Which pane PgUp/PgDn controls
  private focusedPane: FocusedPane = "interactive";

  // Input state
  private inputBuffer = "";
  private inputPrompt = "";
  private history: string[] = [];
  private historyIndex = -1;
  private historyDraft = "";
  private resolveInput: ((value: string) => void) | null = null;

  private statusText = "";
  private disposed = false;
  private rawDataHandler: ((data: Buffer) => void) | null = null;
  private resizeHandler: (() => void) | null = null;

  // ── Layout geometry (all 1-based row numbers) ──

  private get topHeight(): number {
    return Math.max(3, Math.floor(this.rows / 2) - 1);
  }

  private get separatorRow(): number {
    return this.topHeight + 1;
  }

  private get bottomStart(): number {
    return this.separatorRow + 1;
  }

  private get bottomHeight(): number {
    return Math.max(1, this.rows - this.separatorRow - 2);
  }

  private get inputRow(): number {
    return this.rows - 1;
  }

  private get statusRow(): number {
    return this.rows;
  }

  // ── Lifecycle ──

  init(): void {
    this.measure();

    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();

    process.stdout.write(ENTER_ALT_SCREEN + HIDE_CURSOR);
    this.render();

    this.rawDataHandler = (data: Buffer) => this.handleKeypress(data);
    process.stdin.on("data", this.rawDataHandler);

    this.resizeHandler = () => {
      this.measure();
      this.render();
    };
    process.on("SIGWINCH", this.resizeHandler);
  }

  cleanup(): void {
    this.disposed = true;
    if (this.rawDataHandler) {
      process.stdin.removeListener("data", this.rawDataHandler);
    }
    if (this.resizeHandler) {
      process.removeListener("SIGWINCH", this.resizeHandler);
    }
    process.stdout.write(SHOW_CURSOR + LEAVE_ALT_SCREEN);
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    process.stdin.pause();
  }

  private measure(): void {
    this.rows = process.stdout.rows || 24;
    this.cols = process.stdout.columns || 80;
  }

  // ── Single render method — always redraws everything ──

  private render(): void {
    if (this.disposed) return;

    let out = HIDE_CURSOR;

    // Event pane (top)
    const topH = this.topHeight;
    const evTotal = this.eventBuffer.length;
    const evEnd = Math.max(0, evTotal - this.eventScroll);
    const evStart = Math.max(0, evEnd - topH);
    const evVisible = this.eventBuffer.slice(evStart, evEnd);
    for (let i = 0; i < topH; i++) {
      out += moveTo(i + 1, 1) + clearLine();
      if (i < evVisible.length) {
        out += evVisible[i] + RESET_ATTRS;
      }
    }
    if (this.eventScroll > 0) {
      const tag = ` \u2191 ${this.eventScroll} more `;
      out += moveTo(1, Math.max(1, this.cols - tag.length - 1)) + `\x1b[7m${tag}\x1b[0m`;
    }

    // Separator
    const evFocus = this.focusedPane === "events";
    const evLabel = evFocus ? "\x1b[1;7m Events \x1b[0m\x1b[2m" : " Events ";
    const intLabel =
      this.focusedPane === "interactive"
        ? "\x1b[0m\x1b[1;7m Interactive \x1b[0m\x1b[2m"
        : " Interactive ";
    const sepText = `${evLabel} \u2502 ${intLabel}  Tab=switch  PgUp/PgDn=scroll`;
    const sepVisible = visibleLength(sepText);
    const sepPad = Math.max(0, this.cols - sepVisible - 4);
    const sepLeft = Math.floor(sepPad / 2);
    const sepRight = sepPad - sepLeft;
    out +=
      moveTo(this.separatorRow, 1) +
      clearLine() +
      `\x1b[2m${"─".repeat(sepLeft)} ${sepText} ${"─".repeat(sepRight)}\x1b[0m`;

    // Bottom pane (interactive)
    const btmH = this.bottomHeight;
    const btmTotal = this.bottomBuffer.length;
    const btmEnd = Math.max(0, btmTotal - this.bottomScroll);
    const btmStart = Math.max(0, btmEnd - btmH);
    const btmVisible = this.bottomBuffer.slice(btmStart, btmEnd);
    for (let i = 0; i < btmH; i++) {
      out += moveTo(this.bottomStart + i, 1) + clearLine();
      if (i < btmVisible.length) {
        out += btmVisible[i] + RESET_ATTRS;
      }
    }
    if (this.bottomScroll > 0) {
      const tag = ` \u2191 ${this.bottomScroll} more `;
      out +=
        moveTo(this.bottomStart, Math.max(1, this.cols - tag.length - 1)) + `\x1b[7m${tag}\x1b[0m`;
    }

    // Input line
    const promptVis = visibleLength(this.inputPrompt);
    const fullVis = promptVis + this.inputBuffer.length;
    const inputMaxVis = this.cols - 1;
    let displayPrompt = this.inputPrompt;
    let displayInput = this.inputBuffer;
    if (fullVis > inputMaxVis) {
      // Truncate from the left so the cursor stays visible
      const overflow = fullVis - inputMaxVis;
      if (overflow < this.inputBuffer.length) {
        displayInput = this.inputBuffer.slice(overflow);
      } else {
        displayPrompt = "";
        displayInput = this.inputBuffer.slice(this.inputBuffer.length - inputMaxVis);
      }
    }
    const cursorCol = Math.min(visibleLength(displayPrompt) + displayInput.length + 1, this.cols);
    out +=
      moveTo(this.inputRow, 1) +
      clearLine() +
      displayPrompt +
      displayInput +
      moveTo(this.inputRow, cursorCol);

    // Status bar
    out += moveTo(this.statusRow, 1) + clearLine() + `\x1b[2m${this.statusText}\x1b[0m`;

    out += SHOW_CURSOR;
    process.stdout.write(out);
  }

  // ── Public API — event pane (top) ──

  eventLog(line: string): void {
    if (this.disposed) return;
    this.eventBuffer.push(line);
    this.trimBuffer(this.eventBuffer);
    // If user is scrolled up, bump offset so they stay in place
    if (this.eventScroll > 0) {
      this.eventScroll++;
    }
    this.render();
  }

  // ── Public API — bottom pane ──

  log(line: string): void {
    if (this.disposed) return;
    this.bottomBuffer.push(line);
    this.trimBuffer(this.bottomBuffer);
    // Pin to bottom when new content arrives
    this.bottomScroll = 0;
    this.render();
  }

  logLines(lines: string[]): void {
    if (this.disposed) return;
    for (const line of lines) {
      this.bottomBuffer.push(line);
    }
    this.trimBuffer(this.bottomBuffer);
    this.bottomScroll = 0;
    this.render();
  }

  clearBottom(): void {
    this.bottomBuffer = [];
    this.bottomScroll = 0;
    if (!this.disposed) {
      this.render();
    }
  }

  setStatus(text: string): void {
    this.statusText = text;
    if (!this.disposed) {
      this.render();
    }
  }

  question(prompt: string): Promise<string> {
    return new Promise((resolve) => {
      this.inputPrompt = prompt;
      this.inputBuffer = "";
      this.historyIndex = -1;
      this.historyDraft = "";
      this.resolveInput = resolve;
      this.render();
    });
  }

  // ── Input handling ──

  private handleKeypress(data: Buffer): void {
    if (this.disposed) return;

    const seq = data.toString("utf8");

    // Ctrl+C
    if (seq === "\x03") {
      if (this.resolveInput) {
        this.resolveInput("\x03");
        this.resolveInput = null;
      }
      return;
    }

    // Ctrl+D
    if (seq === "\x04") {
      if (this.resolveInput) {
        this.resolveInput("\x04");
        this.resolveInput = null;
      }
      return;
    }

    // Enter
    if (seq === "\r" || seq === "\n") {
      if (this.resolveInput) {
        const value = this.inputBuffer;
        if (value.trim()) {
          this.history.push(value);
        }
        this.resolveInput(value);
        this.resolveInput = null;
      }
      return;
    }

    // Tab — switch focused pane
    if (seq === "\t") {
      this.focusedPane = this.focusedPane === "events" ? "interactive" : "events";
      this.render();
      return;
    }

    // Backspace
    if (seq === "\x7f" || seq === "\b") {
      if (this.inputBuffer.length > 0) {
        this.inputBuffer = this.inputBuffer.slice(0, -1);
        this.render();
      }
      return;
    }

    // Page Up — scroll focused pane up (back in history)
    if (seq === "\x1b[5~") {
      if (this.focusedPane === "events") {
        const maxScroll = Math.max(0, this.eventBuffer.length - this.topHeight);
        const step = Math.max(1, this.topHeight - 1);
        this.eventScroll = Math.min(maxScroll, this.eventScroll + step);
      } else {
        const maxScroll = Math.max(0, this.bottomBuffer.length - this.bottomHeight);
        const step = Math.max(1, this.bottomHeight - 1);
        this.bottomScroll = Math.min(maxScroll, this.bottomScroll + step);
      }
      this.render();
      return;
    }

    // Page Down — scroll focused pane down (toward newest)
    if (seq === "\x1b[6~") {
      if (this.focusedPane === "events") {
        const step = Math.max(1, this.topHeight - 1);
        this.eventScroll = Math.max(0, this.eventScroll - step);
      } else {
        const step = Math.max(1, this.bottomHeight - 1);
        this.bottomScroll = Math.max(0, this.bottomScroll - step);
      }
      this.render();
      return;
    }

    // Up arrow — command history
    if (seq === "\x1b[A") {
      if (this.history.length === 0) return;
      if (this.historyIndex === -1) {
        this.historyDraft = this.inputBuffer;
        this.historyIndex = this.history.length - 1;
      } else if (this.historyIndex > 0) {
        this.historyIndex--;
      }
      this.inputBuffer = this.history[this.historyIndex];
      this.render();
      return;
    }

    // Down arrow — command history
    if (seq === "\x1b[B") {
      if (this.historyIndex === -1) return;
      if (this.historyIndex < this.history.length - 1) {
        this.historyIndex++;
        this.inputBuffer = this.history[this.historyIndex];
      } else {
        this.historyIndex = -1;
        this.inputBuffer = this.historyDraft;
      }
      this.render();
      return;
    }

    // Ignore other escape sequences
    if (seq.startsWith("\x1b")) {
      return;
    }

    // Regular character(s)
    this.inputBuffer += seq;
    this.render();
  }

  // ── Helpers ──

  private trimBuffer(buf: string[]): void {
    if (buf.length > MAX_BUFFER) {
      buf.splice(0, buf.length - TRIM_TO);
    }
  }
}

// ─── Tool menu formatting ────────────────────────────────────────

function buildToolMenu(tools: Map<string, ToolDefinition>): {
  lines: string[];
  indexedNames: string[];
} {
  const lines: string[] = [];
  const indexedNames: string[] = [];
  let index = 1;

  for (const category of TOOL_CATEGORIES) {
    const available = category.tools.filter((name) => tools.has(name));
    if (available.length === 0) continue;
    lines.push("");
    lines.push(`  \x1b[1m${category.label}\x1b[0m`);
    for (const name of available) {
      const tool = tools.get(name)!;
      lines.push(
        `    ${String(index).padStart(2)}. ${name} \x1b[2m— ${tool.description.slice(0, 70)}${tool.description.length > 70 ? "..." : ""}\x1b[0m`,
      );
      indexedNames.push(name);
      index++;
    }
  }

  let needsHeader = true;
  for (const [name, tool] of tools) {
    if (indexedNames.includes(name)) continue;
    if (needsHeader) {
      lines.push("");
      lines.push(`  \x1b[1mOther\x1b[0m`);
      needsHeader = false;
    }
    lines.push(
      `    ${String(index).padStart(2)}. ${name} \x1b[2m— ${tool.description.slice(0, 70)}${tool.description.length > 70 ? "..." : ""}\x1b[0m`,
    );
    indexedNames.push(name);
    index++;
  }

  return { lines, indexedNames };
}

// ─── Status bar formatting ───────────────────────────────────────

function formatStatus(core: BridgeCoreHandle, connected: boolean): string {
  const pos = core.avatarController.getPosition();
  const users = core.worldConnection.getOtherUsers().length;
  const connLabel = connected ? "Connected" : "Disconnected";
  return `${connLabel} | Pos: (${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)}) | Users: ${users}`;
}

// ─── Main entry point ────────────────────────────────────────────

export async function startInteractive(config: BridgeConfig): Promise<void> {
  const { createBridgeCore } = await import("./index");

  // Connect before entering the TUI (uses normal stdout)
  console.log("\n\x1b[1m=== 3D Web Experience Bridge — Interactive Mode ===\x1b[0m\n");
  console.log(`  Connecting to ${config.serverUrl} as "${config.botName}"...\n`);

  let core: BridgeCoreHandle;
  try {
    core = await createBridgeCore(config);
  } catch (err) {
    console.error("Failed to connect:", err);
    process.exit(1);
  }

  const { worldConnection, avatarController, tools, toolCtx } = core;

  // Enter the TUI
  const ui = new SplitPaneUI();
  ui.init();

  let isConnected = worldConnection.isConnected();

  const refreshStatus = () => {
    ui.setStatus(formatStatus(core, isConnected));
  };
  refreshStatus();

  const statusInterval = setInterval(refreshStatus, 2000);

  // Initial info → event pane (top)
  const pos = avatarController.getPosition();
  ui.eventLog(`  \x1b[32mConnected!\x1b[0m  Bot: ${config.botName}  Server: ${config.serverUrl}`);
  ui.eventLog(
    `  Position: (${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)})  Connection ID: ${worldConnection.getConnectionId()}`,
  );

  // Initial hint → bottom pane
  ui.log(`  Type \x1b[1mh\x1b[0m for tool menu, \x1b[1mq\x1b[0m to quit.`);

  // Live events → event pane (top)
  const eventListener = (event: WorldEvent) => {
    switch (event.type) {
      case "chat":
        ui.eventLog(`  \x1b[36m[chat]\x1b[0m ${event.message.username}: ${event.message.message}`);
        break;
      case "user_joined":
        ui.eventLog(`  \x1b[33m[joined]\x1b[0m ${event.username ?? `User ${event.userId}`}`);
        refreshStatus();
        break;
      case "user_left":
        ui.eventLog(`  \x1b[33m[left]\x1b[0m ${event.username ?? `User ${event.userId}`}`);
        refreshStatus();
        break;
      case "connected":
        isConnected = true;
        ui.eventLog(`  \x1b[32m[connected]\x1b[0m`);
        refreshStatus();
        break;
      case "disconnected":
        isConnected = false;
        ui.eventLog(`  \x1b[31m[disconnected]\x1b[0m`);
        refreshStatus();
        break;
      case "reconnecting":
        ui.eventLog(`  \x1b[33m[reconnecting]\x1b[0m`);
        break;
    }
  };
  worldConnection.addEventListener(eventListener);

  // Build indexed tool menu once
  let indexedNames: string[] = [];
  {
    const menu = buildToolMenu(tools);
    indexedNames = menu.indexedNames;
  }

  const shutdown = async () => {
    clearInterval(statusInterval);
    worldConnection.removeEventListener(eventListener);
    ui.cleanup();
    await core.cleanup();
  };

  const QUIT_SIGNALS = new Set(["", "q", "quit", "exit", "\x03", "\x04"]);

  const promptForTool = async (): Promise<boolean> => {
    const input = await ui.question(
      "\x1b[1mSelect tool\x1b[0m (# or name, h=help, c=clear, q=quit): ",
    );
    const trimmed = input.trim();

    if (QUIT_SIGNALS.has(trimmed)) {
      return false;
    }

    if (trimmed === "h" || trimmed === "help") {
      const menu = buildToolMenu(tools);
      indexedNames = menu.indexedNames;
      ui.clearBottom();
      ui.logLines(menu.lines);
      return true;
    }

    if (trimmed === "c" || trimmed === "clear") {
      ui.clearBottom();
      return true;
    }

    // Resolve tool by number or name
    let toolName: string | undefined;
    const num = parseInt(trimmed, 10);
    if (!isNaN(num) && num >= 1 && num <= indexedNames.length) {
      toolName = indexedNames[num - 1];
    } else {
      if (tools.has(trimmed)) {
        toolName = trimmed;
      } else {
        const matches = [...tools.keys()].filter((n) => n.startsWith(trimmed));
        if (matches.length === 1) {
          toolName = matches[0];
        } else if (matches.length > 1) {
          ui.log(`  Ambiguous: ${matches.join(", ")}`);
          return true;
        }
      }
    }

    if (!toolName) {
      ui.log(`  Unknown tool: "${trimmed}". Type 'h' for help.`);
      return true;
    }

    const tool = tools.get(toolName)!;
    ui.log(`  \x1b[1m${toolName}\x1b[0m — ${tool.description}`);

    // Prompt for parameters
    const schema = tool.inputSchema;
    const params: Record<string, unknown> = {};

    if ("shape" in schema && typeof schema.shape === "object" && schema.shape !== null) {
      const shape = schema.shape as Record<string, any>;
      const entries = Object.entries(shape);

      for (const [key, zodType] of entries) {
        const typeName = getZodTypeName(zodType);
        const optional = isOptional(zodType);
        const desc = getDescription(zodType);
        const reqLabel = optional ? "optional" : "required";
        const descSuffix = desc ? ` — ${desc}` : "";

        const raw = await ui.question(`  ${key} (${typeName}, ${reqLabel}${descSuffix}): `);

        if (raw === "\x03" || raw === "\x04") {
          return false;
        }

        const trimmedRaw = raw.trim();
        if (trimmedRaw === "" && optional) {
          continue;
        }
        if (trimmedRaw === "" && !optional) {
          ui.log(`  \x1b[31mRequired parameter "${key}" cannot be empty.\x1b[0m`);
          return true;
        }

        try {
          params[key] = coerceValue(trimmedRaw, zodType);
        } catch (err: any) {
          ui.log(`  \x1b[31m${stripAnsi(err.message)}\x1b[0m`);
          return true;
        }
      }
    }

    // Validate and execute
    try {
      const parsed = schema.parse(params);
      ui.log(`  \x1b[2m> Executing ${toolName}...\x1b[0m`);
      const result = await tool.execute(parsed, toolCtx);

      if (result.content && result.content.length > 0) {
        for (const item of result.content) {
          if (item.type === "text") {
            try {
              const obj = JSON.parse(item.text);
              const formatted = JSON.stringify(obj, null, 2);
              for (const jl of formatted.split("\n")) {
                ui.log(`  \x1b[32m${jl}\x1b[0m`);
              }
            } catch {
              ui.log(`  \x1b[32m${item.text}\x1b[0m`);
            }
          }
        }
      }
      refreshStatus();
    } catch (err: any) {
      if (err.name === "ZodError") {
        ui.log(`  \x1b[31mValidation error: ${stripAnsi(err.message)}\x1b[0m`);
      } else {
        ui.log(`  \x1b[31mError: ${stripAnsi(err.message)}\x1b[0m`);
      }
    }

    return true;
  };

  // Main REPL loop
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const cont = await promptForTool();
      if (!cont) break;
    } catch {
      break;
    }
  }

  ui.log("  Shutting down...");
  await shutdown();
  console.log("  Goodbye!\n");
  process.exitCode = 0;
}
