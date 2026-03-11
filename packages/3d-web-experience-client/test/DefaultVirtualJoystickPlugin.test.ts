/**
 * @jest-environment jsdom
 */
import { jest } from "@jest/globals";

// Mock VirtualJoystick before importing the plugin
const mockVirtualJoystick = jest.fn();
jest.unstable_mockModule("@mml-io/3d-web-client-core", () => ({
  VirtualJoystick: mockVirtualJoystick,
}));

// Dynamic import after mock setup (ESM requirement)
const { DefaultVirtualJoystickPlugin } = await import("../src/DefaultVirtualJoystickPlugin");

describe("DefaultVirtualJoystickPlugin", () => {
  let container: HTMLDivElement;
  let mockClient: any;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    mockVirtualJoystick.mockClear();
    mockClient = {
      setAdditionalInputProvider: jest.fn(),
    };
  });

  afterEach(() => {
    container.remove();
  });

  it("mount creates a wrapper div in the container", () => {
    const plugin = new DefaultVirtualJoystickPlugin();
    plugin.mount(container, mockClient);

    expect(container.children.length).toBe(1);
    expect(container.children[0].tagName).toBe("DIV");

    plugin.dispose();
  });

  it("mount creates VirtualJoystick with default options", () => {
    const plugin = new DefaultVirtualJoystickPlugin();
    plugin.mount(container, mockClient);

    expect(mockVirtualJoystick).toHaveBeenCalledTimes(1);
    expect(mockVirtualJoystick).toHaveBeenCalledWith(expect.any(HTMLDivElement), {
      radius: 70,
      innerRadius: 20,
      mouseSupport: false,
    });

    plugin.dispose();
  });

  it("mount creates VirtualJoystick with custom options", () => {
    const plugin = new DefaultVirtualJoystickPlugin({
      radius: 100,
      innerRadius: 30,
      mouseSupport: true,
    });
    plugin.mount(container, mockClient);

    expect(mockVirtualJoystick).toHaveBeenCalledWith(expect.any(HTMLDivElement), {
      radius: 100,
      innerRadius: 30,
      mouseSupport: true,
    });

    plugin.dispose();
  });

  it("mount calls setAdditionalInputProvider on client", () => {
    const plugin = new DefaultVirtualJoystickPlugin();
    plugin.mount(container, mockClient);

    expect(mockClient.setAdditionalInputProvider).toHaveBeenCalledTimes(1);

    plugin.dispose();
  });

  it("dispose removes wrapper from container", () => {
    const plugin = new DefaultVirtualJoystickPlugin();
    plugin.mount(container, mockClient);
    expect(container.children.length).toBe(1);

    plugin.dispose();
    expect(container.children.length).toBe(0);
  });

  it("dispose is safe to call multiple times", () => {
    const plugin = new DefaultVirtualJoystickPlugin();
    plugin.mount(container, mockClient);

    expect(() => {
      plugin.dispose();
      plugin.dispose();
    }).not.toThrow();
  });

  // --- Phase 5: Partial Options ---

  it("partial options use defaults for missing values", () => {
    const plugin = new DefaultVirtualJoystickPlugin({ radius: 100 });
    plugin.mount(container, mockClient);

    expect(mockVirtualJoystick).toHaveBeenCalledWith(expect.any(HTMLDivElement), {
      radius: 100,
      innerRadius: 20,
      mouseSupport: false,
    });

    plugin.dispose();
  });
});
