/**
 * @jest-environment jsdom
 */
import { jest } from "@jest/globals";

import { DefaultAvatarSelectionPlugin } from "../src/DefaultAvatarSelectionPlugin";

function createMockClient(overrides: Record<string, any> = {}) {
  return {
    getConnectionId: jest.fn().mockReturnValue(1),
    getUserProfile: jest.fn().mockReturnValue({
      username: "TestUser",
      characterDescription: { meshFileUrl: "https://example.com/avatar.glb" },
    }),
    selectAvatar: jest.fn(),
    setDisplayName: jest.fn(),
    ...overrides,
  } as any;
}

// --- Helpers to reduce fragile DOM selectors ---

function findToggleButton(overlay: HTMLElement): HTMLElement {
  return overlay.querySelector("div[title='Avatar & Display Name']") as HTMLElement;
}

function findPanel(overlay: HTMLElement): HTMLElement {
  // The panel is the second child of the overlay
  return overlay.children[1] as HTMLElement;
}

function findApplyButton(panel: HTMLElement): HTMLButtonElement {
  return panel.querySelector("button") as HTMLButtonElement;
}

function findCloseButton(panel: HTMLElement): HTMLElement {
  return panel.querySelector("span[title='Close']") as HTMLElement;
}

function findGrid(panel: HTMLElement): HTMLElement {
  const gridScroll = panel.querySelector(".default-avatar-grid") as HTMLElement;
  return gridScroll.firstElementChild as HTMLElement;
}

function findRadios(panel: HTMLElement): NodeListOf<HTMLInputElement> {
  return panel.querySelectorAll("input[type='radio']");
}

function findCustomInput(panel: HTMLElement): HTMLInputElement | HTMLTextAreaElement {
  // The custom input is either an <input> or <textarea> inside the custom section
  // It's after the radio group, find by the section that has "Custom Avatar" label
  const sections = Array.from(panel.querySelectorAll("div"));
  for (const s of sections) {
    if (s.textContent === "Custom Avatar") {
      const parent = s.parentElement!;
      const input = parent.querySelector("input[type='text'], textarea");
      if (input) return input as HTMLInputElement | HTMLTextAreaElement;
    }
  }
  // Fallback: find last input that is not the name input and not a radio
  const inputs = panel.querySelectorAll("input[type='text'], textarea");
  return inputs[inputs.length - 1] as HTMLInputElement | HTMLTextAreaElement;
}

