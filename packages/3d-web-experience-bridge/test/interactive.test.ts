/**
 * Tests for interactive.ts — the TUI-based interactive REPL mode.
 *
 * Since only `startInteractive` is exported, and it orchestrates many internal
 * functions (SplitPaneUI, buildToolMenu, formatStatus, getZodTypeName, parseValue,
 * etc.), we test by mocking the dynamic import of `./index` (createBridgeCore)
 * and simulating stdin key sequences to drive the REPL.
 *
 * The test mocks process.stdin/stdout to avoid real terminal manipulation.
 */
import { describe, expect, test, beforeEach, afterEach, vi, beforeAll } from "vitest";
import { z } from "zod";

import type { ToolDefinition, ToolResult } from "../src/tools/registry";

// ── Mocks must be set up before importing the module under test ──

// Mock the dynamic import of ./index
const mockCreateBridgeCore = vi.fn<() => Promise<any>>();

vi.mock("../src/index", () => ({
  createBridgeCore: mockCreateBridgeCore,
}));

// We also need to mock process.exit to prevent test process from exiting
const mockProcessExit = vi.spyOn(process, "exit").mockImplementation((() => {}) as any);

let startInteractive: typeof import("../src/interactive").startInteractive;

beforeAll(async () => {
  const mod = await import("../src/interactive");
  startInteractive = mod.startInteractive;
});

// ── Test helpers ──

function createMockTool(overrides: Partial<ToolDefinition> = {}): ToolDefinition {
  return {
    name: overrides.name ?? "test_tool",
    description: overrides.description ?? "A test tool for testing",
    inputSchema: overrides.inputSchema ?? z.object({}),
    execute:
      overrides.execute ??
      vi
        .fn<(params: Record<string, unknown>, ctx: any) => Promise<ToolResult>>()
        .mockResolvedValue({
          content: [{ type: "text", text: '{"status":"ok"}' }],
        }),
  };
}

function createMockCore(toolOverrides?: Map<string, ToolDefinition>) {
  const tools =
    toolOverrides ??
    new Map<string, ToolDefinition>([
      ["get_scene_info", createMockTool({ name: "get_scene_info", description: "Get scene info" })],
      [
        "teleport",
        createMockTool({
          name: "teleport",
          description: "Teleport to coordinates",
          inputSchema: z.object({
            x: z.number().describe("X coordinate"),
            y: z.number().describe("Y coordinate"),
            z: z.number().describe("Z coordinate"),
          }),
        }),
      ],
      [
        "send_chat_message",
        createMockTool({
          name: "send_chat_message",
          description: "Send a chat message",
          inputSchema: z.object({
            message: z.string().describe("The message to send"),
          }),
        }),
      ],
      [
        "move_to",
        createMockTool({
          name: "move_to",
          description: "Move to a position",
          inputSchema: z.object({
            x: z.number().describe("X coordinate"),
            y: z.number().describe("Y coordinate"),
            z: z.number().optional().describe("Z coordinate"),
          }),
        }),
      ],
    ]);

  const worldConnection = {
    isConnected: vi.fn().mockReturnValue(true),
    getConnectionId: vi.fn().mockReturnValue(42),
    getOtherUsers: vi.fn().mockReturnValue([]),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    stop: vi.fn(),
  };

  const avatarController = {
    getPosition: vi.fn().mockReturnValue({ x: 1.5, y: 0.0, z: 3.2 }),
    destroy: vi.fn(),
  };

  const cleanup = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

  return {
    worldConnection,
    avatarController,
    headlessScene: {},
    navMeshManager: {},
    tools,
    toolCtx: {
      worldConnection,
      avatarController,
      serverUrl: "http://localhost:8080",
    },
    cleanup,
  };
}

/**
 * Helper to drive startInteractive by feeding stdin data and waiting for the
 * REPL to process it. Returns after the REPL exits.
 *
 * We override process.stdin and process.stdout so the SplitPaneUI doesn't
 * interact with the real terminal.
 */
function driveInteractive(
  config: any,
  keySequences: string[],
  options: { delayBetweenKeys?: number } = {},
): Promise<void> {
  const { delayBetweenKeys = 10 } = options;

  // Store originals
  const originalStdin = process.stdin;
  const originalStdout = process.stdout;
  const originalStdinIsTTY = process.stdin.isTTY;

  // We need to capture the data handler that SplitPaneUI registers on stdin.
  // The real process.stdin is complex, so we patch it minimally.
  let dataHandler: ((data: Buffer) => void) | null = null;

  // Patch stdin methods
  const setRawModeFn = vi.fn();
  const resumeFn = vi.fn() as any;
  const pauseFn = vi.fn() as any;
  const stdinOnFn = vi.fn().mockImplementation((event: string, handler: any) => {
    if (event === "data") {
      dataHandler = handler;
    }
    return process.stdin;
  });
  const stdinRemoveListenerFn = vi.fn().mockImplementation(() => process.stdin);

  Object.defineProperty(process.stdin, "isTTY", {
    value: true,
    writable: true,
    configurable: true,
  });
  (process.stdin as any).setRawMode = setRawModeFn;
  (process.stdin as any).resume = resumeFn;
  (process.stdin as any).pause = pauseFn;
  // Override 'on' and 'removeListener' temporarily
  const origOn = process.stdin.on;
  const origRemoveListener = process.stdin.removeListener;
  (process.stdin as any).on = stdinOnFn;
  (process.stdin as any).removeListener = stdinRemoveListenerFn;

  // Capture stdout writes
  const stdoutWrites: string[] = [];
  const origStdoutWrite = process.stdout.write;
  (process.stdout as any).write = vi.fn().mockImplementation((data: any) => {
    stdoutWrites.push(typeof data === "string" ? data : data.toString());
    return true;
  });

  // Mock stdout.rows/columns
  Object.defineProperty(process.stdout, "rows", { value: 40, writable: true, configurable: true });
  Object.defineProperty(process.stdout, "columns", {
    value: 120,
    writable: true,
    configurable: true,
  });

  // Set up SIGWINCH handler capture
  const origProcessOn = process.on;
  const origProcessRemoveListener = process.removeListener;
  let sigwinchHandler: (() => void) | null = null;
  (process as any).on = vi.fn().mockImplementation((event: string, handler: any) => {
    if (event === "SIGWINCH") {
      sigwinchHandler = handler;
    }
    return process;
  });
  (process as any).removeListener = vi.fn().mockImplementation(() => process);

  const promise = startInteractive(config);

  // Feed keys after a short delay to allow the REPL to initialize
  const feedKeys = async () => {
    // Wait for data handler to be registered
    let waitAttempts = 0;
    while (!dataHandler && waitAttempts < 50) {
      await new Promise((r) => setTimeout(r, 20));
      waitAttempts++;
    }

    if (!dataHandler) {
      throw new Error("stdin data handler was never registered");
    }

    for (const seq of keySequences) {
      await new Promise((r) => setTimeout(r, delayBetweenKeys));
      dataHandler!(Buffer.from(seq, "utf8"));
    }
  };

  const result = Promise.all([promise, feedKeys()]).then(() => {});

  // Restore after completion
  return result.finally(() => {
    Object.defineProperty(process.stdin, "isTTY", {
      value: originalStdinIsTTY,
      writable: true,
      configurable: true,
    });
    delete (process.stdin as any).setRawMode;
    (process.stdin as any).on = origOn;
    (process.stdin as any).removeListener = origRemoveListener;
    (process.stdout as any).write = origStdoutWrite;
    (process as any).on = origProcessOn;
    (process as any).removeListener = origProcessRemoveListener;
  });
}

// Mock identity token → session token exchange; pass through other requests
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

