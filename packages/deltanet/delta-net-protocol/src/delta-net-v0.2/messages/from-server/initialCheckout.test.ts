import { BufferReader } from "../../../BufferReader";
import { BufferWriter } from "../../../BufferWriter";
import type { DecodeDebugData } from "../../../decodeOptions";
import type { DeltaNetV01InitialCheckoutMessage as DeltaNetInitialCheckoutMessage } from "../../../delta-net-v0.1";
import { InitialCheckoutMessageType } from "../../../delta-net-v0.1";
import { MAX_CONTIGUOUS_ELEMENTS } from "../../constants";

import { decodeInitialCheckoutV02, encodeInitialCheckoutV02 } from "./initialCheckout";

const cases: Array<[string, DeltaNetInitialCheckoutMessage]> = [
  [
    "basic",
    {
      type: "initialCheckout",
      serverTime: 0,
      indicesCount: 3,
      components: [
        {
          componentId: 1,
          values: new BigInt64Array([1n, 2n, 3n]),
          deltas: new BigInt64Array([11n, 22n, 33n]),
        },
        {
          componentId: 2,
          values: new BigInt64Array([4n, 5n, 6n]),
          deltas: new BigInt64Array([14n, 25n, 36n]),
        },
      ],
      states: [
        { stateId: 1, values: [new Uint8Array([7]), new Uint8Array([8]), new Uint8Array([9])] },
        { stateId: 2, values: [new Uint8Array([10]), new Uint8Array([11]), new Uint8Array([12])] },
      ],
    },
  ],
  [
    "empty",
    {
      type: "initialCheckout",
      serverTime: 0,
      indicesCount: 0,
      components: [],
      states: [],
    },
  ],
  [
    "single component single user",
    {
      type: "initialCheckout",
      serverTime: 42,
      indicesCount: 1,
      components: [
        {
          componentId: 0,
          values: new BigInt64Array([100n]),
          deltas: new BigInt64Array([50n]),
        },
      ],
      states: [],
    },
  ],
  [
    "many components",
    {
      type: "initialCheckout",
      serverTime: 100,
      indicesCount: 3,
      components: Array.from({ length: 10 }, (_, i) => ({
        componentId: i,
        values: new BigInt64Array([BigInt(i * 10), BigInt(i * 10 + 1), BigInt(i * 10 + 2)]),
        deltas: new BigInt64Array([BigInt(i * 5), BigInt(i * 5 + 1), BigInt(i * 5 + 2)]),
      })),
      states: [],
    },
  ],
  [
    "negative values",
    {
      type: "initialCheckout",
      serverTime: 55,
      indicesCount: 3,
      components: [
        {
          componentId: 1,
          values: new BigInt64Array([-100n, 0n, 200n]),
          deltas: new BigInt64Array([-50n, -9999999n, 9999999n]),
        },
      ],
      states: [],
    },
  ],
  [
    "components with zero indicesCount",
    {
      type: "initialCheckout",
      serverTime: 10,
      indicesCount: 0,
      components: [
        {
          componentId: 1,
          values: new BigInt64Array(0),
          deltas: new BigInt64Array(0),
        },
        {
          componentId: 2,
          values: new BigInt64Array(0),
          deltas: new BigInt64Array(0),
        },
      ],
      states: [],
    },
  ],
];

