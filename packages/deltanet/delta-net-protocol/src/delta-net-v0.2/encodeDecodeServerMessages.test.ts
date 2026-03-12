import { BufferReader } from "../BufferReader";
import { BufferWriter } from "../BufferWriter";

import { decodeServerMessagesV02 } from "./decodeServerMessages";
import { encodeServerMessageV02 } from "./encodeServerMessage";

describe("v0.2 encodeServerMessageV02 + decodeServerMessagesV02 round-trip", () => {
  test("ping round-trip", () => {
    const writer = encodeServerMessageV02({ type: "ping", ping: 42 });
    const result = decodeServerMessagesV02(new BufferReader(writer.getBuffer()));
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ type: "ping", ping: 42 });
  });

  test("warning round-trip", () => {
    const writer = encodeServerMessageV02({ type: "warning", message: "caution" });
    const result = decodeServerMessagesV02(new BufferReader(writer.getBuffer()));
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ type: "warning", message: "caution" });
  });

  test("error round-trip", () => {
    const msg = {
      type: "error" as const,
      errorType: "USER_AUTHENTICATION_FAILED",
      message: "denied",
      retryable: false,
    };
    const writer = encodeServerMessageV02(msg);
    const result = decodeServerMessagesV02(new BufferReader(writer.getBuffer()));
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(msg);
  });

  test("userIndex round-trip", () => {
    const writer = encodeServerMessageV02({ type: "userIndex", index: 99 });
    const result = decodeServerMessagesV02(new BufferReader(writer.getBuffer()));
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ type: "userIndex", index: 99 });
  });

  test("serverCustom round-trip", () => {
    const msg = { type: "serverCustom" as const, customType: 5, contents: "payload" };
    const writer = encodeServerMessageV02(msg);
    const result = decodeServerMessagesV02(new BufferReader(writer.getBuffer()));
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(msg);
  });

  test("initialCheckout round-trip", () => {
    const msg = {
      type: "initialCheckout" as const,
      serverTime: 500,
      indicesCount: 1,
      components: [
        {
          componentId: 0,
          deltas: new BigInt64Array([0n]),
          values: new BigInt64Array([50n]),
        },
      ],
      states: [],
    };
    const writer = encodeServerMessageV02(msg);
    const result = decodeServerMessagesV02(new BufferReader(writer.getBuffer()));
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("initialCheckout");
  });

  test("tick round-trip", () => {
    const msg = {
      type: "tick" as const,
      serverTime: 1000,
      removedIndices: [],
      indicesCount: 1,
      componentDeltaDeltas: [
        {
          componentId: 0,
          deltaDeltas: new BigInt64Array([10n]),
        },
      ],
      states: [],
    };
    const writer = encodeServerMessageV02(msg);
    const result = decodeServerMessagesV02(new BufferReader(writer.getBuffer()));
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("tick");
  });

  test("multiple messages in one buffer", () => {
    const writer = new BufferWriter(256);
    encodeServerMessageV02({ type: "ping", ping: 1 }, writer);
    encodeServerMessageV02({ type: "userIndex", index: 2 }, writer);
    encodeServerMessageV02({ type: "warning", message: "w" }, writer);
    const result = decodeServerMessagesV02(new BufferReader(writer.getBuffer()));
    expect(result).toHaveLength(3);
    expect(result[0].type).toBe("ping");
    expect(result[1].type).toBe("userIndex");
    expect(result[2].type).toBe("warning");
  });

  test("encodeServerMessageV02 throws on unknown type", () => {
    expect(() => {
      encodeServerMessageV02({ type: "bogus" } as any);
    }).toThrow("Unknown message type: bogus");
  });
});
