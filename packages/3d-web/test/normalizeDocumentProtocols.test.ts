import { normalizeDocumentProtocols } from "../src/normalizeDocumentProtocols";

describe("normalizeDocumentProtocols", () => {
  it("returns undefined for undefined input", () => {
    expect(normalizeDocumentProtocols(undefined, "https:")).toBeUndefined();
  });

  it("resolves ws:/// to wss:/// on HTTPS pages", () => {
    const result = normalizeDocumentProtocols(
      { doc: { url: "ws:///mml-documents/hello.html" } },
      "https:",
    );
    expect(result!.doc.url).toBe("wss:///mml-documents/hello.html");
  });

  it("resolves ws:/// to ws:/// on HTTP pages", () => {
    const result = normalizeDocumentProtocols(
      { doc: { url: "ws:///mml-documents/hello.html" } },
      "http:",
    );
    expect(result!.doc.url).toBe("ws:///mml-documents/hello.html");
  });

  it("leaves wss:/// as-is on HTTP pages (secure only)", () => {
    const result = normalizeDocumentProtocols(
      { doc: { url: "wss:///mml-documents/hello.html" } },
      "http:",
    );
    expect(result!.doc.url).toBe("wss:///mml-documents/hello.html");
  });

  it("leaves wss:/// as-is on HTTPS pages", () => {
    const result = normalizeDocumentProtocols(
      { doc: { url: "wss:///mml-documents/hello.html" } },
      "https:",
    );
    expect(result!.doc.url).toBe("wss:///mml-documents/hello.html");
  });

  it("does not modify absolute ws:// URLs", () => {
    const result = normalizeDocumentProtocols({ doc: { url: "ws://example.com/doc" } }, "https:");
    expect(result!.doc.url).toBe("ws://example.com/doc");
  });

  it("does not modify absolute wss:// URLs", () => {
    const result = normalizeDocumentProtocols({ doc: { url: "wss://example.com/doc" } }, "http:");
    expect(result!.doc.url).toBe("wss://example.com/doc");
  });

  it("preserves non-url fields on the document config", () => {
    const result = normalizeDocumentProtocols(
      { doc: { url: "ws:///path", position: { x: 1, y: 2, z: 3 } } },
      "https:",
    );
    expect(result!.doc.position).toEqual({ x: 1, y: 2, z: 3 });
    expect(result!.doc.url).toBe("wss:///path");
  });

  it("handles multiple documents independently", () => {
    const result = normalizeDocumentProtocols(
      {
        a: { url: "ws:///a" },
        b: { url: "wss:///b" },
        c: { url: "wss://remote.com/c" },
      },
      "http:",
    );
    expect(result!.a.url).toBe("ws:///a");
    expect(result!.b.url).toBe("wss:///b");
    expect(result!.c.url).toBe("wss://remote.com/c");
  });
});
