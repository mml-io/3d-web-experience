/**
 * @jest-environment jsdom
 */
import { jest } from "@jest/globals";

import { DefaultHUDPlugin } from "../src/DefaultHUDPlugin";

function createMockClient(statesOverride?: Map<number, any>) {
  const defaultStates = new Map([
    [
      1,
      {
        connectionId: 1,
        userId: "user-1",
        position: { x: 0, y: 0, z: 0 },
        username: "LocalPlayer",
        isLocal: true,
      },
    ],
  ]);

  return {
    getCharacterStates: jest.fn().mockReturnValue(statesOverride ?? defaultStates),
    getCameraManager: jest.fn().mockReturnValue({
      getCameraPosition: jest.fn().mockReturnValue({ x: 0, y: 5, z: 10 }),
      setOrbitAngle: jest.fn(),
    }),
  } as any;
}

// Mock canvas context since jsdom does not support canvas
beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = jest.fn().mockReturnValue({
    clearRect: jest.fn(),
    beginPath: jest.fn(),
    moveTo: jest.fn(),
    lineTo: jest.fn(),
    arc: jest.fn(),
    fill: jest.fn(),
    stroke: jest.fn(),
    strokeRect: jest.fn(),
    fillText: jest.fn(),
    setLineDash: jest.fn(),
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    font: "",
    textAlign: "",
    textBaseline: "",
  }) as any;
});

