import { describe, expect, it } from "@jest/globals";

import { MAX_CHAT_MESSAGE_LENGTH } from "../constants";

import {
  parseClientChatMessage,
  parseServerChatMessage,
  serializeClientChatMessage,
  serializeServerChatMessage,
} from "./chat";

describe("parseClientChatMessage", () => {
  it("parses a valid chat message", () => {
    const input = JSON.stringify({ message: "hello world" });
    const result = parseClientChatMessage(input);
    expect(result).not.toBeInstanceOf(Error);
    expect(result).toEqual({ message: "hello world" });
  });

  it("returns an Error when the message field is missing", () => {
    const input = JSON.stringify({ text: "hello" });
    const result = parseClientChatMessage(input);
    expect(result).toBeInstanceOf(Error);
  });

  it("returns an Error when message is a number instead of a string", () => {
    const input = JSON.stringify({ message: 42 });
    const result = parseClientChatMessage(input);
    expect(result).toBeInstanceOf(Error);
  });

  it("returns an Error when message is null", () => {
    const input = JSON.stringify({ message: null });
    const result = parseClientChatMessage(input);
    expect(result).toBeInstanceOf(Error);
  });

  it("returns an Error when message is a boolean", () => {
    const input = JSON.stringify({ message: true });
    const result = parseClientChatMessage(input);
    expect(result).toBeInstanceOf(Error);
  });

  it("does not truncate messages longer than 1000 characters (truncation is app-level)", () => {
    const longMessage = "a".repeat(1500);
    const input = JSON.stringify({ message: longMessage });
    const result = parseClientChatMessage(input);
    expect(result).not.toBeInstanceOf(Error);
    const parsed = result as { message: string };
    expect(parsed.message).toHaveLength(1500);
  });

  it("preserves messages exactly 1000 characters long", () => {
    const exactMessage = "b".repeat(1000);
    const input = JSON.stringify({ message: exactMessage });
    const result = parseClientChatMessage(input);
    expect(result).not.toBeInstanceOf(Error);
    const parsed = result as { message: string };
    expect(parsed.message).toHaveLength(1000);
  });

  it("accepts an empty string message", () => {
    const input = JSON.stringify({ message: "" });
    const result = parseClientChatMessage(input);
    expect(result).not.toBeInstanceOf(Error);
    expect(result).toEqual({ message: "" });
  });

  it("returns an Error for malformed JSON", () => {
    const result = parseClientChatMessage("not json");
    expect(result).toBeInstanceOf(Error);
  });

  it("returns an Error for a JSON array", () => {
    const input = JSON.stringify(["message", "hello"]);
    const result = parseClientChatMessage(input);
    expect(result).toBeInstanceOf(Error);
  });

  it("returns an Error for a JSON null", () => {
    const result = parseClientChatMessage("null");
    expect(result).toBeInstanceOf(Error);
  });

  it("ignores extra fields and extracts message", () => {
    const input = JSON.stringify({ message: "hi", extra: 123, nested: { a: 1 } });
    const result = parseClientChatMessage(input);
    expect(result).not.toBeInstanceOf(Error);
    expect(result).toEqual({ message: "hi" });
  });
});