describe("encode/decode initialCheckout v0.2", () => {
  test.each(cases)("%p", (name, message) => {
    const writer = new BufferWriter(16);
    encodeInitialCheckoutV02(message, writer);
    const encoded = writer.getBuffer();
    const reader = new BufferReader(encoded);
    expect(reader.readUInt8()).toEqual(InitialCheckoutMessageType);
    const decoded = decodeInitialCheckoutV02(reader);
    expect(decoded).toEqual(message);
  });

  test("ignoreData returns zero-filled arrays and does not desync the buffer", () => {
    const message: DeltaNetInitialCheckoutMessage = {
      type: "initialCheckout",
      serverTime: 42,
      indicesCount: 3,
      components: [
        {
          componentId: 1,
          values: new BigInt64Array([10n, 20n, 30n]),
          deltas: new BigInt64Array([1n, 2n, 3n]),
        },
        {
          componentId: 2,
          values: new BigInt64Array([40n, 50n, 60n]),
          deltas: new BigInt64Array([4n, 5n, 6n]),
        },
      ],
      states: [
        {
          stateId: 1,
          values: [new Uint8Array([7]), new Uint8Array([8]), new Uint8Array([9])],
        },
      ],
    };

    const writer = new BufferWriter(16);
    encodeInitialCheckoutV02(message, writer);
    const encoded = writer.getBuffer();

    const reader = new BufferReader(encoded);
    reader.readUInt8(); // skip message type
    const decoded = decodeInitialCheckoutV02(reader, { ignoreData: true });

    // Buffer should be fully consumed
    expect(reader.isEnd()).toBe(true);

    // Components should have correct structure but zero-filled data
    expect(decoded.components.length).toBe(2);
    expect(decoded.components[0].componentId).toBe(1);
    expect(decoded.components[0].values).toEqual(new BigInt64Array(3));
    expect(decoded.components[0].deltas).toEqual(new BigInt64Array(3));
    expect(decoded.components[1].componentId).toBe(2);
    expect(decoded.components[1].values).toEqual(new BigInt64Array(3));
    expect(decoded.components[1].deltas).toEqual(new BigInt64Array(3));

    // States should have empty Uint8Arrays
    expect(decoded.states.length).toBe(1);
    expect(decoded.states[0].stateId).toBe(1);
    expect(decoded.states[0].values.length).toBe(3);
    for (const v of decoded.states[0].values) {
      expect(v).toEqual(new Uint8Array(0));
    }

    // Metadata should still be correct
    expect(decoded.serverTime).toBe(42);
    expect(decoded.indicesCount).toBe(3);
  });

  test("throws on decode when totalLength exceeds MAX_CONTIGUOUS_ELEMENTS", () => {
    // Craft a buffer that claims componentsLength * indicesCount > MAX.
    // We don't need to actually allocate the arrays — the guard fires
    // before decompression. Use 2 components × (MAX/2 + 1) indices.
    const writer = new BufferWriter(64);
    writer.writeUint8(InitialCheckoutMessageType);
    writer.writeUVarint(1); // serverTime
    const indicesCount = Math.floor(MAX_CONTIGUOUS_ELEMENTS / 2) + 1;
    writer.writeUVarint(indicesCount); // indicesCount
    writer.writeUVarint(2); // componentsLength = 2
    writer.writeUVarint(0); // componentId 0
    writer.writeUVarint(1); // componentId 1
    // Write dummy compressed blocks (never reached due to the guard)
    writer.writeUVarintLengthPrefixedBytes(new Uint8Array([0]));
    writer.writeUVarintLengthPrefixedBytes(new Uint8Array([0]));

    const reader = new BufferReader(writer.getBuffer());
    reader.readUInt8(); // skip message type

    expect(() => {
      decodeInitialCheckoutV02(reader);
    }).toThrow(/exceeds maximum/);
  });

  test("debugData reports correct byte lengths", () => {
    const message: DeltaNetInitialCheckoutMessage = {
      type: "initialCheckout",
      serverTime: 0,
      indicesCount: 3,
      components: [
        {
          componentId: 1,
          values: new BigInt64Array([1n, 2n, 3n]),
          deltas: new BigInt64Array([11n, 22n, 33n]),
        },
      ],
      states: [
        {
          stateId: 1,
          values: [new Uint8Array([7]), new Uint8Array([8]), new Uint8Array([9])],
        },
      ],
    };

    const writer = new BufferWriter(16);
    encodeInitialCheckoutV02(message, writer);
    const encoded = writer.getBuffer();

    const debugData: DecodeDebugData = { componentsByteLength: 0, statesByteLength: 0 };
    const reader = new BufferReader(encoded);
    reader.readUInt8(); // skip message type
    decodeInitialCheckoutV02(reader, { debugData });

    expect(debugData.componentsByteLength).toBeGreaterThan(0);
    expect(debugData.statesByteLength).toBeGreaterThan(0);
  });

  test("debugData accumulates across multiple calls", () => {
    const message: DeltaNetInitialCheckoutMessage = {
      type: "initialCheckout",
      serverTime: 0,
      indicesCount: 2,
      components: [
        {
          componentId: 1,
          values: new BigInt64Array([1n, 2n]),
          deltas: new BigInt64Array([3n, 4n]),
        },
      ],
      states: [],
    };

    const writer = new BufferWriter(16);
    encodeInitialCheckoutV02(message, writer);
    const encoded = writer.getBuffer();

    const debugData: DecodeDebugData = { componentsByteLength: 0, statesByteLength: 0 };

    // Decode twice with the same debugData to verify accumulation
    const reader1 = new BufferReader(encoded);
    reader1.readUInt8();
    decodeInitialCheckoutV02(reader1, { debugData });
    const firstCallBytes = debugData.componentsByteLength;

    const reader2 = new BufferReader(encoded);
    reader2.readUInt8();
    decodeInitialCheckoutV02(reader2, { debugData });

    expect(debugData.componentsByteLength).toBe(firstCallBytes * 2);
  });
});
