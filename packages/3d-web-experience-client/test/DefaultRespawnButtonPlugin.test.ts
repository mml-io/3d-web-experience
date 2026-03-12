/**
 * @jest-environment jsdom
 */
import { jest } from "@jest/globals";

import { DefaultRespawnButtonPlugin } from "../src/DefaultRespawnButtonPlugin";

function createMockClient(enableRespawnButton = false) {
  return {
    getSpawnConfiguration: jest.fn().mockReturnValue({ enableRespawnButton }),
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

  it("does not create button when enableRespawnButton is false", () => {
    const client = createMockClient(false);
    plugin.mount(container, client);
    expect(findButton(container)).toBeNull();
  });

  it("creates button when enableRespawnButton is true", () => {
    const client = createMockClient(true);
    plugin.mount(container, client);

    const button = findButton(container);
    expect(button).not.toBeNull();
    expect(button!.textContent).toBe("RESPAWN");
  });

  it("calls client.respawn() on click", () => {
    const client = createMockClient(true);
    plugin.mount(container, client);

    const button = findButton(container)!;
    button.click();
    expect(client.respawn).toHaveBeenCalledTimes(1);
  });

  it("onConfigChanged shows button when enableRespawnButton becomes true", () => {
    const client = createMockClient(false);
    plugin.mount(container, client);
    expect(findButton(container)).toBeNull();

    plugin.onConfigChanged({ spawnConfiguration: { enableRespawnButton: true } as any });
    const button = findButton(container);
    expect(button).not.toBeNull();
    expect(button!.textContent).toBe("RESPAWN");
  });

  it("onConfigChanged hides button when enableRespawnButton becomes false", () => {
    const client = createMockClient(true);
    plugin.mount(container, client);
    expect(findButton(container)).not.toBeNull();

    plugin.onConfigChanged({ spawnConfiguration: { enableRespawnButton: false } as any });
    expect(findButton(container)).toBeNull();
  });

  it("onConfigChanged ignores updates without spawnConfiguration", () => {
    const client = createMockClient(true);
    plugin.mount(container, client);
    expect(findButton(container)).not.toBeNull();

    plugin.onConfigChanged({ environmentConfiguration: {} as any });
    expect(findButton(container)).not.toBeNull();
  });

  it("onConfigChanged does not duplicate button on repeated true", () => {
    const client = createMockClient(true);
    plugin.mount(container, client);

    plugin.onConfigChanged({ spawnConfiguration: { enableRespawnButton: true } as any });
    plugin.onConfigChanged({ spawnConfiguration: { enableRespawnButton: true } as any });

    const buttons = container.querySelectorAll("div");
    expect(buttons.length).toBe(1);
  });

  it("dispose removes the button and clears references", () => {
    const client = createMockClient(true);
    plugin.mount(container, client);
    expect(findButton(container)).not.toBeNull();

    plugin.dispose();
    expect(findButton(container)).toBeNull();
  });

  it("dispose is safe to call multiple times", () => {
    const client = createMockClient(true);
    plugin.mount(container, client);

    expect(() => {
      plugin.dispose();
      plugin.dispose();
    }).not.toThrow();
  });

  // --- Phase 4: Style Event Tests ---

  it("hover changes styles", () => {
    const client = createMockClient(true);
    plugin.mount(container, client);

    const button = findButton(container)!;

    button.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
    expect(button.style.transform).toBe("translateY(-1px)");

    button.dispatchEvent(new MouseEvent("mouseleave", { bubbles: true }));
    expect(button.style.transform).toBe("");
  });

  it("pointer press changes styles", () => {
    const client = createMockClient(true);
    plugin.mount(container, client);

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
