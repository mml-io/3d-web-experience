/**
 * @jest-environment jsdom
 */
import { jest } from "@jest/globals";

import { DefaultChatPlugin } from "../src/DefaultChatPlugin";

type ChatHandler = (msg: any) => void;

function createMockClient(characterStates?: Map<number, any>) {
  const chatHandlers: ChatHandler[] = [];
  return {
    on: jest.fn((event: string, handler: ChatHandler) => {
      if (event === "chat") chatHandlers.push(handler);
    }),
    off: jest.fn((event: string, handler: ChatHandler) => {
      if (event === "chat") {
        const idx = chatHandlers.indexOf(handler);
        if (idx !== -1) chatHandlers.splice(idx, 1);
      }
    }),
    sendChatMessage: jest.fn(),
    getCharacterStates: jest.fn().mockReturnValue(
      characterStates ??
        new Map([
          [1, { connectionId: 1, position: { x: 0, y: 0, z: 0 }, isLocal: true }],
          [2, { connectionId: 2, position: { x: 20, y: 0, z: 0 }, isLocal: false }],
          [3, { connectionId: 3, position: { x: 5, y: 0, z: 0 }, isLocal: false }],
        ]),
    ),
    _emitChat(msg: any) {
      for (const h of chatHandlers) h(msg);
    },
    _chatHandlerCount() {
      return chatHandlers.length;
    },
  } as any;
}

// --- Helpers using data-testid attributes ---

function findToggleButton(overlay: HTMLElement): HTMLElement {
  return overlay.querySelector("[data-testid='chat-toggle']") as HTMLElement;
}

function findPanel(overlay: HTMLElement): HTMLElement {
  return overlay.querySelector("[data-testid='chat-panel']") as HTMLElement;
}

function findMessageArea(overlay: HTMLElement): HTMLElement {
  return overlay.querySelector(".default-chat-messages") as HTMLElement;
}

function findInput(overlay: HTMLElement): HTMLInputElement {
  return overlay.querySelector("[data-testid='chat-input']") as HTMLInputElement;
}

function findPassiveArea(overlay: HTMLElement): HTMLElement {
  return overlay.querySelector("[data-testid='chat-passive-area']") as HTMLElement;
}

function findSendButton(overlay: HTMLElement): HTMLButtonElement {
  return overlay.querySelector("[data-testid='chat-send']") as HTMLButtonElement;
}

