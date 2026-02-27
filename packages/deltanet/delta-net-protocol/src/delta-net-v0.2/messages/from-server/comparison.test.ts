import { BufferReader } from "../../../BufferReader";
import { BufferWriter } from "../../../BufferWriter";
import type {
  DeltaNetV01InitialCheckoutMessage as DeltaNetInitialCheckoutMessage,
  DeltaNetV01Tick as DeltaNetTick,
} from "../../../delta-net-v0.1";
import { encodeInitialCheckout, encodeTick } from "../../../delta-net-v0.1";

import { encodeInitialCheckoutV02, decodeInitialCheckoutV02 } from "./initialCheckout";
import { encodeTickV02, decodeTickV02 } from "./tick";

function makeTickMessage(componentCount: number, userCount: number): DeltaNetTick {
  const componentDeltaDeltas = Array.from({ length: componentCount }, (_, i) => ({
    componentId: i,
    deltaDeltas: new BigInt64Array(
      Array.from({ length: userCount }, (_, j) => BigInt((i + 1) * (j + 1))),
    ),
  }));

  return {
    type: "tick",
    serverTime: 12345,
    removedIndices: [],
    indicesCount: userCount,
    componentDeltaDeltas,
    states: [],
  };
}

function makeInitialCheckoutMessage(
  componentCount: number,
  userCount: number,
): DeltaNetInitialCheckoutMessage {
  const components = Array.from({ length: componentCount }, (_, i) => ({
    componentId: i,
    values: new BigInt64Array(
      Array.from({ length: userCount }, (_, j) => BigInt((i + 1) * 100 + j)),
    ),
    deltas: new BigInt64Array(
      Array.from({ length: userCount }, (_, j) => BigInt((i + 1) * 10 + j)),
    ),
  }));

  return {
    type: "initialCheckout",
    serverTime: 12345,
    indicesCount: userCount,
    components,
    states: [],
  };
}

describe("v0.1 vs v0.2 size comparison", () => {
  describe("tick messages", () => {
    const scenarios: Array<[string, number, number]> = [
      ["50 components x 3 users", 50, 3],
      ["100 components x 5 users", 100, 5],
      ["3 components x 100 users", 3, 100],
      ["10 components x 10 users", 10, 10],
      ["1 component x 1 user", 1, 1],
      ["50 components x 100 users", 50, 100],
      ["50 components x 1000 users", 50, 1000],
      ["50 components x 5000 users", 50, 5000],
      ["3 components x 1000 users", 3, 1000],
      ["3 components x 5000 users", 3, 5000],
      ["100 components x 1000 users", 100, 1000],
    ];

    test.each(scenarios)("%s", (name, componentCount, userCount) => {
      const message = makeTickMessage(componentCount, userCount);

      const v01Writer = new BufferWriter(64);
      encodeTick(message, v01Writer);
      const v01Size = v01Writer.getBuffer().byteLength;

      const v02Writer = new BufferWriter(64);
      encodeTickV02(message, v02Writer);
      const v02Bytes = v02Writer.getBuffer();
      const v02Size = v02Bytes.byteLength;

      // v0.2 may be slightly larger in edge cases (few components, many users)
      // but should never be dramatically worse
      expect(v02Size).toBeLessThan(v01Size * 1.1);

      // Roundtrip correctness: encode v0.2 -> decode v0.2 -> compare to original
      const reader = new BufferReader(v02Bytes);
      reader.readUInt8(); // skip message type byte
      const decoded = decodeTickV02(reader);
      expect(decoded.type).toBe("tick");
      expect(decoded.serverTime).toBe(message.serverTime);
      expect(decoded.removedIndices).toEqual(message.removedIndices);
      expect(decoded.indicesCount).toBe(message.indicesCount);
      expect(decoded.componentDeltaDeltas.length).toBe(message.componentDeltaDeltas.length);
      for (let i = 0; i < message.componentDeltaDeltas.length; i++) {
        expect(decoded.componentDeltaDeltas[i].componentId).toBe(
          message.componentDeltaDeltas[i].componentId,
        );
        expect(decoded.componentDeltaDeltas[i].deltaDeltas).toEqual(
          message.componentDeltaDeltas[i].deltaDeltas,
        );
      }

      // For many-component scenarios, v0.2 should be smaller
      if (componentCount >= 10 && userCount <= 10) {
        expect(v02Size).toBeLessThan(v01Size);
      }

      // v0.2 should never be significantly larger than v0.1 (allow up to 10% overhead)
      expect(v02Size).toBeLessThanOrEqual(Math.ceil(v01Size * 1.1));
    });
  });

  describe("initialCheckout messages", () => {
    const scenarios: Array<[string, number, number]> = [
      ["50 components x 3 users", 50, 3],
      ["100 components x 5 users", 100, 5],
      ["3 components x 100 users", 3, 100],
      ["10 components x 10 users", 10, 10],
      ["50 components x 100 users", 50, 100],
      ["50 components x 1000 users", 50, 1000],
      ["50 components x 5000 users", 50, 5000],
      ["3 components x 1000 users", 3, 1000],
      ["3 components x 5000 users", 3, 5000],
      ["100 components x 1000 users", 100, 1000],
    ];

    test.each(scenarios)("%s", (name, componentCount, userCount) => {
      const message = makeInitialCheckoutMessage(componentCount, userCount);

      const v01Writer = new BufferWriter(64);
      encodeInitialCheckout(message, v01Writer);
      const v01Size = v01Writer.getBuffer().byteLength;

      const v02Writer = new BufferWriter(64);
      encodeInitialCheckoutV02(message, v02Writer);
      const v02Bytes = v02Writer.getBuffer();
      const v02Size = v02Bytes.byteLength;

      // v0.2 may be slightly larger in edge cases (few components, many users)
      // but should never be dramatically worse
      expect(v02Size).toBeLessThan(v01Size * 1.1);

      // Roundtrip correctness: encode v0.2 -> decode v0.2 -> compare to original
      const reader = new BufferReader(v02Bytes);
      reader.readUInt8(); // skip message type byte
      const decoded = decodeInitialCheckoutV02(reader);
      expect(decoded.type).toBe("initialCheckout");
      expect(decoded.serverTime).toBe(message.serverTime);
      expect(decoded.indicesCount).toBe(message.indicesCount);
      expect(decoded.components.length).toBe(message.components.length);
      for (let i = 0; i < message.components.length; i++) {
        expect(decoded.components[i].componentId).toBe(message.components[i].componentId);
        expect(decoded.components[i].values).toEqual(message.components[i].values);
        expect(decoded.components[i].deltas).toEqual(message.components[i].deltas);
      }

      // For many-component scenarios, v0.2 should be smaller
      if (componentCount >= 10 && userCount <= 10) {
        expect(v02Size).toBeLessThan(v01Size);
      }

      // v0.2 should never be significantly larger than v0.1 (allow up to 10% overhead)
      expect(v02Size).toBeLessThanOrEqual(Math.ceil(v01Size * 1.1));
    });
  });
});
