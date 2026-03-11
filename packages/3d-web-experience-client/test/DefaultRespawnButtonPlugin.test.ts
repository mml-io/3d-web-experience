/**
 * @jest-environment jsdom
 */
import { jest } from "@jest/globals";

import { DefaultRespawnButtonPlugin } from "../src/DefaultRespawnButtonPlugin";

function createMockClient() {
  return {
    respawn: jest.fn(),
  } as any;
}

function findButton(container: HTMLElement): HTMLDivElement | null {
  return container.querySelector("div") as HTMLDivElement | null;
}

describe("DefaultRespawnButtonPlugin", () => {
  let container: HTMLDivElement;
  let plugin: DefaultRespawnButtonPlugin;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    plugin = new DefaultRespawnButtonPlugin();
  });

  afterEach(() => {
    plugin.dispose();
    container.remove();
  });

  it("starts hidden after mount", () => {
    const client = createMockClient();
    plugin.mount(container, client);
    expect(findButton(container)).toBeNull();
  });

  it("onConfigChanged shows button via hud.respawnButton: true", () => {
    const client = createMockClient();
    plugin.mount(container, client);
    expect(findButton(container)).toBeNull();

    plugin.onConfigChanged({ hud: { respawnButton: true } });
    const button = findButton(container);
    expect(button).not.toBeNull();
    expect(button!.textContent).toBe("RESPAWN");
  });

  it("onConfigChanged hides button via hud.respawnButton: false", () => {
    const client = createMockClient();
    plugin.mount(container, client);

    plugin.onConfigChanged({ hud: { respawnButton: true } });
    expect(findButton(container)).not.toBeNull();

    plugin.onConfigChanged({ hud: { respawnButton: false } });
    expect(findButton(container)).toBeNull();
  });

  it("onConfigChanged hides button when hud is false", () => {
    const client = createMockClient();
    plugin.mount(container, client);

    plugin.onConfigChanged({ hud: { respawnButton: true } });
    expect(findButton(container)).not.toBeNull();

    plugin.onConfigChanged({ hud: false });
    expect(findButton(container)).toBeNull();
  });

  it("calls client.respawn() on click", () => {
    const client = createMockClient();
    plugin.mount(container, client);

    plugin.onConfigChanged({ hud: { respawnButton: true } });
    const button = findButton(container)!;
    button.click();
    expect(client.respawn).toHaveBeenCalledTimes(1);
  });

  it("onConfigChanged ignores updates without hud", () => {
    const client = createMockClient();
    plugin.mount(container, client);

    plugin.onConfigChanged({ hud: { respawnButton: true } });
    expect(findButton(container)).not.toBeNull();

    plugin.onConfigChanged({ environmentConfiguration: {} as any });
    expect(findButton(container)).not.toBeNull();
  });

  it("onConfigChanged does not duplicate button on repeated true", () => {
    const client = createMockClient();
    plugin.mount(container, client);

    plugin.onConfigChanged({ hud: { respawnButton: true } });
    plugin.onConfigChanged({ hud: { respawnButton: true } });

    const buttons = container.querySelectorAll("div");
    expect(buttons.length).toBe(1);
  });

  it("dispose removes the button and clears references", () => {
    const client = createMockClient();
    plugin.mount(container, client);

    plugin.onConfigChanged({ hud: { respawnButton: true } });
    expect(findButton(container)).not.toBeNull();

    plugin.dispose();
    expect(findButton(container)).toBeNull();
  });

  it("dispose is safe to call multiple times", () => {
    const client = createMockClient();
    plugin.mount(container, client);

    plugin.onConfigChanged({ hud: { respawnButton: true } });

    expect(() => {
      plugin.dispose();
      plugin.dispose();
    }).not.toThrow();
  });

  // --- Style Event Tests ---

  it("hover changes styles", () => {
    const client = createMockClient();
    plugin.mount(container, client);

    plugin.onConfigChanged({ hud: { respawnButton: true } });
    const button = findButton(container)!;

    button.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
    expect(button.style.transform).toBe("translateY(-1px)");

    button.dispatchEvent(new MouseEvent("mouseleave", { bubbles: true }));
    expect(button.style.transform).toBe("");
  });

  it("pointer press changes styles", () => {
    const client = createMockClient();
    plugin.mount(container, client);

    plugin.onConfigChanged({ hud: { respawnButton: true } });
    const button = findButton(container)!;

    // mouseenter first to set hover state
    button.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
    expect(button.style.transform).toBe("translateY(-1px)");

    // pointerdown — jsdom lacks PointerEvent, use Event
    button.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(button.style.transform).toBe("translateY(0)");

    // pointerup
    button.dispatchEvent(new Event("pointerup", { bubbles: true }));
    expect(button.style.transform).toBe("translateY(-1px)");
  });
});
