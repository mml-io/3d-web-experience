import { describe, expect, it } from "@jest/globals";

import type { SessionConfigPayload } from "./sessionConfig";
import { parseSessionConfigPayload, serializeSessionConfigPayload } from "./sessionConfig";

describe("SessionConfigPayload type", () => {
  it("accepts a minimal (empty) session config", () => {
    const config: SessionConfigPayload = {};
    expect(config).toBeDefined();
  });

  it("accepts a session config with authToken string", () => {
    const config: SessionConfigPayload = { authToken: "jwt-123" };
    expect(config.authToken).toBe("jwt-123");
  });

  it("accepts a session config with authToken null", () => {
    const config: SessionConfigPayload = { authToken: null };
    expect(config.authToken).toBeNull();
  });
});

describe("parseSessionConfigPayload", () => {
  it("parses a minimal (empty) config", () => {
    const result = parseSessionConfigPayload(JSON.stringify({}));
    expect(result).not.toBeInstanceOf(Error);
    expect(result).toEqual({});
  });

  it("parses a config with authToken string", () => {
    const result = parseSessionConfigPayload(JSON.stringify({ authToken: "jwt-abc" }));
    expect(result).not.toBeInstanceOf(Error);
    expect(result).toEqual({ authToken: "jwt-abc" });
  });

  it("parses a config with authToken null", () => {
    const result = parseSessionConfigPayload(JSON.stringify({ authToken: null }));
    expect(result).not.toBeInstanceOf(Error);
    expect(result).toEqual({ authToken: null });
  });

  it("returns an Error for malformed JSON", () => {
    const result = parseSessionConfigPayload("not json");
    expect(result).toBeInstanceOf(Error);
  });

  it("returns an Error for a JSON array", () => {
    const result = parseSessionConfigPayload(JSON.stringify([1, 2]));
    expect(result).toBeInstanceOf(Error);
  });

  it("returns an Error for null", () => {
    const result = parseSessionConfigPayload("null");
    expect(result).toBeInstanceOf(Error);
  });

  it("returns an Error when authToken is a number", () => {
    const result = parseSessionConfigPayload(JSON.stringify({ authToken: 42 }));
    expect(result).toBeInstanceOf(Error);
  });

  it("returns an Error when authToken is a boolean", () => {
    const result = parseSessionConfigPayload(JSON.stringify({ authToken: true }));
    expect(result).toBeInstanceOf(Error);
  });
});

describe("serializeSessionConfigPayload", () => {
  it("serializes an empty config", () => {
    const serialized = serializeSessionConfigPayload({});
    expect(JSON.parse(serialized)).toEqual({});
  });

  it("serializes a config with authToken", () => {
    const config: SessionConfigPayload = { authToken: "jwt-xyz" };
    const serialized = serializeSessionConfigPayload(config);
    expect(JSON.parse(serialized)).toEqual(config);
  });

  it("round-trips correctly", () => {
    const original: SessionConfigPayload = { authToken: "round-trip-token" };
    const serialized = serializeSessionConfigPayload(original);
    const reparsed = parseSessionConfigPayload(serialized);
    expect(reparsed).toEqual(original);
  });
});
