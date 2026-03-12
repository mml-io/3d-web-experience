import { BufferReader } from "../BufferReader";
import { BufferWriter } from "../BufferWriter";

import { decodeServerMessages } from "./decodeServerMessages";
import { encodeServerMessage } from "./encodeServerMessage";
import type { DeltaNetV01ServerMessage } from "./messages";

describe("encodeServerMessage + decodeServerMessages round-trip", () => {
  function roundTrip(messages: DeltaNetV01ServerMessage[]): DeltaNetV01ServerMessage[] {
    const writer = new BufferWriter(256);
    for (const msg of messages) {
      const msgWriter = encodeServerMessage(msg, writer);
      // encodeServerMessage returns the writer, verify it's the same one
      expect(msgWriter).toBe(writer);
    }
    const buffer = new BufferReader(writer.getBuffer());
    return decodeServerMessages(buffer);
  }

  test("ping", () => {
    const msg: DeltaNetV01ServerMessage = { type: "ping", ping: 42 };
    const result = roundTrip([msg]);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ type: "ping", ping: 42 });
  });

  test("warning", () => {
    const msg: DeltaNetV01ServerMessage = { type: "warning", message: "slow down" };
    const result = roundTrip([msg]);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ type: "warning", message: "slow down" });
  });

  test("error", () => {
    const msg: DeltaNetV01ServerMessage = {
      type: "error",
      errorType: "USER_AUTHENTICATION_FAILED",
      message: "bad token",
      retryable: false,
    };
    const result = roundTrip([msg]);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(msg);
  });

  test("userIndex", () => {
    const msg: DeltaNetV01ServerMessage = { type: "userIndex", index: 7 };
    const result = roundTrip([msg]);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ type: "userIndex", index: 7 });
  });

  test("serverCustom", () => {
    const msg: DeltaNetV01ServerMessage = {
      type: "serverCustom",
      customType: 3,
      contents: "custom data",
    };
    const result = roundTrip([msg]);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(msg);
  });

  test("initialCheckout with components", () => {
    const msg: DeltaNetV01ServerMessage = {
      type: "initialCheckout",
      serverTime: 1000,
      indicesCount: 2,
      components: [
        {
          componentId: 0,
          deltas: new BigInt64Array([0n, 0n]),
          values: new BigInt64Array([100n, 200n]),
        },
      ],
      states: [],
    };
    const result = roundTrip([msg]);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("initialCheckout");
    if (result[0].type === "initialCheckout") {
      expect(result[0].serverTime).toBe(1000);
      expect(result[0].indicesCount).toBe(2);
      expect(result[0].components).toHaveLength(1);
      expect(result[0].components[0].componentId).toBe(0);
    }
  });

  test("tick with updates", () => {
    const msg: DeltaNetV01ServerMessage = {
      type: "tick",
      serverTime: 2000,
      removedIndices: [],
      indicesCount: 1,
      componentDeltaDeltas: [
        {
          componentId: 0,
          deltaDeltas: new BigInt64Array([5n]),
        },
      ],
      states: [],
    };
    const result = roundTrip([msg]);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("tick");
    if (result[0].type === "tick") {
      expect(result[0].serverTime).toBe(2000);
    }
  });

  test("multiple messages in one buffer", () => {
    const messages: DeltaNetV01ServerMessage[] = [
      { type: "ping", ping: 1 },
      { type: "warning", message: "test" },
      { type: "userIndex", index: 5 },
    ];
    const result = roundTrip(messages);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ type: "ping", ping: 1 });
    expect(result[1]).toEqual({ type: "warning", message: "test" });
    expect(result[2]).toEqual({ type: "userIndex", index: 5 });
  });

  test("encodeServerMessage without writer creates one", () => {
    const msg: DeltaNetV01ServerMessage = { type: "ping", ping: 99 };
    const writer = encodeServerMessage(msg);
    expect(writer).toBeInstanceOf(BufferWriter);
    const buffer = new BufferReader(writer.getBuffer());
    const result = decodeServerMessages(buffer);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ type: "ping", ping: 99 });
  });

  test("encodeServerMessage throws on unknown type", () => {
    expect(() => {
      encodeServerMessage({ type: "bogus" } as any);
    }).toThrow("Unknown message type: bogus");
  });

  test("decodeServerMessages decodes all known server message types", () => {
    // Build a buffer containing one of each simple server message type
    const writer = new BufferWriter(512);
    encodeServerMessage({ type: "ping", ping: 10 }, writer);
    encodeServerMessage({ type: "userIndex", index: 3 }, writer);
    encodeServerMessage({ type: "serverCustom", customType: 1, contents: "hi" }, writer);
    encodeServerMessage({ type: "warning", message: "warn" }, writer);
    encodeServerMessage(
      {
        type: "error",
        errorType: "SERVER_SHUTDOWN",
        message: "bye",
        retryable: true,
      },
      writer,
    );

    const buffer = new BufferReader(writer.getBuffer());
    const result = decodeServerMessages(buffer);
    expect(result).toHaveLength(5);
    expect(result[0].type).toBe("ping");
    expect(result[1].type).toBe("userIndex");
    expect(result[2].type).toBe("serverCustom");
    expect(result[3].type).toBe("warning");
    expect(result[4].type).toBe("error");
  });
});