describe("DefaultAvatarSelectionPlugin", () => {
  let container: HTMLDivElement;
  let plugin: DefaultAvatarSelectionPlugin;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    plugin = new DefaultAvatarSelectionPlugin();
  });

  afterEach(() => {
    plugin.dispose();
    container.remove();
  });

  it("mount creates a container element", () => {
    const client = createMockClient();
    plugin.mount(container, client);

    expect(container.children.length).toBe(1);
    const overlay = container.children[0] as HTMLElement;
    expect(overlay.style.pointerEvents).toBe("none");
  });

  it("mount creates a toggle button", () => {
    const client = createMockClient();
    plugin.mount(container, client);

    const overlay = container.children[0] as HTMLElement;
    const toggleBtn = findToggleButton(overlay);
    expect(toggleBtn).not.toBeNull();
    expect(toggleBtn.style.cursor).toBe("pointer");
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
    expect(toggleBtn.style.display).toBe("none");
  });

  it("panel has a close button that closes it", () => {
    const client = createMockClient();
    plugin.mount(container, client);

    const overlay = container.children[0] as HTMLElement;
    const toggleBtn = findToggleButton(overlay);
    const panel = findPanel(overlay);

    toggleBtn.click();
    expect(panel.style.display).toBe("flex");

    const closeBtn = findCloseButton(panel);
    expect(closeBtn).not.toBeNull();

    closeBtn.click();
    expect(panel.style.display).toBe("none");
    expect(toggleBtn.style.display).toBe("flex");
  });

  it("Escape key closes the panel", () => {
    const client = createMockClient();
    plugin.mount(container, client);

    const overlay = container.children[0] as HTMLElement;
    const toggleBtn = findToggleButton(overlay);
    const panel = findPanel(overlay);

    toggleBtn.click();
    expect(panel.style.display).toBe("flex");

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(panel.style.display).toBe("none");
  });

  it("onConfigChanged with avatarConfiguration rebuilds grid", () => {
    const client = createMockClient();
    plugin.mount(container, client);

    plugin.onConfigChanged({
      avatarConfiguration: {
        availableAvatars: [
          { name: "Robot", meshFileUrl: "https://example.com/robot.glb" },
          { name: "Human", meshFileUrl: "https://example.com/human.glb" },
        ],
      },
    });

    const overlay = container.children[0] as HTMLElement;
    findToggleButton(overlay).click();

    const panel = findPanel(overlay);
    const grid = findGrid(panel);
    expect(grid.children.length).toBe(2);
  });

  it("onConfigChanged with allowCustomDisplayName shows name input", () => {
    const client = createMockClient();
    plugin.mount(container, client);

    plugin.onConfigChanged({ allowCustomDisplayName: true });

    const overlay = container.children[0] as HTMLElement;
    findToggleButton(overlay).click();

    const panel = findPanel(overlay);
    const nameInput = panel.querySelector("input[type='text']") as HTMLInputElement;
    expect(nameInput).not.toBeNull();
    expect(nameInput.placeholder).toBe("Enter display name...");
  });

  it("onConfigChanged with allowCustomAvatars shows custom input", () => {
    const client = createMockClient();
    plugin.mount(container, client);

    plugin.onConfigChanged({
      avatarConfiguration: {
        availableAvatars: [],
        allowCustomAvatars: true,
      },
    });

    const overlay = container.children[0] as HTMLElement;
    const panel = findPanel(overlay);

    const radios = findRadios(panel);
    expect(radios.length).toBe(3);
  });

  it("apply button calls selectAvatar when avatar is selected", () => {
    const client = createMockClient();
    plugin.mount(container, client);

    plugin.onConfigChanged({
      avatarConfiguration: {
        availableAvatars: [{ name: "Robot", meshFileUrl: "https://example.com/robot.glb" }],
      },
    });

    const overlay = container.children[0] as HTMLElement;
    findToggleButton(overlay).click();

    const panel = findPanel(overlay);
    const grid = findGrid(panel);
    const gridCell = grid.children[0] as HTMLElement;
    gridCell.click();

    const applyBtn = findApplyButton(panel);
    applyBtn.click();

    expect(client.selectAvatar).toHaveBeenCalledWith({
      meshFileUrl: "https://example.com/robot.glb",
    });
  });

  it("apply button calls setDisplayName when name input has value", () => {
    const client = createMockClient();
    plugin.mount(container, client);

    plugin.onConfigChanged({
      allowCustomDisplayName: true,
      avatarConfiguration: {
        availableAvatars: [{ name: "Robot", meshFileUrl: "https://example.com/robot.glb" }],
      },
    });

    const overlay = container.children[0] as HTMLElement;
    findToggleButton(overlay).click();

    const panel = findPanel(overlay);
    const nameInput = panel.querySelector(
      "input[placeholder='Enter display name...']",
    ) as HTMLInputElement;
    nameInput.value = "NewName";

    const applyBtn = findApplyButton(panel);
    applyBtn.click();

    expect(client.setDisplayName).toHaveBeenCalledWith("NewName");
  });

  it("dispose removes the container and cleans up escape handler", () => {
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

  // --- Phase 2: Custom Avatar & Sync Tests ---

  it("custom avatar apply — MML URL (default radio)", () => {
    const client = createMockClient({
      getUserProfile: jest.fn().mockReturnValue(null),
    });
    plugin.mount(container, client);

    plugin.onConfigChanged({
      avatarConfiguration: {
        availableAvatars: [],
        allowCustomAvatars: true,
      },
    });

    const overlay = container.children[0] as HTMLElement;
    findToggleButton(overlay).click();

    const panel = findPanel(overlay);
    const customInput = findCustomInput(panel);
    // Default radio is MML URL, input should be <input type="text">
    expect(customInput.tagName).toBe("INPUT");

    // Set value via property and dispatch input event
    customInput.value = "https://example.com/avatar.html";
    customInput.dispatchEvent(new Event("input", { bubbles: true }));

    findApplyButton(panel).click();

    expect(client.selectAvatar).toHaveBeenCalledWith({
      mmlCharacterUrl: "https://example.com/avatar.html",
    });
  });

  it("custom avatar apply — MML string", () => {
    const client = createMockClient({
      getUserProfile: jest.fn().mockReturnValue(null),
    });
    plugin.mount(container, client);

    plugin.onConfigChanged({
      avatarConfiguration: {
        availableAvatars: [],
        allowCustomAvatars: true,
      },
    });

    const overlay = container.children[0] as HTMLElement;
    findToggleButton(overlay).click();

    const panel = findPanel(overlay);

    // Click the "MML" radio (second radio)
    const radios = findRadios(panel);
    radios[1].checked = true;
    radios[1].dispatchEvent(new Event("change", { bubbles: true }));

    // After changing radio, the input should now be a textarea
    const customInput = findCustomInput(panel);
    expect(customInput.tagName).toBe("TEXTAREA");

    customInput.value = '<m-character src="https://example.com"></m-character>';
    customInput.dispatchEvent(new Event("input", { bubbles: true }));

    findApplyButton(panel).click();

    expect(client.selectAvatar).toHaveBeenCalledWith({
      mmlCharacterString: '<m-character src="https://example.com"></m-character>',
    });
  });

  it("custom avatar apply — Mesh URL", () => {
    const client = createMockClient({
      getUserProfile: jest.fn().mockReturnValue(null),
    });
    plugin.mount(container, client);

    plugin.onConfigChanged({
      avatarConfiguration: {
        availableAvatars: [],
        allowCustomAvatars: true,
      },
    });

    const overlay = container.children[0] as HTMLElement;
    findToggleButton(overlay).click();

    const panel = findPanel(overlay);

    // Click the "Mesh URL" radio (third radio)
    const radios = findRadios(panel);
    radios[2].checked = true;
    radios[2].dispatchEvent(new Event("change", { bubbles: true }));

    const customInput = findCustomInput(panel);
    expect(customInput.tagName).toBe("INPUT");

    customInput.value = "https://example.com/avatar.glb";
    customInput.dispatchEvent(new Event("input", { bubbles: true }));

    findApplyButton(panel).click();

    expect(client.selectAvatar).toHaveBeenCalledWith({
      meshFileUrl: "https://example.com/avatar.glb",
    });
  });

  it("radio switching changes input element type", () => {
    const client = createMockClient({
      getUserProfile: jest.fn().mockReturnValue(null),
    });
    plugin.mount(container, client);

    plugin.onConfigChanged({
      avatarConfiguration: {
        availableAvatars: [],
        allowCustomAvatars: true,
      },
    });

    const overlay = container.children[0] as HTMLElement;
    findToggleButton(overlay).click();

    const panel = findPanel(overlay);

    // Default: MML URL → <input type="text">
    expect(findCustomInput(panel).tagName).toBe("INPUT");

    // Switch to MML → <textarea>
    const radios = findRadios(panel);
    radios[1].checked = true;
    radios[1].dispatchEvent(new Event("change", { bubbles: true }));
    expect(findCustomInput(panel).tagName).toBe("TEXTAREA");

    // Switch back to MML URL → <input type="text">
    const radiosAfter = findRadios(panel);
    radiosAfter[0].checked = true;
    radiosAfter[0].dispatchEvent(new Event("change", { bubbles: true }));
    expect(findCustomInput(panel).tagName).toBe("INPUT");
  });

  it("typing in custom input deselects grid avatar", () => {
    const client = createMockClient({
      getUserProfile: jest.fn().mockReturnValue(null),
    });
    plugin.mount(container, client);

    plugin.onConfigChanged({
      avatarConfiguration: {
        availableAvatars: [{ name: "Robot", meshFileUrl: "https://example.com/robot.glb" }],
        allowCustomAvatars: true,
      },
    });

    const overlay = container.children[0] as HTMLElement;
    findToggleButton(overlay).click();

    const panel = findPanel(overlay);
    const grid = findGrid(panel);

    // Click avatar cell to select it
    (grid.children[0] as HTMLElement).click();

    // Re-query after renderGrid rebuild
    const selectedCell = findGrid(panel).children[0] as HTMLElement;
    expect(selectedCell.style.border).toContain("#ffffff");

    // Type in custom input — this deselects the grid avatar
    const customInput = findCustomInput(panel);
    customInput.value = "https://custom.com/avatar.html";
    customInput.dispatchEvent(new Event("input", { bubbles: true }));

    // Apply — should use custom input value (mmlCharacterUrl), not grid avatar
    findApplyButton(panel).click();

    expect(client.selectAvatar).toHaveBeenCalledWith({
      mmlCharacterUrl: "https://custom.com/avatar.html",
    });
  });

  it("syncCurrentState pre-fills name on open", () => {
    const client = createMockClient({
      getUserProfile: jest.fn().mockReturnValue({
        username: "ExistingName",
        characterDescription: { meshFileUrl: "https://example.com/avatar.glb" },
      }),
    });
    plugin.mount(container, client);

    plugin.onConfigChanged({
      allowCustomDisplayName: true,
      avatarConfiguration: {
        availableAvatars: [{ name: "Avatar", meshFileUrl: "https://example.com/avatar.glb" }],
      },
    });

    const overlay = container.children[0] as HTMLElement;
    findToggleButton(overlay).click();

    const panel = findPanel(overlay);
    const nameInput = panel.querySelector(
      "input[placeholder='Enter display name...']",
    ) as HTMLInputElement;
    expect(nameInput.value).toBe("ExistingName");
  });

  it("syncCurrentState selects matching grid avatar", () => {
    const client = createMockClient({
      getUserProfile: jest.fn().mockReturnValue({
        username: "TestUser",
        characterDescription: { meshFileUrl: "https://match.glb" },
      }),
    });
    plugin.mount(container, client);

    plugin.onConfigChanged({
      avatarConfiguration: {
        availableAvatars: [
          { name: "Other", meshFileUrl: "https://other.glb" },
          { name: "Match", meshFileUrl: "https://match.glb" },
        ],
      },
    });

    const overlay = container.children[0] as HTMLElement;
    findToggleButton(overlay).click();

    const panel = findPanel(overlay);
    const grid = findGrid(panel);

    // The second cell (index 1) should be selected
    const matchingCell = grid.children[1] as HTMLElement;
    expect(matchingCell.style.border).toContain("#ffffff");

    // The first cell should not be selected
    const otherCell = grid.children[0] as HTMLElement;
    expect(otherCell.style.border).not.toContain("#ffffff");
  });

  it("apply with mmlCharacterUrl grid avatar", () => {
    const client = createMockClient();
    plugin.mount(container, client);

    plugin.onConfigChanged({
      avatarConfiguration: {
        availableAvatars: [{ name: "MML Char", mmlCharacterUrl: "https://example.com/char.html" }],
      },
    });

    const overlay = container.children[0] as HTMLElement;
    findToggleButton(overlay).click();

    const panel = findPanel(overlay);
    const grid = findGrid(panel);
    (grid.children[0] as HTMLElement).click();

    findApplyButton(panel).click();

    expect(client.selectAvatar).toHaveBeenCalledWith({
      mmlCharacterUrl: "https://example.com/char.html",
    });
  });
});
