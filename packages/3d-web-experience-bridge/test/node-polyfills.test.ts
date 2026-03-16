import { afterEach, beforeEach, describe, expect, test } from "vitest";

describe("node-polyfills", () => {
  beforeEach(() => {
    // Clear the installed flag so installNodePolyfills() can re-run
    delete (globalThis as any).__nodePolyfillsInstalled;
  });

  afterEach(() => {
    delete (globalThis as any).__nodePolyfillsInstalled;
  });

  test("installNodePolyfills sets up expected globals", async () => {
    // eslint-disable-next-line import/no-unresolved -- .js extension resolves after ESM build
    const { installNodePolyfills } = await import("../src/node-polyfills.js");
    installNodePolyfills();

    expect((globalThis as any).HTMLCanvasElement).toBeDefined();
    expect((globalThis as any).HTMLImageElement).toBeDefined();
    expect((globalThis as any).Image).toBeDefined();
    expect((globalThis as any).ImageData).toBeDefined();
    expect((globalThis as any).document).toBeDefined();
    expect((globalThis as any).document.createElement).toBeInstanceOf(Function);
    expect((globalThis as any).document.createElementNS).toBeInstanceOf(Function);
  });

  test("document.createElement('canvas') creates a real canvas with getContext", async () => {
    // eslint-disable-next-line import/no-unresolved -- .js extension resolves after ESM build
    const { installNodePolyfills } = await import("../src/node-polyfills.js");
    installNodePolyfills();

    const canvas = (globalThis as any).document.createElement("canvas");
    expect(canvas).toBeDefined();
    expect(canvas.width).toBeDefined();
    expect(canvas.height).toBeDefined();

    const ctx = canvas.getContext("2d");
    expect(ctx).toBeDefined();
    expect(typeof ctx.fillRect).toBe("function");
  });

  test("document.createElement('img') fires load event with 1x1 blank image", async () => {
    // eslint-disable-next-line import/no-unresolved -- .js extension resolves after ESM build
    const { installNodePolyfills } = await import("../src/node-polyfills.js");
    installNodePolyfills();

    const img = (globalThis as any).document.createElement("img");
    expect(img).toBeDefined();

    const loaded = await new Promise<boolean>((resolve) => {
      img.addEventListener("load", () => resolve(true));
      img.addEventListener("error", () => resolve(false));
      img.src = "https://example.com/texture.png";
    });

    expect(loaded).toBe(true);
    expect(img.width).toBe(1);
    expect(img.height).toBe(1);
  });
});
