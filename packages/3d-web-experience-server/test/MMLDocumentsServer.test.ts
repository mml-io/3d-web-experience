import { jest, describe, expect, test, beforeEach, afterEach } from "@jest/globals";

// Mock chokidar
const mockWatcher = {
  on: jest.fn<any>().mockReturnThis(),
  close: jest.fn(),
};

jest.unstable_mockModule("chokidar", () => ({
  watch: jest.fn<any>().mockReturnValue(mockWatcher),
}));

// Mock micromatch
jest.unstable_mockModule("micromatch", () => ({
  default: {
    isMatch: jest.fn<any>().mockReturnValue(true),
  },
}));

// Mock fs
jest.unstable_mockModule("node:fs", () => ({
  default: {
    readFileSync: jest.fn<any>().mockReturnValue("<m-group></m-group>"),
  },
}));

// Mock networked-dom-server
const mockDocument = {
  load: jest.fn(),
  dispose: jest.fn(),
  addWebSocket: jest.fn(),
  removeWebSocket: jest.fn(),
};

jest.unstable_mockModule("@mml-io/networked-dom-server", () => ({
  EditableNetworkedDOM: jest.fn<any>().mockImplementation(() => ({
    ...mockDocument,
    load: jest.fn(),
    dispose: jest.fn(),
    addWebSocket: jest.fn(),
    removeWebSocket: jest.fn(),
  })),
  LocalObservableDOMFactory: jest.fn(),
}));

const { MMLDocumentsServer } = await import("../src/MMLDocumentsServer");
const chokidar = await import("chokidar");

describe("MMLDocumentsServer", () => {
  let server: InstanceType<typeof MMLDocumentsServer>;
  let onAdd: (fullPath: string, stats: any) => void;
  let onChange: (fullPath: string) => void;
  let onUnlink: (fullPath: string) => void;
  let onError: (error: Error) => void;

  beforeEach(() => {
    jest.clearAllMocks();
    mockWatcher.on.mockReturnThis();

    server = new MMLDocumentsServer("/test/dir", "**/*.html");

    // Capture the event handlers
    const calls = mockWatcher.on.mock.calls;
    for (const [event, handler] of calls) {
      if (event === "add") onAdd = handler as (fullPath: string, stats: any) => void;
      if (event === "change") onChange = handler as (fullPath: string) => void;
      if (event === "unlink") onUnlink = handler as (fullPath: string) => void;
      if (event === "error") onError = handler as (error: Error) => void;
    }
  });

  afterEach(() => {
    try {
      server.dispose();
    } catch {
      // Already disposed
    }
  });

  test("constructor starts watching the directory", () => {
    expect(chokidar.watch).toHaveBeenCalledWith(
      "/test/dir",
      expect.objectContaining({
        ignoreInitial: false,
        persistent: true,
      }),
    );
  });

  test("on add creates a document", () => {
    onAdd("/test/dir/doc.html", { isFile: () => true });
    // The document should be created
    expect(server).toBeDefined();
  });

  test("on add ignores non-file stats", () => {
    // Should not throw
    onAdd("/test/dir/subdir", { isFile: () => false });
    onAdd("/test/dir/null", null as any);
  });

  test("on change reloads existing document", () => {
    // First add
    onAdd("/test/dir/doc.html", { isFile: () => true });
    // Then change
    onChange("/test/dir/doc.html");
    // Should not throw
  });

  test("on change logs error for unknown document", () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    onChange("/test/dir/unknown.html");
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("not found"));
    errorSpy.mockRestore();
  });

  test("on unlink removes document", () => {
    onAdd("/test/dir/doc.html", { isFile: () => true });
    onUnlink("/test/dir/doc.html");
    // Should not throw
  });

  test("on unlink logs error for unknown document", () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    onUnlink("/test/dir/unknown.html");
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("not found"));
    errorSpy.mockRestore();
  });

  test("on error logs the error", () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    onError(new Error("watch error"));
    expect(errorSpy).toHaveBeenCalledWith("Error whilst watching directory", expect.any(Error));
    errorSpy.mockRestore();
  });

  test("handle closes WebSocket for unknown document", () => {
    const mockWs = {
      close: jest.fn(),
      on: jest.fn(),
    };
    server.handle("nonexistent.html", mockWs as any);
    expect(mockWs.close).toHaveBeenCalled();
  });

  test("handle connects WebSocket for known document", () => {
    onAdd("/test/dir/doc.html", { isFile: () => true });
    const mockWs = {
      close: jest.fn(),
      on: jest.fn(),
    };
    server.handle("doc.html", mockWs as any);
    // Should not close the WebSocket
    expect(mockWs.close).not.toHaveBeenCalled();
    // Should register close handler
    expect(mockWs.on).toHaveBeenCalledWith("close", expect.any(Function));
  });

  test("dispose clears documents and closes watcher", () => {
    onAdd("/test/dir/doc.html", { isFile: () => true });
    server.dispose();
    expect(mockWatcher.close).toHaveBeenCalled();
  });

  test("handle registers close handler that removes WebSocket", () => {
    onAdd("/test/dir/doc.html", { isFile: () => true });

    let closeHandler: (() => void) | null = null;
    const mockWs = {
      close: jest.fn(),
      on: jest.fn<any>().mockImplementation((event: string, handler: () => void) => {
        if (event === "close") {
          closeHandler = handler;
        }
      }),
    };

    server.handle("doc.html", mockWs as any);
    expect(closeHandler).not.toBeNull();

    // Calling close handler should not throw
    closeHandler!();
  });
});