describe("DefaultHUDPlugin", () => {
  let container: HTMLDivElement;
  let rafCallbacks: Map<number, FrameRequestCallback>;
  let nextRafId: number;
  let originalRaf: typeof requestAnimationFrame;
  let originalCancelRaf: typeof cancelAnimationFrame;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);

    // Mock requestAnimationFrame
    rafCallbacks = new Map();
    nextRafId = 1;
    originalRaf = globalThis.requestAnimationFrame;
    originalCancelRaf = globalThis.cancelAnimationFrame;

    globalThis.requestAnimationFrame = jest.fn((cb: FrameRequestCallback) => {
      const id = nextRafId++;
      rafCallbacks.set(id, cb);
      return id;
    }) as any;
    globalThis.cancelAnimationFrame = jest.fn((id: number) => {
      rafCallbacks.delete(id);
    }) as any;
  });

  afterEach(() => {
    container.remove();
    globalThis.requestAnimationFrame = originalRaf;
    globalThis.cancelAnimationFrame = originalCancelRaf;
  });

  it("mount creates HUD container with minimap and player list by default", () => {
    const client = createMockClient();
    const plugin = new DefaultHUDPlugin();
    plugin.mount(container, client);
    plugin.onConfigChanged({});

    expect(container.children.length).toBe(1);
    const overlay = container.children[0] as HTMLElement;
    expect(overlay.style.pointerEvents).toBe("none");

    const canvas = overlay.querySelector("canvas");
    expect(canvas).not.toBeNull();

    plugin.dispose();
  });

  it("player list header shows player count", () => {
    const client = createMockClient();
    const plugin = new DefaultHUDPlugin();
    plugin.mount(container, client);
    plugin.onConfigChanged({});

    const overlay = container.children[0] as HTMLElement;
    expect(overlay.textContent).toContain("Players (1)");

    plugin.dispose();
  });

  it("onConfigChanged with minimap: false disables minimap", () => {
    const client = createMockClient();
    const plugin = new DefaultHUDPlugin();
    plugin.mount(container, client);

    plugin.onConfigChanged({ hud: { minimap: false } });

    const overlay = container.children[0] as HTMLElement;
    const canvas = overlay.querySelector("canvas");
    expect(canvas).toBeNull();

    plugin.dispose();
  });

  it("onConfigChanged with playerList: false disables player list", () => {
    const client = createMockClient();
    const plugin = new DefaultHUDPlugin();
    plugin.mount(container, client);

    plugin.onConfigChanged({ hud: { playerList: false } });

    const overlay = container.children[0] as HTMLElement;
    expect(overlay.textContent).not.toContain("Players");

    plugin.dispose();
  });

  it("onConfigChanged with both disabled still creates the HUD container", () => {
    const client = createMockClient();
    const plugin = new DefaultHUDPlugin();
    plugin.mount(container, client);

    plugin.onConfigChanged({ hud: { minimap: false, playerList: false } });

    expect(container.children.length).toBe(1);

    plugin.dispose();
  });

  it("onConfigChanged with hud: false removes the HUD", () => {
    const client = createMockClient();
    const plugin = new DefaultHUDPlugin();
    plugin.mount(container, client);
    plugin.onConfigChanged({});
    expect(container.children.length).toBe(1);

    plugin.onConfigChanged({ hud: false });
    expect(container.children.length).toBe(0);

    plugin.dispose();
  });

  it("unrelated config update after hud: false does not recreate HUD", () => {
    const client = createMockClient();
    const plugin = new DefaultHUDPlugin();
    plugin.mount(container, client);

    // Default creation via empty config
    plugin.onConfigChanged({});
    expect(container.children.length).toBe(1);

    // Explicitly disable
    plugin.onConfigChanged({ hud: false });
    expect(container.children.length).toBe(0);

    // Unrelated config update — hud key is absent (undefined)
    plugin.onConfigChanged({});
    expect(container.children.length).toBe(0);

    plugin.dispose();
  });

  it("onConfigChanged with hud: false then hud object re-creates HUD", () => {
    const client = createMockClient();
    const plugin = new DefaultHUDPlugin();
    plugin.mount(container, client);

    plugin.onConfigChanged({ hud: false });
    expect(container.children.length).toBe(0);

    plugin.onConfigChanged({ hud: { minimap: true, playerList: true } });
    expect(container.children.length).toBe(1);

    plugin.dispose();
  });

  it("dispose removes the HUD container", () => {
    const client = createMockClient();
    const plugin = new DefaultHUDPlugin();
    plugin.mount(container, client);
    plugin.onConfigChanged({});
    expect(container.children.length).toBe(1);

    plugin.dispose();
    expect(container.children.length).toBe(0);
  });

  it("dispose cancels animation frame", () => {
    const client = createMockClient();
    const plugin = new DefaultHUDPlugin();
    plugin.mount(container, client);
    plugin.onConfigChanged({});

    expect(globalThis.requestAnimationFrame).toHaveBeenCalled();

    plugin.dispose();
    expect(globalThis.cancelAnimationFrame).toHaveBeenCalled();
  });

  it("dispose is safe to call multiple times", () => {
    const client = createMockClient();
    const plugin = new DefaultHUDPlugin();
    plugin.mount(container, client);

    expect(() => {
      plugin.dispose();
      plugin.dispose();
    }).not.toThrow();
  });

  it("player list shows remote players", () => {
    const states = new Map([
      [
        1,
        {
          connectionId: 1,
          userId: "user-1",
          position: { x: 0, y: 0, z: 0 },
          username: "LocalPlayer",
          isLocal: true,
        },
      ],
      [
        2,
        {
          connectionId: 2,
          userId: "user-2",
          position: { x: 10, y: 0, z: 10 },
          username: "RemotePlayer",
          isLocal: false,
        },
      ],
    ]);

    const client = createMockClient(states);

    const plugin = new DefaultHUDPlugin();
    plugin.mount(container, client);
    plugin.onConfigChanged({});

    const overlay = container.children[0] as HTMLElement;
    expect(overlay.textContent).toContain("Players (2)");
    expect(overlay.textContent).toContain("LocalPlayer");
    expect(overlay.textContent).toContain("RemotePlayer");

    plugin.dispose();
  });

  it("player list header is collapsible", () => {
    const client = createMockClient();
    const plugin = new DefaultHUDPlugin();
    plugin.mount(container, client);
    plugin.onConfigChanged({});

    const overlay = container.children[0] as HTMLElement;
    const headers = Array.from(overlay.querySelectorAll("div[style*='cursor: pointer']"));
    let playerListHeader: HTMLElement | null = null;
    for (const h of headers) {
      if (h.textContent?.includes("Players")) {
        playerListHeader = h as HTMLElement;
        break;
      }
    }
    expect(playerListHeader).not.toBeNull();

    playerListHeader!.click();

    const listBody = playerListHeader!.nextElementSibling as HTMLElement;
    expect(listBody.style.display).toBe("none");

    playerListHeader!.click();
    expect(listBody.style.display).toBe("block");

    plugin.dispose();
  });

  it("minimap has orientation toggle button", () => {
    const client = createMockClient();
    const plugin = new DefaultHUDPlugin();
    plugin.mount(container, client);
    plugin.onConfigChanged({});

    const overlay = container.children[0] as HTMLElement;
    const orientToggle = overlay.querySelector(
      "div[title='Toggle north-oriented / camera-oriented']",
    ) as HTMLElement;
    expect(orientToggle).not.toBeNull();
    expect(orientToggle.textContent).toBe("C");

    orientToggle.click();
    expect(orientToggle.textContent).toBe("N");

    orientToggle.click();
    expect(orientToggle.textContent).toBe("C");

    plugin.dispose();
  });

  // --- Phase 3: Interaction & Cleanup Tests ---

  it("clearInterval called on dispose", () => {
    const clearIntervalSpy = jest.spyOn(globalThis, "clearInterval");

    const client = createMockClient();
    const plugin = new DefaultHUDPlugin();
    plugin.mount(container, client);
    plugin.onConfigChanged({});

    plugin.dispose();

    expect(clearIntervalSpy).toHaveBeenCalled();
    clearIntervalSpy.mockRestore();
  });

  it("player click triggers camera orbit", () => {
    const states = new Map([
      [
        1,
        {
          connectionId: 1,
          userId: "user-1",
          position: { x: 0, y: 0, z: 0 },
          username: "LocalPlayer",
          isLocal: true,
        },
      ],
      [
        2,
        {
          connectionId: 2,
          userId: "user-2",
          position: { x: 10, y: 0, z: 10 },
          username: "RemotePlayer",
          isLocal: false,
        },
      ],
    ]);

    const client = createMockClient(states);
    const plugin = new DefaultHUDPlugin();
    plugin.mount(container, client);
    plugin.onConfigChanged({});

    const overlay = container.children[0] as HTMLElement;

    // Find the remote player row by text content
    const rows = Array.from(overlay.querySelectorAll("div[style*='cursor: pointer']"));
    let remoteRow: HTMLElement | null = null;
    for (const row of rows) {
      if (row.textContent?.includes("RemotePlayer")) {
        remoteRow = row as HTMLElement;
        break;
      }
    }
    expect(remoteRow).not.toBeNull();

    remoteRow!.click();

    expect(client.getCameraManager().setOrbitAngle).toHaveBeenCalled();

    plugin.dispose();
  });

  it("HUD toggle on small screens", () => {
    // Set small screen width
    Object.defineProperty(window, "innerWidth", {
      writable: true,
      configurable: true,
      value: 600,
    });

    const client = createMockClient();
    const plugin = new DefaultHUDPlugin();
    plugin.mount(container, client);
    plugin.onConfigChanged({});

    const overlay = container.children[0] as HTMLElement;

    // Find the HUD toggle button (the map emoji 🗺)
    const hudToggle = overlay.querySelector("div[title='Toggle HUD']") as HTMLElement;
    expect(hudToggle).not.toBeNull();
    expect(hudToggle.style.display).toBe("flex");

    // On small screens, content should start collapsed
    // The hudContent wrapper is the next sibling of the toggle inside the group
    const group = hudToggle.parentElement!;
    const hudContent = group.children[1] as HTMLElement;
    expect(hudContent.style.display).toBe("none");

    // Click toggle → content visible
    hudToggle.click();
    expect(hudContent.style.display).toBe("flex");

    // Click toggle → content hidden
    hudToggle.click();
    expect(hudContent.style.display).toBe("none");

    plugin.dispose();

    // Restore window size
    Object.defineProperty(window, "innerWidth", {
      writable: true,
      configurable: true,
      value: 1024,
    });
  });

  it("coordinate label reflects local player position", () => {
    const states = new Map([
      [
        1,
        {
          connectionId: 1,
          userId: "user-1",
          position: { x: 42, y: 0, z: -17 },
          username: "LocalPlayer",
          isLocal: true,
        },
      ],
    ]);

    const client = createMockClient(states);
    const plugin = new DefaultHUDPlugin();
    plugin.mount(container, client);
    plugin.onConfigChanged({});

    // Trigger one RAF callback to force a minimap render
    for (const [, cb] of rafCallbacks) {
      cb(MINIMAP_UPDATE_THRESHOLD);
      break;
    }

    const overlay = container.children[0] as HTMLElement;
    // The coord label uses monospace font
    const coordLabel = overlay.querySelector("div[style*='monospace']") as HTMLElement;
    expect(coordLabel).not.toBeNull();
    expect(coordLabel.textContent).toBe("42, -17");

    plugin.dispose();
  });
});

// MINIMAP_UPDATE_MS = 100; need to exceed this for the render to trigger
const MINIMAP_UPDATE_THRESHOLD = 200;
