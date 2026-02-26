import { BufferReader } from "../BufferReader";

import { decodeServerMessagesV02 } from "./decodeServerMessages";

describe("decodeServerMessagesV02", () => {
  test("throws on unknown message type", () => {
    // Use a byte value that doesn't correspond to any known message type
    const unknownType = 0xff;
    const buffer = new BufferReader(new Uint8Array([unknownType]));
    expect(() => decodeServerMessagesV02(buffer)).toThrow(`Unknown message type: ${unknownType}`);
  });

  test("returns empty array for empty buffer", () => {
    const buffer = new BufferReader(new Uint8Array(0));
    expect(decodeServerMessagesV02(buffer)).toEqual([]);
  });
});