describe("parseServerChatMessage", () => {
  it("parses a valid server chat message", () => {
    const input = JSON.stringify({ fromConnectionId: 7, userId: "user-abc", message: "hello" });
    const result = parseServerChatMessage(input);
    expect(result).not.toBeInstanceOf(Error);
    expect(result).toEqual({ fromConnectionId: 7, userId: "user-abc", message: "hello" });
  });

  it("returns an Error when fromConnectionId is missing", () => {
    const input = JSON.stringify({ userId: "user-abc", message: "hello" });
    const result = parseServerChatMessage(input);
    expect(result).toBeInstanceOf(Error);
  });

  it("returns an Error when message is missing", () => {
    const input = JSON.stringify({ fromConnectionId: 1, userId: "user-abc" });
    const result = parseServerChatMessage(input);
    expect(result).toBeInstanceOf(Error);
  });

  it("returns an Error when both fields are missing", () => {
    const input = JSON.stringify({});
    const result = parseServerChatMessage(input);
    expect(result).toBeInstanceOf(Error);
  });

  it("returns an Error when fromConnectionId is a string", () => {
    const input = JSON.stringify({ fromConnectionId: "7", userId: "user-abc", message: "hello" });
    const result = parseServerChatMessage(input);
    expect(result).toBeInstanceOf(Error);
  });

  it("returns an Error when message is a number", () => {
    const input = JSON.stringify({ fromConnectionId: 1, userId: "user-abc", message: 42 });
    const result = parseServerChatMessage(input);
    expect(result).toBeInstanceOf(Error);
  });

  it("returns an Error for malformed JSON", () => {
    const result = parseServerChatMessage("{bad json");
    expect(result).toBeInstanceOf(Error);
  });

  it("returns an Error for null input", () => {
    const result = parseServerChatMessage("null");
    expect(result).toBeInstanceOf(Error);
  });

  it("accepts zero as fromConnectionId", () => {
    const input = JSON.stringify({ fromConnectionId: 0, userId: "user-abc", message: "msg" });
    const result = parseServerChatMessage(input);
    expect(result).not.toBeInstanceOf(Error);
    expect(result).toEqual({ fromConnectionId: 0, userId: "user-abc", message: "msg" });
  });

  it("rejects negative fromConnectionId", () => {
    const input = JSON.stringify({ fromConnectionId: -1, userId: "user-abc", message: "msg" });
    const result = parseServerChatMessage(input);
    expect(result).toBeInstanceOf(Error);
  });

  it("defaults userId to empty string when not provided", () => {
    const input = JSON.stringify({ fromConnectionId: 3, message: "msg" });
    const result = parseServerChatMessage(input);
    expect(result).not.toBeInstanceOf(Error);
    expect(result).toEqual({ fromConnectionId: 3, userId: "", message: "msg" });
  });
});

describe("serializeClientChatMessage", () => {
  it("serializes a normal message", () => {
    const serialized = serializeClientChatMessage({ message: "hello" });
    expect(JSON.parse(serialized)).toEqual({ message: "hello" });
  });

  it("truncates messages exceeding MAX_CHAT_MESSAGE_LENGTH", () => {
    const longMessage = "x".repeat(MAX_CHAT_MESSAGE_LENGTH + 500);
    const serialized = serializeClientChatMessage({ message: longMessage });
    const parsed = JSON.parse(serialized);
    expect(parsed.message).toHaveLength(MAX_CHAT_MESSAGE_LENGTH);
  });
});

describe("serializeServerChatMessage", () => {
  it("serializes a normal message", () => {
    const serialized = serializeServerChatMessage({
      fromConnectionId: 5,
      userId: "user-xyz",
      message: "hi",
    });
    expect(JSON.parse(serialized)).toEqual({
      fromConnectionId: 5,
      userId: "user-xyz",
      message: "hi",
    });
  });

  it("truncates messages exceeding MAX_CHAT_MESSAGE_LENGTH", () => {
    const longMessage = "y".repeat(MAX_CHAT_MESSAGE_LENGTH + 500);
    const serialized = serializeServerChatMessage({
      fromConnectionId: 1,
      userId: "user-xyz",
      message: longMessage,
    });
    const parsed = JSON.parse(serialized);
    expect(parsed.message).toHaveLength(MAX_CHAT_MESSAGE_LENGTH);
  });
});

describe("chat message round-trips", () => {
  it("client chat message round-trips correctly", () => {
    const original = { message: "hello world" };
    const serialized = serializeClientChatMessage(original);
    const reparsed = parseClientChatMessage(serialized);
    expect(reparsed).toEqual(original);
  });

  it("server chat message round-trips correctly", () => {
    const original = { fromConnectionId: 7, userId: "user-abc", message: "test message" };
    const serialized = serializeServerChatMessage(original);
    const reparsed = parseServerChatMessage(serialized);
    expect(reparsed).toEqual(original);
  });
});
