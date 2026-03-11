import { BufferReader } from "../BufferReader";
import { BufferWriter } from "../BufferWriter";

import { decodeClientMessages } from "./decodeClientMessages";
import { encodeClientMessage } from "./encodeClientMessage";
import type { DeltaNetV01ClientMessage } from "./messages";

describe("encodeClientMessage + decodeClientMessages round-trip", () => {
  function roundTrip(messages: DeltaNetV01ClientMessage[]): DeltaNetV01ClientMessage[] {
    const writer = new BufferWriter(256);
    for (const msg of messages) {
      encodeClientMessage(msg, writer);
    }
    const buffer = new BufferReader(writer.getBuffer());
    return decodeClientMessages(buffer);
  }

  test("connectUser", () => {
    const msg: DeltaNetV01ClientMessage = {
      type: "connectUser",
      token: "test-token",
      observer: false,
      components: [[0, 100n]],
      states: [[1, new Uint8Array([10, 20])]],
    };
    const result = roundTrip([msg]);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("connectUser");
    if (result[0].type === "connectUser") {
      expect(result[0].token).toBe("test-token");
      expect(result[0].observer).toBe(false);
      expect(result[0].components).toEqual([[0, 100n]]);
    }
  });

  test("setUserComponents", () => {
    const msg: DeltaNetV01ClientMessage = {
      type: "setUserComponents",
      components: [
        [0, 42n],
        [1, -7n],
      ],
      states: [[0, new Uint8Array([1, 2, 3])]],
    };
    const result = roundTrip([msg]);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("setUserComponents");
    if (result[0].type === "setUserComponents") {
      expect(result[0].components).toEqual([
        [0, 42n],
        [1, -7n],
      ]);
    }
  });

  test("pong", () => {
    const msg: DeltaNetV01ClientMessage = { type: "pong", pong: 12345 };
    const result = roundTrip([msg]);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ type: "pong", pong: 12345 });
  });

  test("clientCustom", () => {
    const msg: DeltaNetV01ClientMessage = {
      type: "clientCustom",
      customType: 7,
      contents: "hello world",
    };
    const result = roundTrip([msg]);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ type: "clientCustom", customType: 7, contents: "hello world" });
  });

  test("multiple messages in one buffer", () => {
    const messages: DeltaNetV01ClientMessage[] = [
      { type: "pong", pong: 1 },
      { type: "clientCustom", customType: 0, contents: "test" },
      { type: "pong", pong: 2 },
    ];
    const result = roundTrip(messages);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ type: "pong", pong: 1 });
    expect(result[1]).toEqual({ type: "clientCustom", customType: 0, contents: "test" });
    expect(result[2]).toEqual({ type: "pong", pong: 2 });
  });

  test("unknown message type throws", () => {
    expect(() => {
      encodeClientMessage({ type: "unknown" } as any, new BufferWriter(16));
    }).toThrow("Unknown message type: unknown");
  });

  test("decodeClientMessages throws on unknown type byte", () => {
    const buffer = new BufferReader(new Uint8Array([0xff]));
    expect(() => decodeClientMessages(buffer)).toThrow("Unknown message type: 255");
  });

  test("decodeClientMessages returns empty for empty buffer", () => {
    const buffer = new BufferReader(new Uint8Array(0));
    expect(decodeClientMessages(buffer)).toEqual([]);
  });
});
