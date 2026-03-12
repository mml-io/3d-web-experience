import { jest, describe, expect, test, beforeEach } from "@jest/globals";

// Mock chokidar
let watchAllHandler: (() => void) | null = null;
jest.unstable_mockModule("chokidar", () => ({
  watch: jest.fn<any>().mockImplementation(() => ({
    on: jest.fn<any>().mockImplementation((event: string, handler: () => void) => {
      if (event === "all") {
        watchAllHandler = handler;
      }
      return { on: jest.fn() };
    }),
  })),
}));

const { websocketDirectoryChangeListener } =
  await import("../src/websocketDirectoryChangeListener");

describe("websocketDirectoryChangeListener", () => {
  let mockApp: any;
  let wsHandler: (ws: any) => void;

  beforeEach(() => {
    watchAllHandler = null;
    mockApp = {
      ws: jest.fn<any>().mockImplementation((_path: string, handler: (ws: any) => void) => {
        wsHandler = handler;
      }),
    };
  });

  test("registers websocket route on app", () => {
    websocketDirectoryChangeListener(mockApp, {
      directory: "/build",
      websocketPath: "/ws-watch",
    });

    expect(mockApp.ws).toHaveBeenCalledWith("/ws-watch", expect.any(Function));
  });

  test("adds connected client to listeners", () => {
    websocketDirectoryChangeListener(mockApp, {
      directory: "/build",
      websocketPath: "/ws-watch",
    });

    const mockWs = {
      send: jest.fn(),
      on: jest.fn(),
    };

    wsHandler(mockWs);

    // Client should now be tracked
    expect(mockWs.on).toHaveBeenCalledWith("close", expect.any(Function));
  });

  test("broadcasts 'change' to all connected clients on file change", () => {
    websocketDirectoryChangeListener(mockApp, {
      directory: "/build",
      websocketPath: "/ws-watch",
    });

    const ws1 = { send: jest.fn(), on: jest.fn() };
    const ws2 = { send: jest.fn(), on: jest.fn() };

    wsHandler(ws1);
    wsHandler(ws2);

    // Simulate file change
    expect(watchAllHandler).not.toBeNull();
    watchAllHandler!();

    expect(ws1.send).toHaveBeenCalledWith("change");
    expect(ws2.send).toHaveBeenCalledWith("change");
  });

  test("removes client on close", () => {
    websocketDirectoryChangeListener(mockApp, {
      directory: "/build",
      websocketPath: "/ws-watch",
    });

    const mockWs = { send: jest.fn(), on: jest.fn() };
    wsHandler(mockWs);

    // Get the close handler
    const closeHandler = (mockWs.on as jest.Mock<any>).mock.calls.find(
      (call) => call[0] === "close",
    )?.[1] as () => void;
    expect(closeHandler).toBeDefined();

    // Close the client
    closeHandler();

    // Trigger file change — closed client should not receive
    watchAllHandler!();
    expect(mockWs.send).not.toHaveBeenCalled();
  });

  test("no clients means no broadcast", () => {
    websocketDirectoryChangeListener(mockApp, {
      directory: "/build",
      websocketPath: "/ws-watch",
    });

    // Trigger file change with no clients
    expect(watchAllHandler).not.toBeNull();
    expect(() => watchAllHandler!()).not.toThrow();
  });
});
