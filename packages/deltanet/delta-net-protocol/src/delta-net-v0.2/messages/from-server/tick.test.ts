import { BufferReader } from "../../../BufferReader";
import { BufferWriter } from "../../../BufferWriter";
import type { DecodeDebugData } from "../../../decodeOptions";
import type { DeltaNetV01Tick as DeltaNetTick } from "../../../delta-net-v0.1";
import { TickMessageType } from "../../../delta-net-v0.1";
import { MAX_CONTIGUOUS_ELEMENTS } from "../../constants";

import { decodeTickV02, encodeTickV02 } from "./tick";

const cases: Array<[string, DeltaNetTick]> = [
  [
    "empty",
    {
      type: "tick",
      serverTime: 0,
      removedIndices: [],
      indicesCount: 0,
      componentDeltaDeltas: [],
      states: [],
    },
  ],
  [
    "with contents",
    {
      type: "tick",
      serverTime: 123,
      removedIndices: [1, 2, 3],
      indicesCount: 5,
      componentDeltaDeltas: [
        { componentId: 1, deltaDeltas: new BigInt64Array([1n, 2n, 3n, 4n, 5n]) },
        { componentId: 2, deltaDeltas: new BigInt64Array([4n, 5n, 6n, 7n, 8n]) },
        { componentId: 3, deltaDeltas: new BigInt64Array([7n, 8n, 9n, 10n, 11n]) },
      ],
      states: [
        {
          stateId: 1,
          updatedStates: [
            [1, new Uint8Array([118, 97, 108, 117, 101, 49])], // "value1"
            [2, new Uint8Array([118, 97, 108, 117, 101, 50])], // "value2"
          ],
        },
        {
          stateId: 2,
          updatedStates: [
            [3, new Uint8Array([118, 97, 108, 117, 101, 51])], // "value3"
            [4, new Uint8Array([118, 97, 108, 117, 101, 52])], // "value4"
          ],
        },
      ],
    },
  ],
  [
    "single component single user",
    {
      type: "tick",
      serverTime: 42,
      removedIndices: [],
      indicesCount: 1,
      componentDeltaDeltas: [{ componentId: 0, deltaDeltas: new BigInt64Array([100n]) }],
      states: [],
    },
  ],
  [
    "many components few users",
    {
      type: "tick",
      serverTime: 500,
      removedIndices: [],
      indicesCount: 2,
      componentDeltaDeltas: Array.from({ length: 10 }, (_, i) => ({
        componentId: i,
        deltaDeltas: new BigInt64Array([BigInt(i * 2), BigInt(i * 2 + 1)]),
      })),
      states: [],
    },
  ],
  [
    "negative delta-deltas",
    {
      type: "tick",
      serverTime: 99,
      removedIndices: [],
      indicesCount: 3,
      componentDeltaDeltas: [
        { componentId: 1, deltaDeltas: new BigInt64Array([-100n, 0n, 50n]) },
        { componentId: 2, deltaDeltas: new BigInt64Array([-1n, -9999999n, 9999999n]) },
      ],
      states: [],
    },
  ],
  [
    "components with zero indicesCount",
    {
      type: "tick",
      serverTime: 10,
      removedIndices: [],
      indicesCount: 0,
      componentDeltaDeltas: [
        { componentId: 1, deltaDeltas: new BigInt64Array(0) },
        { componentId: 2, deltaDeltas: new BigInt64Array(0) },
      ],
      states: [],
    },
  ],
];

