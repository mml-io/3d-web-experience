import { describe, expect, it } from "@jest/globals";

import { parseServerBroadcastMessage, serializeServerBroadcastMessage } from "./broadcast";

describe("parseServerBroadcastMessage", () => {
  it("parses a valid broadcast message with object payload", () => {
    const input = JSON.stringify({ broadcastType: "update", payload: { key: "value" } });
    const result = parseServerBroadcastMessage(input);
    expect(result).not.toBeInstanceOf(Error);
    expect(result).toEqual({ broadcastType: "update", payload: { key: "value" } });
  });

  it("rejects null payload", () => {
    const input = JSON.stringify({ broadcastType: "update", payload: null });
    const result = parseServerBroadcastMessage(input);
    expect(result).toBeInstanceOf(Error);
  });

  it("rejects an array as payload", () => {
    const input = JSON.stringify({ broadcastType: "update", payload: [1, 2, 3] });
    const result = parseServerBroadcastMessage(input);
    expect(result).toBeInstanceOf(Error);
  });

  it("returns an Error when broadcastType is missing", () => {
    const input = JSON.stringify({ payload: { data: 1 } });
    const result = parseServerBroadcastMessage(input);
    expect(result).toBeInstanceOf(Error);
  });

  it("returns an Error when payload is missing", () => {
    const input = JSON.stringify({ broadcastType: "update" });
    const result = parseServerBroadcastMessage(input);
    expect(result).toBeInstanceOf(Error);
  });

  it("returns an Error when broadcastType is a number", () => {
    const input = JSON.stringify({ broadcastType: 42, payload: {} });
    const result = parseServerBroadcastMessage(input);
    expect(result).toBeInstanceOf(Error);
  });

  it("rejects payload that is a string (primitive, not object)", () => {
    const input = JSON.stringify({ broadcastType: "update", payload: "data" });
    const result = parseServerBroadcastMessage(input);
    expect(result).toBeInstanceOf(Error);
  });

  it("rejects payload that is a number", () => {
    const input = JSON.stringify({ broadcastType: "update", payload: 123 });
    const result = parseServerBroadcastMessage(input);
    expect(result).toBeInstanceOf(Error);
  });

  it("returns an Error for malformed JSON", () => {
    const result = parseServerBroadcastMessage("not-json");
    expect(result).toBeInstanceOf(Error);
  });

  it("accepts a deeply nested payload", () => {
    const payload = { a: { b: { c: { d: "deep" } } } };
    const input = JSON.stringify({ broadcastType: "nested", payload });
    const result = parseServerBroadcastMessage(input);
    expect(result).not.toBeInstanceOf(Error);
    expect(result).toEqual({ broadcastType: "nested", payload });
  });
});

describe("serializeServerBroadcastMessage", () => {
  it("serializes a broadcast message", () => {
    const msg = { broadcastType: "update", payload: { key: "value" } };
    const serialized = serializeServerBroadcastMessage(msg);
    expect(JSON.parse(serialized)).toEqual(msg);
  });
});

describe("broadcast message round-trips", () => {
  it("server broadcast message round-trips correctly", () => {
    const original = { broadcastType: "event", payload: { data: 42 } };
    const serialized = serializeServerBroadcastMessage(original);
    const reparsed = parseServerBroadcastMessage(serialized);
    expect(reparsed).toEqual(original);
  });
});