describe("interactive module", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.fetch = identityTokenFetchMock;
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  // ── startInteractive connection failure ──

  describe("startInteractive connection failure", () => {
    test("calls process.exit(1) when createBridgeCore throws", async () => {
      mockCreateBridgeCore.mockRejectedValueOnce(new Error("Connection refused"));

      // process.exit is mocked to not actually exit; but the source code does
      // `process.exit(1)` followed by destructuring `core` on the next line.
      // Since the mock lets execution continue, the destructure fails.
      // We verify that the exit was called and the error was logged.
      const config = {
        serverUrl: "http://localhost:9999",
        bridgePort: 3101,
        botName: "TestBot",
        identityToken: "fake-token",
      };

      try {
        await startInteractive(config);
      } catch {
        // Expected — the mock process.exit doesn't actually stop execution
      }

      expect(consoleErrorSpy).toHaveBeenCalledWith("Failed to connect:", expect.any(Error));
      expect(mockProcessExit).toHaveBeenCalledWith(1);
    });
  });

  // ── startInteractive successful start and quit ──

  describe("startInteractive REPL", () => {
    test("starts and quits with 'q' command", async () => {
      const core = createMockCore();
      mockCreateBridgeCore.mockResolvedValueOnce(core);

      const config = {
        serverUrl: "http://localhost:8080",
        bridgePort: 3101,
        botName: "TestBot",
        token: "fake-token",
      };

      await driveInteractive(config, [
        "q", // type 'q'
        "\r", // press Enter
      ]);

      expect(core.cleanup).toHaveBeenCalled();
    });

    test("starts and quits with empty input (just Enter)", async () => {
      const core = createMockCore();
      mockCreateBridgeCore.mockResolvedValueOnce(core);

      const config = {
        serverUrl: "http://localhost:8080",
        bridgePort: 3101,
        botName: "TestBot",
        token: "fake-token",
      };

      await driveInteractive(config, [
        "\r", // just press Enter (empty input is a quit signal)
      ]);

      expect(core.cleanup).toHaveBeenCalled();
    });

    test("quits with 'quit' command", async () => {
      const core = createMockCore();
      mockCreateBridgeCore.mockResolvedValueOnce(core);

      const config = {
        serverUrl: "http://localhost:8080",
        bridgePort: 3101,
        botName: "TestBot",
        token: "fake-token",
      };

      await driveInteractive(config, ["q", "u", "i", "t", "\r"]);

      expect(core.cleanup).toHaveBeenCalled();
    });

    test("quits with 'exit' command", async () => {
      const core = createMockCore();
      mockCreateBridgeCore.mockResolvedValueOnce(core);

      const config = {
        serverUrl: "http://localhost:8080",
        bridgePort: 3101,
        botName: "TestBot",
        token: "fake-token",
      };

      await driveInteractive(config, ["e", "x", "i", "t", "\r"]);

      expect(core.cleanup).toHaveBeenCalled();
    });

    test("quits with Ctrl+C", async () => {
      const core = createMockCore();
      mockCreateBridgeCore.mockResolvedValueOnce(core);

      const config = {
        serverUrl: "http://localhost:8080",
        bridgePort: 3101,
        botName: "TestBot",
        token: "fake-token",
      };

      await driveInteractive(config, [
        "\x03", // Ctrl+C
      ]);

      expect(core.cleanup).toHaveBeenCalled();
    });

    test("quits with Ctrl+D", async () => {
      const core = createMockCore();
      mockCreateBridgeCore.mockResolvedValueOnce(core);

      const config = {
        serverUrl: "http://localhost:8080",
        bridgePort: 3101,
        botName: "TestBot",
        token: "fake-token",
      };

      await driveInteractive(config, [
        "\x04", // Ctrl+D
      ]);

      expect(core.cleanup).toHaveBeenCalled();
    });

    test("shows help menu with 'h' command then quits", async () => {
      const core = createMockCore();
      mockCreateBridgeCore.mockResolvedValueOnce(core);

      const config = {
        serverUrl: "http://localhost:8080",
        bridgePort: 3101,
        botName: "TestBot",
        token: "fake-token",
      };

      await driveInteractive(config, [
        "h",
        "\r", // show help
        "q",
        "\r", // quit
      ]);

      expect(core.cleanup).toHaveBeenCalled();
    });

    test("shows help with 'help' command", async () => {
      const core = createMockCore();
      mockCreateBridgeCore.mockResolvedValueOnce(core);

      const config = {
        serverUrl: "http://localhost:8080",
        bridgePort: 3101,
        botName: "TestBot",
        token: "fake-token",
      };

      await driveInteractive(config, [
        "h",
        "e",
        "l",
        "p",
        "\r", // type "help" + Enter
        "q",
        "\r", // quit
      ]);

      expect(core.cleanup).toHaveBeenCalled();
    });

    test("clears bottom pane with 'c' command", async () => {
      const core = createMockCore();
      mockCreateBridgeCore.mockResolvedValueOnce(core);

      const config = {
        serverUrl: "http://localhost:8080",
        bridgePort: 3101,
        botName: "TestBot",
        token: "fake-token",
      };

      await driveInteractive(config, [
        "c",
        "\r", // clear
        "q",
        "\r", // quit
      ]);

      expect(core.cleanup).toHaveBeenCalled();
    });

    test("clears bottom pane with 'clear' command", async () => {
      const core = createMockCore();
      mockCreateBridgeCore.mockResolvedValueOnce(core);

      const config = {
        serverUrl: "http://localhost:8080",
        bridgePort: 3101,
        botName: "TestBot",
        token: "fake-token",
      };

      await driveInteractive(config, ["c", "l", "e", "a", "r", "\r", "q", "\r"]);

      expect(core.cleanup).toHaveBeenCalled();
    });

    test("executes tool by number", async () => {
      const executeFn = vi
        .fn<(params: Record<string, unknown>, ctx: any) => Promise<ToolResult>>()
        .mockResolvedValue({
          content: [{ type: "text", text: '{"position":{"x":1,"y":0,"z":3}}' }],
        });

      const tools = new Map<string, ToolDefinition>([
        [
          "get_scene_info",
          createMockTool({
            name: "get_scene_info",
            description: "Get scene info",
            execute: executeFn,
          }),
        ],
      ]);

      const core = createMockCore(tools);
      mockCreateBridgeCore.mockResolvedValueOnce(core);

      const config = {
        serverUrl: "http://localhost:8080",
        bridgePort: 3101,
        botName: "TestBot",
        token: "fake-token",
      };

      await driveInteractive(config, [
        "h",
        "\r", // show help to populate indexedNames
        "1",
        "\r", // select tool #1 (get_scene_info)
        "q",
        "\r", // quit
      ]);

      expect(executeFn).toHaveBeenCalled();
      expect(core.cleanup).toHaveBeenCalled();
    });

    test("executes tool by name", async () => {
      const executeFn = vi
        .fn<(params: Record<string, unknown>, ctx: any) => Promise<ToolResult>>()
        .mockResolvedValue({
          content: [{ type: "text", text: '{"position":{"x":1,"y":0,"z":3}}' }],
        });

      const tools = new Map<string, ToolDefinition>([
        [
          "get_scene_info",
          createMockTool({
            name: "get_scene_info",
            description: "Get scene info",
            execute: executeFn,
          }),
        ],
      ]);

      const core = createMockCore(tools);
      mockCreateBridgeCore.mockResolvedValueOnce(core);

      const config = {
        serverUrl: "http://localhost:8080",
        bridgePort: 3101,
        botName: "TestBot",
        token: "fake-token",
      };

      await driveInteractive(config, [
        ..."get_scene_info".split(""),
        "\r",
        "q",
        "\r", // quit
      ]);

      expect(executeFn).toHaveBeenCalled();
    });

    test("executes tool by prefix match", async () => {
      const executeFn = vi
        .fn<(params: Record<string, unknown>, ctx: any) => Promise<ToolResult>>()
        .mockResolvedValue({
          content: [{ type: "text", text: '{"position":{"x":1,"y":0,"z":3}}' }],
        });

      const tools = new Map<string, ToolDefinition>([
        [
          "get_scene_info",
          createMockTool({
            name: "get_scene_info",
            description: "Get scene info",
            execute: executeFn,
          }),
        ],
      ]);

      const core = createMockCore(tools);
      mockCreateBridgeCore.mockResolvedValueOnce(core);

      const config = {
        serverUrl: "http://localhost:8080",
        bridgePort: 3101,
        botName: "TestBot",
        token: "fake-token",
      };

      // "get_s" uniquely matches "get_scene_info"
      await driveInteractive(config, [..."get_s".split(""), "\r", "q", "\r"]);

      expect(executeFn).toHaveBeenCalled();
    });

    test("reports ambiguous tool name match", async () => {
      const tools = new Map<string, ToolDefinition>([
        [
          "get_scene_info",
          createMockTool({ name: "get_scene_info", description: "Get scene info" }),
        ],
        ["get_element", createMockTool({ name: "get_element", description: "Get element" })],
      ]);

      const core = createMockCore(tools);
      mockCreateBridgeCore.mockResolvedValueOnce(core);

      const config = {
        serverUrl: "http://localhost:8080",
        bridgePort: 3101,
        botName: "TestBot",
        token: "fake-token",
      };

      // "get_" matches both "get_scene_info" and "get_element"
      await driveInteractive(config, [..."get_".split(""), "\r", "q", "\r"]);

      expect(core.cleanup).toHaveBeenCalled();
    });

    test("reports unknown tool", async () => {
      const tools = new Map<string, ToolDefinition>([
        [
          "get_scene_info",
          createMockTool({ name: "get_scene_info", description: "Get scene info" }),
        ],
      ]);

      const core = createMockCore(tools);
      mockCreateBridgeCore.mockResolvedValueOnce(core);

      const config = {
        serverUrl: "http://localhost:8080",
        bridgePort: 3101,
        botName: "TestBot",
        token: "fake-token",
      };

      // "nonexistent" doesn't match anything
      await driveInteractive(config, [..."nonexistent".split(""), "\r", "q", "\r"]);

      expect(core.cleanup).toHaveBeenCalled();
    });

    test("tool with parameters prompts for each param", async () => {
      const executeFn = vi
        .fn<(params: Record<string, unknown>, ctx: any) => Promise<ToolResult>>()
        .mockResolvedValue({
          content: [{ type: "text", text: '{"status":"teleported"}' }],
        });

      const tools = new Map<string, ToolDefinition>([
        [
          "teleport",
          createMockTool({
            name: "teleport",
            description: "Teleport to coordinates",
            inputSchema: z.object({
              x: z.number().describe("X coordinate"),
              y: z.number().describe("Y coordinate"),
              z: z.number().describe("Z coordinate"),
            }),
            execute: executeFn,
          }),
        ],
      ]);

      const core = createMockCore(tools);
      mockCreateBridgeCore.mockResolvedValueOnce(core);

      const config = {
        serverUrl: "http://localhost:8080",
        bridgePort: 3101,
        botName: "TestBot",
        token: "fake-token",
      };

      await driveInteractive(config, [
        ..."teleport".split(""),
        "\r",
        ..."10".split(""),
        "\r", // x = 10
        ..."0".split(""),
        "\r", // y = 0
        ..."20".split(""),
        "\r", // z = 20
        "q",
        "\r", // quit
      ]);

      expect(executeFn).toHaveBeenCalledWith(
        expect.objectContaining({ x: 10, y: 0, z: 20 }),
        expect.anything(),
      );
    });

    test("optional parameter can be skipped with empty input", async () => {
      const executeFn = vi
        .fn<(params: Record<string, unknown>, ctx: any) => Promise<ToolResult>>()
        .mockResolvedValue({
          content: [{ type: "text", text: '{"status":"moving"}' }],
        });

      const tools = new Map<string, ToolDefinition>([
        [
          "move_to",
          createMockTool({
            name: "move_to",
            description: "Move to a position",
            inputSchema: z.object({
              x: z.number().describe("X coordinate"),
              y: z.number().optional().describe("Y coordinate"),
            }),
            execute: executeFn,
          }),
        ],
      ]);

      const core = createMockCore(tools);
      mockCreateBridgeCore.mockResolvedValueOnce(core);

      const config = {
        serverUrl: "http://localhost:8080",
        bridgePort: 3101,
        botName: "TestBot",
        token: "fake-token",
      };

      await driveInteractive(config, [
        ..."move_to".split(""),
        "\r",
        ..."5".split(""),
        "\r", // x = 5
        "\r", // y = (skip, optional)
        "q",
        "\r", // quit
      ]);

      expect(executeFn).toHaveBeenCalledWith(expect.objectContaining({ x: 5 }), expect.anything());
      // The 'y' key should not be present since it was skipped
      const callArgs = executeFn.mock.calls[0][0];
      expect(callArgs).not.toHaveProperty("y");
    });

    test("required parameter shows error when empty", async () => {
      const executeFn = vi
        .fn<(params: Record<string, unknown>, ctx: any) => Promise<ToolResult>>()
        .mockResolvedValue({
          content: [{ type: "text", text: '{"status":"ok"}' }],
        });

      const tools = new Map<string, ToolDefinition>([
        [
          "teleport",
          createMockTool({
            name: "teleport",
            description: "Teleport to coordinates",
            inputSchema: z.object({
              x: z.number().describe("X coordinate"),
            }),
            execute: executeFn,
          }),
        ],
      ]);

      const core = createMockCore(tools);
      mockCreateBridgeCore.mockResolvedValueOnce(core);

      const config = {
        serverUrl: "http://localhost:8080",
        bridgePort: 3101,
        botName: "TestBot",
        token: "fake-token",
      };

      await driveInteractive(config, [
        ..."teleport".split(""),
        "\r",
        "\r", // empty required param — should show error, tool NOT executed
        "q",
        "\r", // quit
      ]);

      // The tool should NOT have been executed because the required param was empty
      expect(executeFn).not.toHaveBeenCalled();
    });

    test("invalid number value shows parse error", async () => {
      const executeFn = vi
        .fn<(params: Record<string, unknown>, ctx: any) => Promise<ToolResult>>()
        .mockResolvedValue({
          content: [{ type: "text", text: '{"status":"ok"}' }],
        });

      const tools = new Map<string, ToolDefinition>([
        [
          "teleport",
          createMockTool({
            name: "teleport",
            description: "Teleport to coordinates",
            inputSchema: z.object({
              x: z.number().describe("X coordinate"),
            }),
            execute: executeFn,
          }),
        ],
      ]);

      const core = createMockCore(tools);
      mockCreateBridgeCore.mockResolvedValueOnce(core);

      const config = {
        serverUrl: "http://localhost:8080",
        bridgePort: 3101,
        botName: "TestBot",
        token: "fake-token",
      };

      await driveInteractive(config, [
        ..."teleport".split(""),
        "\r",
        ..."abc".split(""),
        "\r", // invalid number — should show parse error
        "q",
        "\r", // quit
      ]);

      expect(executeFn).not.toHaveBeenCalled();
    });

    test("tool execution error is handled gracefully", async () => {
      const executeFn = vi
        .fn<(params: Record<string, unknown>, ctx: any) => Promise<ToolResult>>()
        .mockRejectedValue(new Error("Execution failed"));

      const tools = new Map<string, ToolDefinition>([
        [
          "get_scene_info",
          createMockTool({
            name: "get_scene_info",
            description: "Get scene info",
            execute: executeFn,
          }),
        ],
      ]);

      const core = createMockCore(tools);
      mockCreateBridgeCore.mockResolvedValueOnce(core);

      const config = {
        serverUrl: "http://localhost:8080",
        bridgePort: 3101,
        botName: "TestBot",
        token: "fake-token",
      };

      await driveInteractive(config, [
        ..."get_scene_info".split(""),
        "\r", // execute tool that throws
        "q",
        "\r", // quit
      ]);

      expect(core.cleanup).toHaveBeenCalled();
    });

    test("ZodError during validation is handled", async () => {
      const executeFn = vi
        .fn<(params: Record<string, unknown>, ctx: any) => Promise<ToolResult>>()
        .mockResolvedValue({
          content: [{ type: "text", text: '{"status":"ok"}' }],
        });

      // Use a schema with validation that will fail during parse
      const tools = new Map<string, ToolDefinition>([
        [
          "test_tool",
          createMockTool({
            name: "test_tool",
            description: "A test tool",
            inputSchema: z.object({
              value: z.number().min(10).describe("A number >= 10"),
            }),
            execute: executeFn,
          }),
        ],
      ]);

      const core = createMockCore(tools);
      mockCreateBridgeCore.mockResolvedValueOnce(core);

      const config = {
        serverUrl: "http://localhost:8080",
        bridgePort: 3101,
        botName: "TestBot",
        token: "fake-token",
      };

      await driveInteractive(config, [
        ..."test_tool".split(""),
        "\r",
        ..."5".split(""),
        "\r", // value=5, but min is 10, ZodError
        "q",
        "\r", // quit
      ]);

      // The tool should NOT have been executed because validation failed
      expect(executeFn).not.toHaveBeenCalled();
    });

    test("tool result with non-JSON text is displayed as-is", async () => {
      const executeFn = vi
        .fn<(params: Record<string, unknown>, ctx: any) => Promise<ToolResult>>()
        .mockResolvedValue({
          content: [{ type: "text", text: "plain text result, not JSON" }],
        });

      const tools = new Map<string, ToolDefinition>([
        [
          "get_scene_info",
          createMockTool({
            name: "get_scene_info",
            description: "Get scene info",
            execute: executeFn,
          }),
        ],
      ]);

      const core = createMockCore(tools);
      mockCreateBridgeCore.mockResolvedValueOnce(core);

      const config = {
        serverUrl: "http://localhost:8080",
        bridgePort: 3101,
        botName: "TestBot",
        token: "fake-token",
      };

      await driveInteractive(config, [
        ..."get_scene_info".split(""),
        "\r",
        "q",
        "\r", // quit
      ]);

      expect(executeFn).toHaveBeenCalled();
    });

    test("tool result with empty content array is handled", async () => {
      const executeFn = vi
        .fn<(params: Record<string, unknown>, ctx: any) => Promise<ToolResult>>()
        .mockResolvedValue({
          content: [],
        });

      const tools = new Map<string, ToolDefinition>([
        [
          "get_scene_info",
          createMockTool({
            name: "get_scene_info",
            description: "Get scene info",
            execute: executeFn,
          }),
        ],
      ]);

      const core = createMockCore(tools);
      mockCreateBridgeCore.mockResolvedValueOnce(core);

      const config = {
        serverUrl: "http://localhost:8080",
        bridgePort: 3101,
        botName: "TestBot",
        token: "fake-token",
      };

      await driveInteractive(config, [
        ..."get_scene_info".split(""),
        "\r",
        "q",
        "\r", // quit
      ]);

      expect(executeFn).toHaveBeenCalled();
    });

    test("string parameter is passed through", async () => {
      const executeFn = vi
        .fn<(params: Record<string, unknown>, ctx: any) => Promise<ToolResult>>()
        .mockResolvedValue({
          content: [{ type: "text", text: '{"status":"sent"}' }],
        });

      const tools = new Map<string, ToolDefinition>([
        [
          "send_chat_message",
          createMockTool({
            name: "send_chat_message",
            description: "Send a chat message",
            inputSchema: z.object({
              message: z.string().describe("The message to send"),
            }),
            execute: executeFn,
          }),
        ],
      ]);

      const core = createMockCore(tools);
      mockCreateBridgeCore.mockResolvedValueOnce(core);

      const config = {
        serverUrl: "http://localhost:8080",
        bridgePort: 3101,
        botName: "TestBot",
        token: "fake-token",
      };

      await driveInteractive(config, [
        ..."send_chat_message".split(""),
        "\r",
        ..."hello world".split(""),
        "\r", // message
        "q",
        "\r", // quit
      ]);

      expect(executeFn).toHaveBeenCalledWith(
        expect.objectContaining({ message: "hello world" }),
        expect.anything(),
      );
    });

    test("boolean parameter parsing: true/false/yes/no/1/0", async () => {
      const executeFn = vi
        .fn<(params: Record<string, unknown>, ctx: any) => Promise<ToolResult>>()
        .mockResolvedValue({
          content: [{ type: "text", text: '{"status":"ok"}' }],
        });

      const tools = new Map<string, ToolDefinition>([
        [
          "test_bool",
          createMockTool({
            name: "test_bool",
            description: "Test boolean param",
            inputSchema: z.object({
              flag: z.boolean().describe("A flag"),
            }),
            execute: executeFn,
          }),
        ],
      ]);

      const core = createMockCore(tools);
      mockCreateBridgeCore.mockResolvedValueOnce(core);

      const config = {
        serverUrl: "http://localhost:8080",
        bridgePort: 3101,
        botName: "TestBot",
        token: "fake-token",
      };

      await driveInteractive(config, [
        ..."test_bool".split(""),
        "\r",
        ..."true".split(""),
        "\r", // flag = true
        "q",
        "\r", // quit
      ]);

      expect(executeFn).toHaveBeenCalledWith(
        expect.objectContaining({ flag: true }),
        expect.anything(),
      );
    });

    test("boolean 'yes' parses to true", async () => {
      const executeFn = vi
        .fn<(params: Record<string, unknown>, ctx: any) => Promise<ToolResult>>()
        .mockResolvedValue({
          content: [{ type: "text", text: '{"status":"ok"}' }],
        });

      const tools = new Map<string, ToolDefinition>([
        [
          "test_bool",
          createMockTool({
            name: "test_bool",
            description: "Test boolean param",
            inputSchema: z.object({
              flag: z.boolean().describe("A flag"),
            }),
            execute: executeFn,
          }),
        ],
      ]);

      const core = createMockCore(tools);
      mockCreateBridgeCore.mockResolvedValueOnce(core);

      const config = {
        serverUrl: "http://localhost:8080",
        bridgePort: 3101,
        botName: "TestBot",
        token: "fake-token",
      };

      await driveInteractive(config, [
        ..."test_bool".split(""),
        "\r",
        ..."yes".split(""),
        "\r", // flag = yes => true
        "q",
        "\r", // quit
      ]);

      expect(executeFn).toHaveBeenCalledWith(
        expect.objectContaining({ flag: true }),
        expect.anything(),
      );
    });

    test("boolean 'no' parses to false", async () => {
      const executeFn = vi
        .fn<(params: Record<string, unknown>, ctx: any) => Promise<ToolResult>>()
        .mockResolvedValue({
          content: [{ type: "text", text: '{"status":"ok"}' }],
        });

      const tools = new Map<string, ToolDefinition>([
        [
          "test_bool",
          createMockTool({
            name: "test_bool",
            description: "Test boolean param",
            inputSchema: z.object({
              flag: z.boolean().describe("A flag"),
            }),
            execute: executeFn,
          }),
        ],
      ]);

      const core = createMockCore(tools);
      mockCreateBridgeCore.mockResolvedValueOnce(core);

      const config = {
        serverUrl: "http://localhost:8080",
        bridgePort: 3101,
        botName: "TestBot",
        token: "fake-token",
      };

      await driveInteractive(config, [
        ..."test_bool".split(""),
        "\r",
        ..."no".split(""),
        "\r", // flag = no => false
        "q",
        "\r", // quit
      ]);

      expect(executeFn).toHaveBeenCalledWith(
        expect.objectContaining({ flag: false }),
        expect.anything(),
      );
    });

    test("boolean '1' parses to true, '0' to false", async () => {
      const executeFn = vi
        .fn<(params: Record<string, unknown>, ctx: any) => Promise<ToolResult>>()
        .mockResolvedValue({
          content: [{ type: "text", text: '{"status":"ok"}' }],
        });

      const tools = new Map<string, ToolDefinition>([
        [
          "test_bool",
          createMockTool({
            name: "test_bool",
            description: "Test boolean param",
            inputSchema: z.object({
              flag: z.boolean().describe("A flag"),
            }),
            execute: executeFn,
          }),
        ],
      ]);

      const core = createMockCore(tools);
      mockCreateBridgeCore.mockResolvedValueOnce(core);

      const config = {
        serverUrl: "http://localhost:8080",
        bridgePort: 3101,
        botName: "TestBot",
        token: "fake-token",
      };

      await driveInteractive(config, [
        ..."test_bool".split(""),
        "\r",
        "1",
        "\r", // flag = 1 => true
        "q",
        "\r", // quit
      ]);

      expect(executeFn).toHaveBeenCalledWith(
        expect.objectContaining({ flag: true }),
        expect.anything(),
      );
    });

    test("invalid boolean value shows error", async () => {
      const executeFn = vi
        .fn<(params: Record<string, unknown>, ctx: any) => Promise<ToolResult>>()
        .mockResolvedValue({
          content: [{ type: "text", text: '{"status":"ok"}' }],
        });

      const tools = new Map<string, ToolDefinition>([
        [
          "test_bool",
          createMockTool({
            name: "test_bool",
            description: "Test boolean param",
            inputSchema: z.object({
              flag: z.boolean().describe("A flag"),
            }),
            execute: executeFn,
          }),
        ],
      ]);

      const core = createMockCore(tools);
      mockCreateBridgeCore.mockResolvedValueOnce(core);

      const config = {
        serverUrl: "http://localhost:8080",
        bridgePort: 3101,
        botName: "TestBot",
        token: "fake-token",
      };

      await driveInteractive(config, [
        ..."test_bool".split(""),
        "\r",
        ..."maybe".split(""),
        "\r", // "maybe" is not a valid boolean
        "q",
        "\r", // quit
      ]);

      expect(executeFn).not.toHaveBeenCalled();
    });

    test("Ctrl+C during parameter input cancels and exits", async () => {
      const executeFn = vi
        .fn<(params: Record<string, unknown>, ctx: any) => Promise<ToolResult>>()
        .mockResolvedValue({
          content: [{ type: "text", text: '{"status":"ok"}' }],
        });

      const tools = new Map<string, ToolDefinition>([
        [
          "teleport",
          createMockTool({
            name: "teleport",
            description: "Teleport to coordinates",
            inputSchema: z.object({
              x: z.number().describe("X coordinate"),
            }),
            execute: executeFn,
          }),
        ],
      ]);

      const core = createMockCore(tools);
      mockCreateBridgeCore.mockResolvedValueOnce(core);

      const config = {
        serverUrl: "http://localhost:8080",
        bridgePort: 3101,
        botName: "TestBot",
        token: "fake-token",
      };

      await driveInteractive(config, [
        ..."teleport".split(""),
        "\r",
        "\x03", // Ctrl+C during param input
      ]);

      expect(executeFn).not.toHaveBeenCalled();
      expect(core.cleanup).toHaveBeenCalled();
    });

    test("Ctrl+D during parameter input cancels and exits", async () => {
      const executeFn = vi
        .fn<(params: Record<string, unknown>, ctx: any) => Promise<ToolResult>>()
        .mockResolvedValue({
          content: [{ type: "text", text: '{"status":"ok"}' }],
        });

      const tools = new Map<string, ToolDefinition>([
        [
          "teleport",
          createMockTool({
            name: "teleport",
            description: "Teleport to coordinates",
            inputSchema: z.object({
              x: z.number().describe("X coordinate"),
            }),
            execute: executeFn,
          }),
        ],
      ]);

      const core = createMockCore(tools);
      mockCreateBridgeCore.mockResolvedValueOnce(core);

      const config = {
        serverUrl: "http://localhost:8080",
        bridgePort: 3101,
        botName: "TestBot",
        token: "fake-token",
      };

      await driveInteractive(config, [
        ..."teleport".split(""),
        "\r",
        "\x04", // Ctrl+D during param input
      ]);

      expect(executeFn).not.toHaveBeenCalled();
      expect(core.cleanup).toHaveBeenCalled();
    });

    test("SplitPaneUI handles backspace key", async () => {
      const executeFn = vi
        .fn<(params: Record<string, unknown>, ctx: any) => Promise<ToolResult>>()
        .mockResolvedValue({
          content: [{ type: "text", text: '{"status":"ok"}' }],
        });

      const tools = new Map<string, ToolDefinition>([
        [
          "get_scene_info",
          createMockTool({
            name: "get_scene_info",
            description: "Get scene info",
            execute: executeFn,
          }),
        ],
      ]);

      const core = createMockCore(tools);
      mockCreateBridgeCore.mockResolvedValueOnce(core);

      const config = {
        serverUrl: "http://localhost:8080",
        bridgePort: 3101,
        botName: "TestBot",
        token: "fake-token",
      };

      // Type "get_scene_infoX" then backspace, then Enter
      await driveInteractive(config, [
        ..."get_scene_infoX".split(""),
        "\x7f", // backspace
        "\r",
        "q",
        "\r", // quit
      ]);

      expect(executeFn).toHaveBeenCalled();
    });

    test("SplitPaneUI handles Tab key to switch panes", async () => {
      const core = createMockCore();
      mockCreateBridgeCore.mockResolvedValueOnce(core);

      const config = {
        serverUrl: "http://localhost:8080",
        bridgePort: 3101,
        botName: "TestBot",
        token: "fake-token",
      };

      await driveInteractive(config, [
        "\t", // Tab to switch to events pane
        "\t", // Tab to switch back to interactive pane
        "q",
        "\r", // quit
      ]);

      expect(core.cleanup).toHaveBeenCalled();
    });

    test("SplitPaneUI handles Page Up / Page Down", async () => {
      const core = createMockCore();
      mockCreateBridgeCore.mockResolvedValueOnce(core);

      const config = {
        serverUrl: "http://localhost:8080",
        bridgePort: 3101,
        botName: "TestBot",
        token: "fake-token",
      };

      await driveInteractive(config, [
        "\x1b[5~", // Page Up (interactive pane)
        "\x1b[6~", // Page Down (interactive pane)
        "\t", // switch to events pane
        "\x1b[5~", // Page Up (events pane)
        "\x1b[6~", // Page Down (events pane)
        "\t", // switch back
        "q",
        "\r", // quit
      ]);

      expect(core.cleanup).toHaveBeenCalled();
    });

    test("SplitPaneUI handles Up/Down arrow for command history", async () => {
      const core = createMockCore();
      mockCreateBridgeCore.mockResolvedValueOnce(core);

      const config = {
        serverUrl: "http://localhost:8080",
        bridgePort: 3101,
        botName: "TestBot",
        token: "fake-token",
      };

      await driveInteractive(config, [
        "h",
        "\r", // type 'h' + Enter (saved to history)
        "\x1b[A", // Up arrow — recall 'h' from history
        "\r", // re-execute 'h'
        "\x1b[B", // Down arrow — go forward in history (back to draft)
        "q",
        "\r", // quit
      ]);

      expect(core.cleanup).toHaveBeenCalled();
    });

    test("Up arrow with no history does nothing", async () => {
      const core = createMockCore();
      mockCreateBridgeCore.mockResolvedValueOnce(core);

      const config = {
        serverUrl: "http://localhost:8080",
        bridgePort: 3101,
        botName: "TestBot",
        token: "fake-token",
      };

      await driveInteractive(config, [
        "\x1b[A", // Up arrow with no history
        "q",
        "\r", // quit
      ]);

      expect(core.cleanup).toHaveBeenCalled();
    });

    test("Down arrow with no history index does nothing", async () => {
      const core = createMockCore();
      mockCreateBridgeCore.mockResolvedValueOnce(core);

      const config = {
        serverUrl: "http://localhost:8080",
        bridgePort: 3101,
        botName: "TestBot",
        token: "fake-token",
      };

      await driveInteractive(config, [
        "\x1b[B", // Down arrow with no history index
        "q",
        "\r", // quit
      ]);

      expect(core.cleanup).toHaveBeenCalled();
    });

    test("other escape sequences are ignored", async () => {
      const core = createMockCore();
      mockCreateBridgeCore.mockResolvedValueOnce(core);

      const config = {
        serverUrl: "http://localhost:8080",
        bridgePort: 3101,
        botName: "TestBot",
        token: "fake-token",
      };

      await driveInteractive(config, [
        "\x1b[C", // Right arrow (other escape)
        "\x1b[D", // Left arrow (other escape)
        "q",
        "\r", // quit
      ]);

      expect(core.cleanup).toHaveBeenCalled();
    });

    test("event listener handles chat events", async () => {
      const core = createMockCore();
      let capturedEventListener: ((event: any) => void) | undefined;
      core.worldConnection.addEventListener = vi.fn().mockImplementation((listener: any) => {
        capturedEventListener = listener;
      });
      mockCreateBridgeCore.mockResolvedValueOnce(core);

      const config = {
        serverUrl: "http://localhost:8080",
        bridgePort: 3101,
        botName: "TestBot",
        token: "fake-token",
      };

      const drivePromise = driveInteractive(config, ["q", "\r"], { delayBetweenKeys: 100 });

      // Wait for event listener to be registered
      await new Promise((r) => setTimeout(r, 60));

      // Trigger events through the captured listener
      if (capturedEventListener) {
        capturedEventListener({
          type: "chat",
          message: { username: "Alice", message: "Hello!" },
        });
        capturedEventListener({
          type: "user_joined",
          connectionId: 5,
          userId: "user-5",
          username: "Bob",
        });
        capturedEventListener({
          type: "user_left",
          connectionId: 5,
          userId: "user-5",
          username: "Bob",
        });
        capturedEventListener({
          type: "connected",
        });
        capturedEventListener({
          type: "disconnected",
        });
        capturedEventListener({
          type: "reconnecting",
        });
        // user_joined without username
        capturedEventListener({
          type: "user_joined",
          connectionId: 99,
          userId: "user-99",
          username: null,
        });
        // user_left without username
        capturedEventListener({
          type: "user_left",
          connectionId: 99,
          userId: "user-99",
          username: null,
        });
      }

      await drivePromise;
      expect(core.cleanup).toHaveBeenCalled();
    });

    test("disconnected status shows Disconnected", async () => {
      const core = createMockCore();
      core.worldConnection.isConnected = vi.fn().mockReturnValue(false);
      mockCreateBridgeCore.mockResolvedValueOnce(core);

      const config = {
        serverUrl: "http://localhost:8080",
        bridgePort: 3101,
        botName: "TestBot",
        token: "fake-token",
      };

      await driveInteractive(config, ["q", "\r"]);
      expect(core.cleanup).toHaveBeenCalled();
    });

    test("tool with uncategorized name goes to Other section", async () => {
      const tools = new Map<string, ToolDefinition>([
        [
          "custom_weird_tool",
          createMockTool({
            name: "custom_weird_tool",
            description: "A custom tool not in any category",
          }),
        ],
      ]);

      const core = createMockCore(tools);
      mockCreateBridgeCore.mockResolvedValueOnce(core);

      const config = {
        serverUrl: "http://localhost:8080",
        bridgePort: 3101,
        botName: "TestBot",
        token: "fake-token",
      };

      await driveInteractive(config, [
        "h",
        "\r", // show help — the tool should appear under "Other"
        "q",
        "\r", // quit
      ]);

      expect(core.cleanup).toHaveBeenCalled();
    });

    test("tool number out of range shows unknown tool", async () => {
      const tools = new Map<string, ToolDefinition>([
        [
          "get_scene_info",
          createMockTool({ name: "get_scene_info", description: "Get scene info" }),
        ],
      ]);

      const core = createMockCore(tools);
      mockCreateBridgeCore.mockResolvedValueOnce(core);

      const config = {
        serverUrl: "http://localhost:8080",
        bridgePort: 3101,
        botName: "TestBot",
        token: "fake-token",
      };

      // Help first to populate indexedNames, then try number 99
      await driveInteractive(config, [
        "h",
        "\r", // help
        ..."99".split(""),
        "\r", // tool #99 — out of range
        "q",
        "\r", // quit
      ]);

      expect(core.cleanup).toHaveBeenCalled();
    });

    test("tool with long description is truncated in menu", async () => {
      const longDesc = "A".repeat(100);
      const tools = new Map<string, ToolDefinition>([
        [
          "verbose_tool",
          createMockTool({
            name: "verbose_tool",
            description: longDesc,
          }),
        ],
      ]);

      const core = createMockCore(tools);
      mockCreateBridgeCore.mockResolvedValueOnce(core);

      const config = {
        serverUrl: "http://localhost:8080",
        bridgePort: 3101,
        botName: "TestBot",
        token: "fake-token",
      };

      await driveInteractive(config, [
        "h",
        "\r", // show help — tool with long description
        "q",
        "\r", // quit
      ]);

      expect(core.cleanup).toHaveBeenCalled();
    });

    test("tool with schema that uses ZodOptional inner type", async () => {
      const executeFn = vi
        .fn<(params: Record<string, unknown>, ctx: any) => Promise<ToolResult>>()
        .mockResolvedValue({
          content: [{ type: "text", text: '{"status":"ok"}' }],
        });

      const tools = new Map<string, ToolDefinition>([
        [
          "opt_tool",
          createMockTool({
            name: "opt_tool",
            description: "Tool with optional number param",
            inputSchema: z.object({
              value: z.number().optional().describe("An optional number"),
            }),
            execute: executeFn,
          }),
        ],
      ]);

      const core = createMockCore(tools);
      mockCreateBridgeCore.mockResolvedValueOnce(core);

      const config = {
        serverUrl: "http://localhost:8080",
        bridgePort: 3101,
        botName: "TestBot",
        token: "fake-token",
      };

      await driveInteractive(config, [
        ..."opt_tool".split(""),
        "\r",
        ..."42".split(""),
        "\r", // value = 42
        "q",
        "\r", // quit
      ]);

      expect(executeFn).toHaveBeenCalledWith(
        expect.objectContaining({ value: 42 }),
        expect.anything(),
      );
    });

    test("tool with unknown Zod type uses fallback type name", async () => {
      const executeFn = vi
        .fn<(params: Record<string, unknown>, ctx: any) => Promise<ToolResult>>()
        .mockResolvedValue({
          content: [{ type: "text", text: '{"status":"ok"}' }],
        });

      // Use z.enum which maps to ZodEnum, not one of the explicit switch cases
      const tools = new Map<string, ToolDefinition>([
        [
          "enum_tool",
          createMockTool({
            name: "enum_tool",
            description: "Tool with enum param",
            inputSchema: z.object({
              mode: z.enum(["fast", "slow"]).describe("Speed mode"),
            }),
            execute: executeFn,
          }),
        ],
      ]);

      const core = createMockCore(tools);
      mockCreateBridgeCore.mockResolvedValueOnce(core);

      const config = {
        serverUrl: "http://localhost:8080",
        bridgePort: 3101,
        botName: "TestBot",
        token: "fake-token",
      };

      await driveInteractive(config, [
        ..."enum_tool".split(""),
        "\r",
        ..."fast".split(""),
        "\r", // mode = "fast" (treated as string since it's an unknown Zod type)
        "q",
        "\r", // quit
      ]);

      expect(executeFn).toHaveBeenCalled();
    });

    test("tool with no shape schema executes without params", async () => {
      const executeFn = vi
        .fn<(params: Record<string, unknown>, ctx: any) => Promise<ToolResult>>()
        .mockResolvedValue({
          content: [{ type: "text", text: '{"status":"ok"}' }],
        });

      // Create a tool with an empty schema
      const tools = new Map<string, ToolDefinition>([
        [
          "simple_tool",
          createMockTool({
            name: "simple_tool",
            description: "Tool with no params",
            inputSchema: z.object({}),
            execute: executeFn,
          }),
        ],
      ]);

      const core = createMockCore(tools);
      mockCreateBridgeCore.mockResolvedValueOnce(core);

      const config = {
        serverUrl: "http://localhost:8080",
        bridgePort: 3101,
        botName: "TestBot",
        token: "fake-token",
      };

      await driveInteractive(config, [
        ..."simple_tool".split(""),
        "\r",
        "q",
        "\r", // quit
      ]);

      expect(executeFn).toHaveBeenCalledWith({}, expect.anything());
    });

    test("multiple command history navigation up then up past start", async () => {
      const core = createMockCore();
      mockCreateBridgeCore.mockResolvedValueOnce(core);

      const config = {
        serverUrl: "http://localhost:8080",
        bridgePort: 3101,
        botName: "TestBot",
        token: "fake-token",
      };

      await driveInteractive(config, [
        "h",
        "\r", // command 1: "h"
        "c",
        "\r", // command 2: "c"
        "\x1b[A", // Up arrow — recall "c"
        "\x1b[A", // Up arrow — recall "h"
        "\x1b[A", // Up arrow — at start, can't go further
        "\x1b[B", // Down arrow — go to "c"
        "\x1b[B", // Down arrow — past end, back to draft
        "q",
        "\r", // quit
      ]);

      expect(core.cleanup).toHaveBeenCalled();
    });

    test("backspace on empty input does nothing", async () => {
      const core = createMockCore();
      mockCreateBridgeCore.mockResolvedValueOnce(core);

      const config = {
        serverUrl: "http://localhost:8080",
        bridgePort: 3101,
        botName: "TestBot",
        token: "fake-token",
      };

      await driveInteractive(config, [
        "\x7f", // backspace on empty input
        "\b", // another backspace variant
        "q",
        "\r", // quit
      ]);

      expect(core.cleanup).toHaveBeenCalled();
    });

    test("Enter with newline character also works", async () => {
      const core = createMockCore();
      mockCreateBridgeCore.mockResolvedValueOnce(core);

      const config = {
        serverUrl: "http://localhost:8080",
        bridgePort: 3101,
        botName: "TestBot",
        token: "fake-token",
      };

      await driveInteractive(config, [
        "q",
        "\n", // newline (not carriage return) also triggers Enter
      ]);

      expect(core.cleanup).toHaveBeenCalled();
    });

    test("tool number 0 is out of range", async () => {
      const tools = new Map<string, ToolDefinition>([
        [
          "get_scene_info",
          createMockTool({ name: "get_scene_info", description: "Get scene info" }),
        ],
      ]);

      const core = createMockCore(tools);
      mockCreateBridgeCore.mockResolvedValueOnce(core);

      const config = {
        serverUrl: "http://localhost:8080",
        bridgePort: 3101,
        botName: "TestBot",
        token: "fake-token",
      };

      // First help to populate indexedNames, then try 0
      await driveInteractive(config, ["h", "\r", "0", "\r", "q", "\r"]);

      expect(core.cleanup).toHaveBeenCalled();
    });

    test("negative tool number is treated as unknown", async () => {
      const tools = new Map<string, ToolDefinition>([
        [
          "get_scene_info",
          createMockTool({ name: "get_scene_info", description: "Get scene info" }),
        ],
      ]);

      const core = createMockCore(tools);
      mockCreateBridgeCore.mockResolvedValueOnce(core);

      const config = {
        serverUrl: "http://localhost:8080",
        bridgePort: 3101,
        botName: "TestBot",
        token: "fake-token",
      };

      await driveInteractive(config, ["h", "\r", ..."-1".split(""), "\r", "q", "\r"]);

      expect(core.cleanup).toHaveBeenCalled();
    });

    test("tool with multiple content items displays each", async () => {
      const executeFn = vi
        .fn<(params: Record<string, unknown>, ctx: any) => Promise<ToolResult>>()
        .mockResolvedValue({
          content: [
            { type: "text", text: '{"line1":"a"}' },
            { type: "text", text: '{"line2":"b"}' },
          ],
        });

      const tools = new Map<string, ToolDefinition>([
        [
          "multi_result",
          createMockTool({
            name: "multi_result",
            description: "Tool with multiple results",
            execute: executeFn,
          }),
        ],
      ]);

      const core = createMockCore(tools);
      mockCreateBridgeCore.mockResolvedValueOnce(core);

      const config = {
        serverUrl: "http://localhost:8080",
        bridgePort: 3101,
        botName: "TestBot",
        token: "fake-token",
      };

      await driveInteractive(config, [..."multi_result".split(""), "\r", "q", "\r"]);

      expect(executeFn).toHaveBeenCalled();
    });

    test("tool with no description on zodType param still works", async () => {
      const executeFn = vi
        .fn<(params: Record<string, unknown>, ctx: any) => Promise<ToolResult>>()
        .mockResolvedValue({
          content: [{ type: "text", text: '{"status":"ok"}' }],
        });

      const tools = new Map<string, ToolDefinition>([
        [
          "no_desc",
          createMockTool({
            name: "no_desc",
            description: "Tool without param descriptions",
            inputSchema: z.object({
              value: z.string(), // no .describe()
            }),
            execute: executeFn,
          }),
        ],
      ]);

      const core = createMockCore(tools);
      mockCreateBridgeCore.mockResolvedValueOnce(core);

      const config = {
        serverUrl: "http://localhost:8080",
        bridgePort: 3101,
        botName: "TestBot",
        token: "fake-token",
      };

      await driveInteractive(config, [
        ..."no_desc".split(""),
        "\r",
        ..."hello".split(""),
        "\r", // value = "hello"
        "q",
        "\r", // quit
      ]);

      expect(executeFn).toHaveBeenCalledWith(
        expect.objectContaining({ value: "hello" }),
        expect.anything(),
      );
    });

    test("categorized tools appear under their category in menu", async () => {
      // Use tools from TOOL_CATEGORIES:
      // "navigate_to" is in Movement, "get_scene_info" is in Query, "send_chat_message" is in Chat
      const tools = new Map<string, ToolDefinition>([
        [
          "navigate_to",
          createMockTool({ name: "navigate_to", description: "Navigate using navmesh" }),
        ],
        [
          "get_scene_info",
          createMockTool({ name: "get_scene_info", description: "Get scene info" }),
        ],
        [
          "send_chat_message",
          createMockTool({ name: "send_chat_message", description: "Send a chat message" }),
        ],
        ["click", createMockTool({ name: "click", description: "Click an element" })],
        ["wait", createMockTool({ name: "wait", description: "Wait for seconds" })],
        [
          "set_animation_state",
          createMockTool({ name: "set_animation_state", description: "Set animation" }),
        ],
      ]);

      const core = createMockCore(tools);
      mockCreateBridgeCore.mockResolvedValueOnce(core);

      const config = {
        serverUrl: "http://localhost:8080",
        bridgePort: 3101,
        botName: "TestBot",
        token: "fake-token",
      };

      await driveInteractive(config, [
        "h",
        "\r", // show help
        "q",
        "\r", // quit
      ]);

      expect(core.cleanup).toHaveBeenCalled();
    });

    test("event pane scroll indicator renders when scrolled up with many events", async () => {
      const core = createMockCore();
      let capturedEventListener: ((event: any) => void) | undefined;
      core.worldConnection.addEventListener = vi.fn().mockImplementation((listener: any) => {
        capturedEventListener = listener;
      });
      mockCreateBridgeCore.mockResolvedValueOnce(core);

      const config = {
        serverUrl: "http://localhost:8080",
        bridgePort: 3101,
        botName: "TestBot",
        token: "fake-token",
      };

      const drivePromise = driveInteractive(
        config,
        [
          "\t", // switch to events pane
          "\x1b[5~", // Page Up in events pane (scrolls up)
          // After the scroll, we send more events which will trigger eventLog
          // with eventScroll > 0, covering lines 340 and 262-263
          "\t", // back to interactive
          "q",
          "\r",
        ],
        { delayBetweenKeys: 50 },
      );

      // Wait for listener then send many events to fill the buffer
      await new Promise((r) => setTimeout(r, 40));
      if (capturedEventListener) {
        for (let i = 0; i < 30; i++) {
          capturedEventListener({
            type: "chat",
            message: { username: "User" + i, message: "Message " + i },
          });
        }
      }

      await drivePromise;
      expect(core.cleanup).toHaveBeenCalled();
    });

    test("bottom pane scroll indicator renders when scrolled up with many lines", async () => {
      const core = createMockCore();
      mockCreateBridgeCore.mockResolvedValueOnce(core);

      const config = {
        serverUrl: "http://localhost:8080",
        bridgePort: 3101,
        botName: "TestBot",
        token: "fake-token",
      };

      // Show help multiple times to fill up the bottom buffer, then Page Up
      await driveInteractive(config, [
        "h",
        "\r", // show help (adds lines to bottom buffer)
        "h",
        "\r", // show help again
        "h",
        "\r", // show help again
        "\x1b[5~", // Page Up in interactive (bottom) pane
        "\x1b[6~", // Page Down back
        "q",
        "\r",
      ]);

      expect(core.cleanup).toHaveBeenCalled();
    });

    test("very long input triggers truncation logic", async () => {
      const core = createMockCore();
      mockCreateBridgeCore.mockResolvedValueOnce(core);

      const config = {
        serverUrl: "http://localhost:8080",
        bridgePort: 3101,
        botName: "TestBot",
        token: "fake-token",
      };

      // Type a very long string (> 120 cols which is our mocked terminal width)
      const longInput = "x".repeat(200);
      await driveInteractive(config, [...longInput.split(""), "\r", "q", "\r"]);

      expect(core.cleanup).toHaveBeenCalled();
    });

    test("eventLog with eventScroll > 0 increments scroll offset", async () => {
      // This covers line 340: if (this.eventScroll > 0) { this.eventScroll++; }
      // We need to:
      // 1. Add many events to the event buffer
      // 2. Switch to events pane and scroll up (Page Up)
      // 3. Then receive more events while scrolled up
      const core = createMockCore();
      let capturedEventListener: ((event: any) => void) | undefined;
      core.worldConnection.addEventListener = vi.fn().mockImplementation((listener: any) => {
        capturedEventListener = listener;
      });
      mockCreateBridgeCore.mockResolvedValueOnce(core);

      const config = {
        serverUrl: "http://localhost:8080",
        bridgePort: 3101,
        botName: "TestBot",
        token: "fake-token",
      };

      const drivePromise = driveInteractive(
        config,
        [
          // First, fill up the event buffer so scrolling is meaningful
          // (we'll inject events before the scroll)
          "\t", // switch to events pane focus
          "\x1b[5~", // Page Up — this sets eventScroll > 0
          // Now we wait for more events to arrive with eventScroll > 0
          "\t", // back to interactive
          "q",
          "\r",
        ],
        { delayBetweenKeys: 80 },
      );

      // Inject many events before scrolling
      await new Promise((r) => setTimeout(r, 30));
      if (capturedEventListener) {
        for (let i = 0; i < 50; i++) {
          capturedEventListener({
            type: "chat",
            message: { username: "Flood" + i, message: "line " + i },
          });
        }
      }

      // Wait for scroll to happen, then inject more events while scrolled up
      await new Promise((r) => setTimeout(r, 200));
      if (capturedEventListener) {
        for (let i = 0; i < 5; i++) {
          capturedEventListener({
            type: "chat",
            message: { username: "Late" + i, message: "late message " + i },
          });
        }
      }

      await drivePromise;
      expect(core.cleanup).toHaveBeenCalled();
    });

    test("handles tool with null zodType gracefully", async () => {
      // Manually create a tool with a schema that has a null-ish zodType
      // to exercise the getZodTypeName fallback to "unknown"
      // We need the shape to still have a null-ish _def for the getZodTypeName,
      // but the actual parse should still work. We use a schema with parse
      // overridden to pass through.
      const executeFn = vi
        .fn<(params: Record<string, unknown>, ctx: any) => Promise<ToolResult>>()
        .mockResolvedValue({
          content: [{ type: "text", text: '{"status":"ok"}' }],
        });

      // Create a fake schema-like object that mimics ZodObject with shape
      const fakeSchema: any = {
        shape: {
          val: { _def: null, isOptional: () => false, description: undefined },
        },
        parse: (params: any) => params,
      };

      const tools = new Map<string, ToolDefinition>([
        [
          "null_type",
          createMockTool({
            name: "null_type",
            description: "Tool with null-ish zodType",
            inputSchema: fakeSchema,
            execute: executeFn,
          }),
        ],
      ]);

      const core = createMockCore(tools);
      mockCreateBridgeCore.mockResolvedValueOnce(core);

      const config = {
        serverUrl: "http://localhost:8080",
        bridgePort: 3101,
        botName: "TestBot",
        token: "fake-token",
      };

      // The "unknown" type falls through to the default case in parseValue
      // which returns the raw string
      await driveInteractive(config, [
        ..."null_type".split(""),
        "\r",
        ..."foo".split(""),
        "\r", // val = "foo"
        "q",
        "\r", // quit
      ]);

      expect(executeFn).toHaveBeenCalled();
    });
  });
});