describe("encode/decode tick v0.2", () => {
  test.each(cases)("%p", (name, message) => {
    const writer = new BufferWriter(16);
    encodeTickV02(message, writer);
    const encoded = writer.getBuffer();
    const reader = new BufferReader(encoded);
    expect(reader.readUInt8()).toEqual(TickMessageType);
    const decoded = decodeTickV02(reader);
    expect(decoded).toEqual(message);
  });

  test("ignoreData returns zero-filled arrays and does not desync the buffer", () => {
    const message: DeltaNetTick = {
      type: "tick",
      serverTime: 123,
      removedIndices: [],
      indicesCount: 3,
      componentDeltaDeltas: [
        { componentId: 1, deltaDeltas: new BigInt64Array([10n, 20n, 30n]) },
        { componentId: 2, deltaDeltas: new BigInt64Array([40n, 50n, 60n]) },
      ],
      states: [
        {
          stateId: 1,
          updatedStates: [
            [0, new Uint8Array([1, 2, 3])],
            [2, new Uint8Array([4, 5])],
          ],
        },
      ],
    };

    const writer = new BufferWriter(16);
    encodeTickV02(message, writer);
    const encoded = writer.getBuffer();

    const reader = new BufferReader(encoded);
    reader.readUInt8(); // skip message type
    const decoded = decodeTickV02(reader, { ignoreData: true });

    // Buffer should be fully consumed
    expect(reader.isEnd()).toBe(true);

    // Components should have correct structure but zero-filled data
    expect(decoded.componentDeltaDeltas.length).toBe(2);
    expect(decoded.componentDeltaDeltas[0].componentId).toBe(1);
    expect(decoded.componentDeltaDeltas[0].deltaDeltas).toEqual(new BigInt64Array(3));
    expect(decoded.componentDeltaDeltas[1].componentId).toBe(2);
    expect(decoded.componentDeltaDeltas[1].deltaDeltas).toEqual(new BigInt64Array(3));

    // States should have empty updatedStates when ignoreData is true
    expect(decoded.states.length).toBe(1);
    expect(decoded.states[0].stateId).toBe(1);
    expect(decoded.states[0].updatedStates).toEqual([]);

    // Metadata should still be correct
    expect(decoded.serverTime).toBe(123);
    expect(decoded.indicesCount).toBe(3);
  });

  test("debugData reports correct byte lengths", () => {
    const message: DeltaNetTick = {
      type: "tick",
      serverTime: 100,
      removedIndices: [],
      indicesCount: 3,
      componentDeltaDeltas: [{ componentId: 1, deltaDeltas: new BigInt64Array([1n, 2n, 3n]) }],
      states: [
        {
          stateId: 1,
          updatedStates: [
            [0, new Uint8Array([10, 20])],
            [1, new Uint8Array([30])],
          ],
        },
      ],
    };

    const writer = new BufferWriter(16);
    encodeTickV02(message, writer);
    const encoded = writer.getBuffer();

    const debugData: DecodeDebugData = { componentsByteLength: 0, statesByteLength: 0 };
    const reader = new BufferReader(encoded);
    reader.readUInt8(); // skip message type
    decodeTickV02(reader, { debugData });

    expect(debugData.componentsByteLength).toBeGreaterThan(0);
    expect(debugData.statesByteLength).toBeGreaterThan(0);
  });

  test("throws on decode when totalLength exceeds MAX_CONTIGUOUS_ELEMENTS", () => {
    // Craft a buffer that claims componentsLength * indicesCount > MAX.
    // We don't need to actually allocate the arrays — the guard fires
    // before decompression. Use 2 components × (MAX/2 + 1) indices.
    const writer = new BufferWriter(64);
    writer.writeUint8(TickMessageType);
    writer.writeUVarint(1); // serverTime
    writer.writeUVarint(0); // removedIndices length
    const indicesCount = Math.floor(MAX_CONTIGUOUS_ELEMENTS / 2) + 1;
    writer.writeUVarint(indicesCount); // indicesCount
    writer.writeUVarint(2); // componentsLength = 2
    writer.writeUVarint(0); // componentId 0
    writer.writeUVarint(1); // componentId 1
    // Write a dummy compressed block (never reached due to the guard)
    writer.writeUVarintLengthPrefixedBytes(new Uint8Array([0]));

    const reader = new BufferReader(writer.getBuffer());
    reader.readUInt8(); // skip message type

    expect(() => {
      decodeTickV02(reader);
    }).toThrow(/exceeds maximum/);
  });

  test("debugData accumulates across multiple calls", () => {
    const message: DeltaNetTick = {
      type: "tick",
      serverTime: 100,
      removedIndices: [],
      indicesCount: 2,
      componentDeltaDeltas: [{ componentId: 1, deltaDeltas: new BigInt64Array([1n, 2n]) }],
      states: [],
    };

    const writer = new BufferWriter(16);
    encodeTickV02(message, writer);
    const encoded = writer.getBuffer();

    const debugData: DecodeDebugData = { componentsByteLength: 0, statesByteLength: 0 };

    // Decode twice with the same debugData to verify accumulation
    const reader1 = new BufferReader(encoded);
    reader1.readUInt8();
    decodeTickV02(reader1, { debugData });
    const firstCallBytes = debugData.componentsByteLength;

    const reader2 = new BufferReader(encoded);
    reader2.readUInt8();
    decodeTickV02(reader2, { debugData });

    expect(debugData.componentsByteLength).toBe(firstCallBytes * 2);
  });
});
