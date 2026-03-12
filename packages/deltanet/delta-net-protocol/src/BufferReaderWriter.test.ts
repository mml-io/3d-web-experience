import { BufferReader } from "./BufferReader";
import { BufferWriter, zigzagEncode } from "./BufferWriter";

describe("BufferReader and BufferWriter", () => {
  describe("basic operations", () => {
    it("should read uint8 values correctly", () => {
      const buffer = new Uint8Array([42, 255, 0, 127]);
      const reader = new BufferReader(buffer);

      expect(reader.readUInt8()).toBe(42);
      expect(reader.readUInt8()).toBe(255);
      expect(reader.readUInt8()).toBe(0);
      expect(reader.readUInt8()).toBe(127);
    });

    it("should read boolean values correctly", () => {
      const buffer = new Uint8Array([1, 0, 1, 0]);
      const reader = new BufferReader(buffer);

      expect(reader.readBoolean()).toBe(true);
      expect(reader.readBoolean()).toBe(false);
      expect(reader.readBoolean()).toBe(true);
      expect(reader.readBoolean()).toBe(false);
    });

    it("should read bytes correctly", () => {
      const buffer = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
      const reader = new BufferReader(buffer);

      const firstPart = reader.readBytes(3);
      expect([...firstPart]).toEqual([1, 2, 3]);

      const secondPart = reader.readBytes(2);
      expect([...secondPart]).toEqual([4, 5]);

      const thirdPart = reader.readBytes(3);
      expect([...thirdPart]).toEqual([6, 7, 8]);
    });

    it("should detect end of buffer", () => {
      const buffer = new Uint8Array([1, 2, 3]);
      const reader = new BufferReader(buffer);

      expect(reader.isEnd()).toBe(false);
      reader.readBytes(3);
      expect(reader.isEnd()).toBe(true);
    });
  });

  describe("varint operations", () => {
    it("should read unsigned varints correctly", () => {
      // Create a buffer with various sizes of varints
      const writer = new BufferWriter(100);
      const values = [0, 1, 127, 128, 16383, 16384, 2097151, 2097152, 268435455];
      for (const value of values) {
        writer.writeUVarint(value);
      }

      const buffer = writer.getBuffer();
      const reader = new BufferReader(buffer);

      for (const expected of values) {
        expect(reader.readUVarint()).toBe(expected);
      }
    });

    it("should read very large unsigned varints", () => {
      const writer = new BufferWriter(100);
      const values = [
        Math.pow(2, 31) - 1, // Max 32-bit signed int
        Math.pow(2, 31), // First value that requires 32-bit unsigned
        Math.pow(2, 32) - 1, // Max 32-bit unsigned int
        Math.pow(2, 32), // First value needing more than 32 bits
        Math.pow(2, 53) - 1, // Largest precise integer in JavaScript
      ];

      for (const value of values) {
        writer.writeUVarint(value);
      }

      const buffer = writer.getBuffer();
      const reader = new BufferReader(buffer);

      for (const expected of values) {
        expect(reader.readUVarint()).toBe(expected);
      }
    });

    it("should read signed varints correctly", () => {
      const writer = new BufferWriter(50);
      const values = [
        0,
        1,
        -1,
        63,
        -64,
        8191,
        -8192,
        1048575,
        -1048576,
        Math.pow(2, 31) - 1, // Max 32-bit signed int
        Math.pow(2, 31), // First value that requires 32-bit unsigned
        Math.pow(2, 32) - 1, // Max 32-bit unsigned int
        Math.pow(2, 32), // First value needing more than 32 bits
        Math.pow(2, 53) - 1, // Largest precise integer in JavaScript
      ];

      for (const value of values) {
        writer.writeVarint(value);
      }

      const buffer = writer.getBuffer();
      const reader = new BufferReader(buffer);

      for (const expected of values) {
        expect(reader.readVarint()).toBe(expected);
      }
    });

    it("should correctly convert between signed and unsigned", () => {
      // Test the special-case signed varint encoding where odd numbers are negative
      const writer = new BufferWriter(20);
      const pairs = [
        [0, 0], // Value 0 encoded as 0
        [1, 2], // Value 1 encoded as 2
        [-1, 1], // Value -1 encoded as 1
        [10, 20], // Value 10 encoded as 20
        [-10, 19], // Value -10 encoded as 19
      ];

      // Write using the public API
      for (const [value] of pairs) {
        writer.writeVarint(value);
      }

      const buffer = writer.getBuffer();
      const reader = new BufferReader(buffer);

      for (const [expected] of pairs) {
        expect(reader.readVarint()).toBe(expected);
      }
    });

    it("should read unsigned bigint varints correctly", () => {
      const writer = new BufferWriter(100);
      const values = [
        0n,
        1n,
        127n,
        128n,
        16383n,
        16384n,
        2097151n,
        2097152n,
        268435455n,
        2n ** 31n - 1n, // Max 32-bit signed int
        2n ** 31n, // First value that requires 32-bit unsigned
        2n ** 32n - 1n, // Max 32-bit unsigned int
        2n ** 32n, // First value needing more than 32 bits
        2n ** 53n - 1n, // Largest precise integer in JavaScript
        2n ** 63n - 1n, // Max 64-bit signed int
      ];

      for (const value of values) {
        writer.writeUVarintBigInt(value);
      }

      const buffer = writer.getBuffer();
      const reader = new BufferReader(buffer);

      for (const expected of values) {
        expect(reader.readUVarintBigInt()).toBe(expected);
      }
    });

    it("should read signed bigint varints correctly", () => {
      const writer = new BufferWriter(100);
      const values = [
        0n,
        1n,
        -1n,
        63n,
        -64n,
        8191n,
        -8192n,
        1048575n,
        -1048576n,
        2n ** 31n - 1n, // Max 32-bit signed int
        2n ** 31n, // First value that requires 32-bit unsigned
        2n ** 32n - 1n, // Max 32-bit unsigned int
        2n ** 32n, // First value needing more than 32 bits
        2n ** 53n - 1n, // Largest precise integer in JavaScript
        2n ** 63n - 1n, // Max 64-bit signed int
        -(2n ** 63n), // Min 64-bit signed int
      ];

      for (const value of values) {
        writer.writeBigIntVarint(value);
      }

      const buffer = writer.getBuffer();
      const reader = new BufferReader(buffer);

      for (const expected of values) {
        expect(reader.readBigIntVarint()).toBe(expected);
      }
    });

    it("should correctly convert between signed and unsigned bigints", () => {
      const writer = new BufferWriter(20);
      const pairs = [
        [0n, 0n], // Value 0 encoded as 0
        [1n, 2n], // Value 1 encoded as 2
        [-1n, 1n], // Value -1 encoded as 1
        [10n, 20n], // Value 10 encoded as 20
        [-10n, 19n], // Value -10 encoded as 19
        [2n ** 63n - 1n, 2n ** 64n - 2n], // Max 64-bit signed int
        [-(2n ** 63n), 2n ** 64n - 1n], // Min 64-bit signed int
      ];

      // Write using the public API
      for (const [value] of pairs) {
        writer.writeBigIntVarint(value);
      }

      const buffer = writer.getBuffer();
      const reader = new BufferReader(buffer);

      for (const [expected] of pairs) {
        expect(reader.readBigIntVarint()).toBe(expected);
      }
    });

    it("should throw error for invalid bigint varint encoding", () => {
      // Create a buffer with an invalid varint (all bytes have continuation bit set)
      const invalidBuffer = new Uint8Array([
        0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80,
      ]);
      const reader = new BufferReader(invalidBuffer);

      expect(() => {
        reader.readUVarintBigInt();
      }).toThrow("invalid varint encoding");
    });

    it("should have consistent encoding between number and bigint for unsigned values", () => {
      const testValues = [
        0,
        1,
        127,
        128,
        16383,
        16384,
        2097151,
        2097152,
        268435455,
        Number.MAX_SAFE_INTEGER,
      ];

      for (const value of testValues) {
        // Write using number version
        const writer1 = new BufferWriter(20);
        writer1.writeUVarint(value);
        const buffer1 = writer1.getBuffer();

        // Write using bigint version
        const writer2 = new BufferWriter(20);
        writer2.writeUVarintBigInt(BigInt(value));
        const buffer2 = writer2.getBuffer();

        // Buffers should be identical
        expect(buffer1).toEqual(buffer2);

        // Read back using both methods
        const reader1 = new BufferReader(buffer1);
        const reader2 = new BufferReader(buffer2);

        expect(reader1.readUVarint()).toBe(value);
        expect(Number(reader2.readUVarintBigInt())).toBe(value);
      }
    });

    it("should have consistent encoding between number and bigint for signed values", () => {
      const testValues = [
        0,
        1,
        -1,
        63,
        -64,
        8191,
        -8192,
        1048575,
        -1048576,
        2147483647, // Max 32-bit signed int
        -2147483648, // Min 32-bit signed int
      ];

      for (const value of testValues) {
        // Write using number version
        const writer1 = new BufferWriter(20);
        writer1.writeVarint(value);
        const buffer1 = writer1.getBuffer();

        // Write using bigint version
        const writer2 = new BufferWriter(20);
        writer2.writeBigIntVarint(BigInt(value));
        const buffer2 = writer2.getBuffer();

        // Buffers should be identical
        expect(buffer1).toEqual(buffer2);

        // Read back using both methods
        const reader1 = new BufferReader(buffer1);
        const reader2 = new BufferReader(buffer2);

        expect(reader1.readVarint()).toBe(value);
        expect(Number(reader2.readBigIntVarint())).toBe(value);
      }
    });

    it("should handle edge cases around Number.MAX_SAFE_INTEGER", () => {
      const testValues = [
        Number.MAX_SAFE_INTEGER - 1,
        Number.MAX_SAFE_INTEGER,
        Number.MIN_SAFE_INTEGER + 1,
        Number.MIN_SAFE_INTEGER,
      ];

      for (const value of testValues) {
        // Write using bigint version
        const writer = new BufferWriter(20);
        writer.writeBigIntVarint(BigInt(value));
        const buffer = writer.getBuffer();

        // Read back using bigint version
        const reader = new BufferReader(buffer);
        const result = reader.readBigIntVarint();

        // Verify the value is preserved exactly
        expect(result).toBe(BigInt(value));
      }
    });

    describe("known uvarint cases", () => {
      const uvarintCases: Array<[number, Array<number>]> = [
        [0, [0]],
        [1, [1]],
        [127, [127]],
        [128, [128, 1]],
        [129, [129, 1]],
        [255, [255, 1]],
        [256, [128, 2]],
        [257, [129, 2]],
        [320, [192, 2]],
        [382, [254, 2]],
        [383, [255, 2]],
        [384, [128, 3]],
        [385, [129, 3]],
        [509, [253, 3]],
        [510, [254, 3]],
        [511, [255, 3]],
        [512, [128, 4]],
        [513, [129, 4]],
        [173573, [133, 204, 10]],
        [17357327, [143, 180, 163, 8]],
        [268435454, [254, 255, 255, 127]],
        [268435455, [255, 255, 255, 127]],
        [268435456, [128, 128, 128, 128, 1]],
        [268435457, [129, 128, 128, 128, 1]],
        [1735732759, [151, 220, 212, 187, 6]],
        [2147483647, [255, 255, 255, 255, 7]],
        [2147483648, [128, 128, 128, 128, 8]],
        [1735732759569, [145, 152, 240, 141, 194, 50]],
      ];

      test.each(uvarintCases)("uvarint: %p", (value, expectedResult) => {
        const writer = new BufferWriter(4);
        writer.writeUVarint(value);
        const encoded = writer.getBuffer();
        expect(Array.from(encoded)).toEqual(expectedResult);
        const reader = new BufferReader(encoded);
        expect(reader.readUVarint()).toEqual(value);
      });

      test("uvarint 0 to +100000000", () => {
        for (let i = 0; i < 100000000; i += 10383) {
          const writer = new BufferWriter(4);
          writer.writeUVarint(i);
          const encoded = writer.getBuffer();
          const reader = new BufferReader(encoded);
          expect(reader.readUVarint()).toEqual(i);
        }
      });

      test("uvarint 0 to +10000", () => {
        for (let i = 0; i < 10000; i++) {
          const writer = new BufferWriter(4);
          writer.writeUVarint(i);
          const encoded = writer.getBuffer();
          const reader = new BufferReader(encoded);
          expect(reader.readUVarint()).toEqual(i);
        }
      });
    });

    describe("known varint cases", () => {
      const varintCases: Array<[number, Array<number>]> = [
        [0, [0]],
        [1, [2]],
        [-1, [1]],
        [2, [4]],
        [-2, [3]],
        [123, [246, 1]],
        [-123, [245, 1]],
        [2147483647, [254, 255, 255, 255, 15]],
        [-2147483648, [255, 255, 255, 255, 15]],
        [1735732759569, [162, 176, 224, 155, 132, 101]],
        [-1735732759569, [161, 176, 224, 155, 132, 101]],
        [1735732759570, [164, 176, 224, 155, 132, 101]],
        [-1735732759570, [163, 176, 224, 155, 132, 101]],
      ];

      test.each(varintCases)("varint: %p", (value, expectedResult) => {
        const writer = new BufferWriter(4);
        writer.writeVarint(value);
        const encoded = writer.getBuffer();
        expect(Array.from(encoded)).toEqual(expectedResult);
        const reader = new BufferReader(encoded);
        expect(reader.readVarint()).toEqual(value);
      });

      test("varint -100000000 to +100000000", () => {
        for (let i = -100000000; i < 100000000; i += 1583) {
          const writer = new BufferWriter(4);
          writer.writeVarint(i);
          const encoded = writer.getBuffer();
          const reader = new BufferReader(encoded);
          expect(reader.readVarint()).toEqual(i);
        }
      });
    });
  });

  describe("array operations", () => {
    it("should read boolean arrays correctly", () => {
      const testArrays = [
        [],
        [true],
        [false],
        [true, false, true],
        [...Array(8)].map((_, i) => i % 2 === 0), // 8 alternating booleans
        [...Array(16)].map((_, i) => i % 3 === 0), // 16 booleans with a pattern
      ];

      for (const array of testArrays) {
        const writer = new BufferWriter(50);
        writer.writeLengthPrefixedBoolArray(array);

        const buffer = writer.getBuffer();
        const reader = new BufferReader(buffer);
        const result = reader.readLengthPrefixedBoolArray();

        expect(result).toEqual(array);
      }
    });

    it("should correctly handle boolean arrays with odd sizes", () => {
      // Test arrays that don't fill complete bytes
      const testSizes = [1, 3, 7, 9, 15, 17];

      for (const size of testSizes) {
        const boolArray = Array(size)
          .fill(false)
          .map((_, i) => i % 2 === 0);

        const writer = new BufferWriter(50);
        writer.writeLengthPrefixedBoolArray(boolArray);

        const buffer = writer.getBuffer();
        const reader = new BufferReader(buffer);
        const result = reader.readLengthPrefixedBoolArray();

        expect(result).toEqual(boolArray);
        expect(result.length).toBe(size);
      }
    });
  });

  describe("string operations", () => {
    it("should read uvarint-prefixed strings correctly", () => {
      const testStrings = ["", "hello", "world", "BufferReader test"];

      const writer = new BufferWriter(100);
      for (const str of testStrings) {
        writer.writeLengthPrefixedString(str);
      }

      const buffer = writer.getBuffer();
      const reader = new BufferReader(buffer);

      for (const expected of testStrings) {
        expect(reader.readUVarintPrefixedString()).toBe(expected);
      }
    });

    it("should read strings with multi-byte characters", () => {
      const testStrings = [
        "こんにちは",
        "你好",
        "🚀🔥💯",
        "café",
        "über",
        "a\u0300", // "à" composed with combining diacritical mark
      ];

      const writer = new BufferWriter(100);
      for (const str of testStrings) {
        writer.writeLengthPrefixedString(str);
      }

      const buffer = writer.getBuffer();
      const reader = new BufferReader(buffer);

      for (const expected of testStrings) {
        expect(reader.readUVarintPrefixedString()).toBe(expected);
      }
    });

    it("should read varint-prefixed strings correctly", () => {
      const testStrings = ["first", "second", "third"];

      const writer = new BufferWriter(100);
      for (const str of testStrings) {
        writer.writeLengthPrefixedString(str, true); // use varint encoding
      }

      const buffer = writer.getBuffer();
      const reader = new BufferReader(buffer);

      for (const expected of testStrings) {
        const [str, negative] = reader.readVarintPrefixedString();
        expect(str).toBe(expected);
        expect(negative).toBe(false);
      }
    });

    it("should handle negative length indicator for strings", () => {
      const testStrings = ["first", "second", "third"];

      const writer = new BufferWriter(100);
      for (const str of testStrings) {
        writer.writeLengthPrefixedString(str, true, true); // use negative varint length
      }

      const buffer = writer.getBuffer();
      const reader = new BufferReader(buffer);

      for (const expected of testStrings) {
        const [str, negative] = reader.readVarintPrefixedString();
        expect(str).toBe(expected);
        expect(negative).toBe(true);
      }
    });
  });

  describe("error handling", () => {
    it("should throw error for invalid varint encoding", () => {
      // Create a buffer with an invalid varint (all bytes have continuation bit set)
      const invalidBuffer = new Uint8Array([
        0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80,
      ]);
      const reader = new BufferReader(invalidBuffer);

      expect(() => {
        reader.readUVarint();
      }).toThrow("invalid varint encoding");
    });
  });

  describe("negative varint values", () => {
    // Test negative values specifically to exercise zigzag decode branches
    it("should handle negative varints near boundaries", () => {
      const values = [-1, -63, -64, -65, -127, -128, -129, -8191, -8192, -8193];
      const writer = new BufferWriter(100);
      for (const value of values) {
        writer.writeVarint(value);
      }
      const buffer = writer.getBuffer();
      const reader = new BufferReader(buffer);
      for (const expected of values) {
        expect(reader.readVarint()).toBe(expected);
      }
    });

    it("should handle large negative varints", () => {
      const values = [-1048575, -1048576, -1048577, -(2 ** 31 - 1), -(2 ** 31), -(2 ** 32)];
      const writer = new BufferWriter(100);
      for (const value of values) {
        writer.writeVarint(value);
      }
      const buffer = writer.getBuffer();
      const reader = new BufferReader(buffer);
      for (const expected of values) {
        expect(reader.readVarint()).toBe(expected);
      }
    });

    it("should handle negative bigint varints near boundaries", () => {
      const values = [
        -1n,
        -63n,
        -64n,
        -65n,
        -127n,
        -128n,
        -8191n,
        -8192n,
        -(2n ** 31n),
        -(2n ** 32n),
        -(2n ** 63n),
      ];
      const writer = new BufferWriter(200);
      for (const value of values) {
        writer.writeBigIntVarint(value);
      }
      const buffer = writer.getBuffer();
      const reader = new BufferReader(buffer);
      for (const expected of values) {
        expect(reader.readBigIntVarint()).toBe(expected);
      }
    });
  });

  describe("boolean array packing edge cases", () => {
    it("should handle all boolean array sizes from 1 to 33", () => {
      for (let size = 1; size <= 33; size++) {
        // Create array with alternating pattern
        const boolArray = Array.from({ length: size }, (_, i) => i % 2 === 0);
        const writer = new BufferWriter(50);
        writer.writeLengthPrefixedBoolArray(boolArray);
        const buffer = writer.getBuffer();
        const reader = new BufferReader(buffer);
        const result = reader.readLengthPrefixedBoolArray();
        expect(result).toEqual(boolArray);
      }
    });

    it("should handle all-true and all-false boolean arrays of various sizes", () => {
      for (const size of [1, 7, 8, 9, 15, 16, 17, 31, 32, 33]) {
        const allTrue = Array(size).fill(true);
        const allFalse = Array(size).fill(false);

        for (const arr of [allTrue, allFalse]) {
          const writer = new BufferWriter(50);
          writer.writeLengthPrefixedBoolArray(arr);
          const buffer = writer.getBuffer();
          const reader = new BufferReader(buffer);
          expect(reader.readLengthPrefixedBoolArray()).toEqual(arr);
        }
      }
    });

    it("should handle single-bit boolean arrays", () => {
      for (const val of [true, false]) {
        const writer = new BufferWriter(10);
        writer.writeLengthPrefixedBoolArray([val]);
        const buffer = writer.getBuffer();
        const reader = new BufferReader(buffer);
        expect(reader.readLengthPrefixedBoolArray()).toEqual([val]);
      }
    });
  });

  describe("writer buffer growth", () => {
    it("should grow buffer when writing more data than initial capacity", () => {
      // Start with very small buffer
      const writer = new BufferWriter(2);
      // Write more than 2 bytes
      writer.writeUVarint(0);
      writer.writeUVarint(1);
      writer.writeUVarint(128); // 2 bytes
      writer.writeUVarint(16384); // 3 bytes
      writer.writeUVarint(2097152); // 4 bytes

      const buffer = writer.getBuffer();
      const reader = new BufferReader(buffer);
      expect(reader.readUVarint()).toBe(0);
      expect(reader.readUVarint()).toBe(1);
      expect(reader.readUVarint()).toBe(128);
      expect(reader.readUVarint()).toBe(16384);
      expect(reader.readUVarint()).toBe(2097152);
      expect(reader.isEnd()).toBe(true);
    });

    it("should handle writing large strings that exceed initial capacity", () => {
      const writer = new BufferWriter(4);
      const longString = "x".repeat(500);
      writer.writeLengthPrefixedString(longString);

      const buffer = writer.getBuffer();
      const reader = new BufferReader(buffer);
      expect(reader.readUVarintPrefixedString()).toBe(longString);
    });
  });

  describe("BufferWriter edge cases", () => {
    it("should report written length via getWrittenLength()", () => {
      const writer = new BufferWriter(16);
      expect(writer.getWrittenLength()).toBe(0);
      writer.writeUint8(42);
      expect(writer.getWrittenLength()).toBe(1);
      writer.writeUVarint(128);
      expect(writer.getWrittenLength()).toBe(3); // 1 + 2 bytes for varint 128
    });

    it("should throw when writeUVarintLengthPrefixedBytes receives non-Uint8Array", () => {
      const writer = new BufferWriter(16);
      expect(() => {
        writer.writeUVarintLengthPrefixedBytes("not a uint8array" as any);
      }).toThrow("bytes must be a Uint8Array");
    });

    it("should handle non-ASCII strings with varint length encoding", () => {
      const writer = new BufferWriter(16);
      writer.writeLengthPrefixedString("日本語テスト", true);
      const buffer = writer.getBuffer();
      const reader = new BufferReader(buffer);
      const [result, negative] = reader.readVarintPrefixedString();
      expect(result).toBe("日本語テスト");
      expect(negative).toBe(false);
    });

    it("should handle non-ASCII strings with negative varint length encoding", () => {
      const writer = new BufferWriter(16);
      writer.writeLengthPrefixedString("café", true, true);
      const buffer = writer.getBuffer();
      const reader = new BufferReader(buffer);
      const [result, negative] = reader.readVarintPrefixedString();
      expect(result).toBe("café");
      expect(negative).toBe(true);
    });

    it("should handle non-ASCII strings that require buffer expansion", () => {
      const writer = new BufferWriter(4); // very small initial buffer
      const longNonAscii = "日本語".repeat(50);
      writer.writeLengthPrefixedString(longNonAscii);
      const buffer = writer.getBuffer();
      const reader = new BufferReader(buffer);
      expect(reader.readUVarintPrefixedString()).toBe(longNonAscii);
    });
  });

  describe("zigzagEncode export", () => {
    it("should encode positive values as 2*n", () => {
      expect(zigzagEncode(0)).toBe(0);
      expect(zigzagEncode(1)).toBe(2);
      expect(zigzagEncode(100)).toBe(200);
    });

    it("should encode negative values as 2*|n|-1", () => {
      expect(zigzagEncode(-1)).toBe(1);
      expect(zigzagEncode(-2)).toBe(3);
      expect(zigzagEncode(-100)).toBe(199);
    });
  });

  describe("non-advancing reads", () => {
    it("readUVarint with signed=true should decode as signed (zigzag)", () => {
      const writer = new BufferWriter(10);
      writer.writeVarint(-42);
      writer.writeVarint(99);
      const buffer = writer.getBuffer();
      const reader = new BufferReader(buffer);

      // Read using readUVarint(true) which is equivalent to readVarint()
      const val1 = reader.readUVarint(true);
      expect(val1).toBe(-42);
      // Next read should get 99
      const val2 = reader.readUVarint(true);
      expect(val2).toBe(99);
    });

    it("readUVarint with signed=false should decode as unsigned", () => {
      const writer = new BufferWriter(10);
      writer.writeUVarint(42);
      writer.writeUVarint(99);
      const buffer = writer.getBuffer();
      const reader = new BufferReader(buffer);

      // Read without signed flag (default)
      const val1 = reader.readUVarint(false);
      expect(val1).toBe(42);
      const val2 = reader.readUVarint();
      expect(val2).toBe(99);
    });
  });
});