describe("DefaultChatPlugin", () => {
  let container: HTMLDivElement;
  let plugin: DefaultChatPlugin;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    plugin = new DefaultChatPlugin();
  });

  afterEach(() => {
    plugin.dispose();
    container.remove();
  });

  it("mount creates overlay container", () => {
    const client = createMockClient();
    plugin.mount(container, client);

    expect(container.children.length).toBe(1);
    const overlay = container.children[0] as HTMLElement;
    expect(overlay.style.pointerEvents).toBe("none");
  });

  it("mount subscribes to chat event", () => {
    const client = createMockClient();
    plugin.mount(container, client);

    expect(client.on).toHaveBeenCalledWith("chat", expect.any(Function));
  });

  it("clicking toggle button opens the panel", () => {
    const client = createMockClient();
    plugin.mount(container, client);

    const overlay = container.children[0] as HTMLElement;
    const toggleBtn = findToggleButton(overlay);
    const panel = findPanel(overlay);

    expect(panel.style.display).toBe("none");

    toggleBtn.click();
    expect(panel.style.display).toBe("flex");
  });

  it("close button closes the panel", () => {
    const client = createMockClient();
    plugin.mount(container, client);

    const overlay = container.children[0] as HTMLElement;
    const toggleBtn = findToggleButton(overlay);
    toggleBtn.click();

    const closeBtn = overlay.querySelector("span[title='Close chat']") as HTMLElement;
    expect(closeBtn).not.toBeNull();
    closeBtn.click();

    const panel = findPanel(overlay);
    expect(panel.style.display).toBe("none");
  });

  it("receiving a chat message adds it to the message area", () => {
    const client = createMockClient();
    plugin.mount(container, client);

    const overlay = container.children[0] as HTMLElement;
    findToggleButton(overlay).click();

    client._emitChat({
      username: "Alice",
      message: "Hello world",
      fromConnectionId: 2,
      isLocal: false,
    });

    const messageArea = findMessageArea(overlay);
    expect(messageArea).not.toBeNull();
    expect(messageArea.textContent).toContain("Alice");
    expect(messageArea.textContent).toContain("Hello world");
  });

  it("sending a message via input calls sendChatMessage", () => {
    const client = createMockClient();
    plugin.mount(container, client);

    const overlay = container.children[0] as HTMLElement;
    findToggleButton(overlay).click();

    const input = findInput(overlay);
    expect(input).not.toBeNull();

    input.value = "Test message";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(client.sendChatMessage).toHaveBeenCalledWith("Test message");
  });

  it("empty message is not sent", () => {
    const client = createMockClient();
    plugin.mount(container, client);

    const overlay = container.children[0] as HTMLElement;
    findToggleButton(overlay).click();

    const input = findInput(overlay);
    input.value = "   ";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(client.sendChatMessage).not.toHaveBeenCalled();
  });

  it("unread badge appears when panel is closed and messages arrive", () => {
    const client = createMockClient();
    plugin.mount(container, client);

    client._emitChat({
      username: "Bob",
      message: "Hey!",
      fromConnectionId: 3,
      isLocal: false,
    });

    const overlay = container.children[0] as HTMLElement;
    const badge = overlay.querySelector("span[style*='border-radius: 50%']") as HTMLElement;
    expect(badge).not.toBeNull();
    expect(badge.style.display).toBe("flex");
    expect(badge.textContent).toBe("1");
  });

  it("unread badge resets when panel is opened", () => {
    const client = createMockClient();
    plugin.mount(container, client);

    client._emitChat({
      username: "Bob",
      message: "Hey!",
      fromConnectionId: 3,
      isLocal: false,
    });

    const overlay = container.children[0] as HTMLElement;
    findToggleButton(overlay).click();

    const badge = overlay.querySelector("span[style*='border-radius: 50%']") as HTMLElement;
    expect(badge.style.display).toBe("none");
  });

  it("filter pill cycles through distance thresholds", () => {
    const client = createMockClient();
    plugin.mount(container, client);

    const overlay = container.children[0] as HTMLElement;
    findToggleButton(overlay).click();

    const filterPill = overlay.querySelector("span[title='Filter by distance']") as HTMLElement;
    expect(filterPill).not.toBeNull();
    expect(filterPill.textContent).toBe("ALL");

    filterPill.click();
    expect(filterPill.textContent).toBe("< 15m");

    filterPill.click();
    expect(filterPill.textContent).toBe("< 30m");

    filterPill.click();
    expect(filterPill.textContent).toBe("< 60m");

    filterPill.click();
    expect(filterPill.textContent).toBe("ALL");
  });

  it("proximity pill toggles", () => {
    const client = createMockClient();
    plugin.mount(container, client);

    const overlay = container.children[0] as HTMLElement;
    findToggleButton(overlay).click();

    const proxPill = overlay.querySelector("span[title='Proximity prominence']") as HTMLElement;
    expect(proxPill).not.toBeNull();

    expect(proxPill.style.background).toBe("transparent");

    proxPill.click();
    expect(proxPill.style.background).not.toBe("transparent");

    proxPill.click();
    expect(proxPill.style.background).toBe("transparent");
  });

  it("dispose unsubscribes from chat event", () => {
    const client = createMockClient();
    plugin.mount(container, client);
    expect(client._chatHandlerCount()).toBe(1);

    plugin.dispose();
    expect(client.off).toHaveBeenCalledWith("chat", expect.any(Function));
  });

  it("dispose removes the container", () => {
    const client = createMockClient();
    plugin.mount(container, client);
    expect(container.children.length).toBe(1);

    plugin.dispose();
    expect(container.children.length).toBe(0);
  });

  it("dispose is safe to call multiple times", () => {
    const client = createMockClient();
    plugin.mount(container, client);

    expect(() => {
      plugin.dispose();
      plugin.dispose();
    }).not.toThrow();
  });

  // --- Phase 1: Behavioral Tests ---

  it("distance filter hides far messages and shows near messages", () => {
    const client = createMockClient();
    plugin.mount(container, client);

    const overlay = container.children[0] as HTMLElement;
    findToggleButton(overlay).click();

    // Set filter to "< 15m"
    const filterPill = overlay.querySelector("span[title='Filter by distance']") as HTMLElement;
    filterPill.click();
    expect(filterPill.textContent).toBe("< 15m");

    // Emit chat from connectionId 2 (distance 20 > 15) — should be hidden
    client._emitChat({
      username: "FarUser",
      message: "far away",
      fromConnectionId: 2,
      isLocal: false,
    });

    // Emit chat from connectionId 3 (distance 5 < 15) — should be visible
    client._emitChat({
      username: "NearUser",
      message: "close by",
      fromConnectionId: 3,
      isLocal: false,
    });

    const messageArea = findMessageArea(overlay);
    const rows = Array.from(messageArea.children) as HTMLElement[];

    // First message (far) should be hidden
    expect(rows[0].style.display).toBe("none");
    // Second message (near) should be visible (not hidden)
    expect(rows[1].style.display).not.toBe("none");
  });

  it("system messages bypass distance filter", () => {
    const client = createMockClient();
    plugin.mount(container, client);

    const overlay = container.children[0] as HTMLElement;
    findToggleButton(overlay).click();

    // Set filter to "< 15m"
    const filterPill = overlay.querySelector("span[title='Filter by distance']") as HTMLElement;
    filterPill.click();

    // Emit system message (fromConnectionId === 0)
    client._emitChat({
      username: "System",
      message: "Server announcement",
      fromConnectionId: 0,
      isLocal: false,
    });

    const messageArea = findMessageArea(overlay);
    const rows = Array.from(messageArea.children) as HTMLElement[];

    // System message should be visible
    expect(rows[0].style.display).not.toBe("none");

    // Badge text should be "SYS"
    const badge = rows[0].querySelector("span") as HTMLElement;
    expect(badge.textContent).toBe("SYS");
  });

  it("proximity mode applies opacity based on distance", () => {
    const client = createMockClient();
    plugin.mount(container, client);

    const overlay = container.children[0] as HTMLElement;
    findToggleButton(overlay).click();

    // Enable proximity mode
    const proxPill = overlay.querySelector("span[title='Proximity prominence']") as HTMLElement;
    proxPill.click();

    // Emit message from near player (connectionId 3, distance 5)
    client._emitChat({
      username: "NearUser",
      message: "close",
      fromConnectionId: 3,
      isLocal: false,
    });

    // Emit message from far player (connectionId 2, distance 20)
    client._emitChat({
      username: "FarUser",
      message: "distant",
      fromConnectionId: 2,
      isLocal: false,
    });

    const messageArea = findMessageArea(overlay);
    const rows = Array.from(messageArea.children) as HTMLElement[];

    // Near message (distance 5 <= NEAR_DISTANCE=10) should have opacity 1
    expect(rows[0].style.opacity).toBe("1");

    // Far message (distance 20, between NEAR=10 and FAR=100) should have reduced opacity
    const farOpacity = parseFloat(rows[1].style.opacity);
    expect(farOpacity).toBeLessThan(1);
    expect(farOpacity).toBeGreaterThan(0);
  });

  it("send button click sends message and clears input", () => {
    const client = createMockClient();
    plugin.mount(container, client);

    const overlay = container.children[0] as HTMLElement;
    findToggleButton(overlay).click();

    const input = findInput(overlay);
    input.value = "Button send test";

    const sendBtn = findSendButton(overlay);
    sendBtn.click();

    expect(client.sendChatMessage).toHaveBeenCalledWith("Button send test");
    expect(input.value).toBe("");
  });

  it("MAX_MESSAGES eviction keeps message count at 200", () => {
    const client = createMockClient();
    plugin.mount(container, client);

    const overlay = container.children[0] as HTMLElement;
    findToggleButton(overlay).click();

    // Emit 201 messages
    for (let i = 0; i < 201; i++) {
      client._emitChat({
        username: "User",
        message: `msg ${i}`,
        fromConnectionId: 3,
        isLocal: false,
      });
    }

    const messageArea = findMessageArea(overlay);
    expect(messageArea.children.length).toBeLessThanOrEqual(200);
  });

  it("onConfigChanged hides chat when enableChat is false", () => {
    const client = createMockClient();
    plugin.mount(container, client);

    const overlay = container.children[0] as HTMLElement;
    expect(overlay.style.display).toBe("");

    plugin.onConfigChanged({ enableChat: false });
    expect(overlay.style.display).toBe("none");
  });

  it("onConfigChanged shows chat when enableChat is true", () => {
    const client = createMockClient();
    plugin.mount(container, client);

    plugin.onConfigChanged({ enableChat: false });
    const overlay = container.children[0] as HTMLElement;
    expect(overlay.style.display).toBe("none");

    plugin.onConfigChanged({ enableChat: true });
    expect(overlay.style.display).toBe("");
  });

  it("Enter key does not open panel when chat is disabled", () => {
    const client = createMockClient();
    plugin.mount(container, client);

    plugin.onConfigChanged({ enableChat: false });

    const overlay = container.children[0] as HTMLElement;
    const panel = findPanel(overlay);

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(panel.style.display).toBe("none");
  });

  it("Enter key opens panel when no input is focused", () => {
    const client = createMockClient();
    plugin.mount(container, client);

    const overlay = container.children[0] as HTMLElement;
    const panel = findPanel(overlay);

    // Panel starts closed
    expect(panel.style.display).toBe("none");

    // No input should be focused (activeElement is body)
    expect(document.activeElement).toBe(document.body);

    // Dispatch Enter keydown on document
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(panel.style.display).toBe("flex");
  });

  it("Escape from input closes panel", () => {
    const client = createMockClient();
    plugin.mount(container, client);

    const overlay = container.children[0] as HTMLElement;
    findToggleButton(overlay).click();

    const panel = findPanel(overlay);
    expect(panel.style.display).toBe("flex");

    const input = findInput(overlay);
    input.focus();

    // Dispatch Escape on the input
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect(panel.style.display).toBe("none");
  });

  it("passive toast messages appear when panel is closed", () => {
    const client = createMockClient();
    plugin.mount(container, client);

    const overlay = container.children[0] as HTMLElement;
    const panel = findPanel(overlay);
    expect(panel.style.display).toBe("none");

    // Emit a chat message while panel is closed
    client._emitChat({
      username: "ToastUser",
      message: "Hello from toast",
      fromConnectionId: 3,
      isLocal: false,
    });

    const passiveArea = findPassiveArea(overlay);
    expect(passiveArea).not.toBeNull();
    expect(passiveArea.children.length).toBeGreaterThan(0);
    expect(passiveArea.textContent).toContain("ToastUser");
    expect(passiveArea.textContent).toContain("Hello from toast");
  });
});
