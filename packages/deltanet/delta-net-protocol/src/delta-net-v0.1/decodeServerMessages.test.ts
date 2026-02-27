import { BufferReader } from "../BufferReader";

import { decodeServerMessages } from "./decodeServerMessages";

describe("decodeServerMessages", () => {
  test("throws on unknown message type", () => {
    const unknownType = 0xff;
    const buffer = new BufferReader(new Uint8Array([unknownType]));
    expect(() => decodeServerMessages(buffer)).toThrow(`Unknown message type: ${unknownType}`);
  });

  test("returns empty array for empty buffer", () => {
    const buffer = new BufferReader(new Uint8Array(0));
    expect(decodeServerMessages(buffer)).toEqual([]);
  });
});
