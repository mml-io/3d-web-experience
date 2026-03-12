import {
  clamp,
  ease,
  getSpawnPositionInsideCircle,
  remap,
  round,
  roundToDecimalPlaces,
  toArray,
} from "../../src/helpers/math-helpers";
import { Quat } from "../../src/math/Quat";
import { Vect3 } from "../../src/math/Vect3";

describe("math-helpers", () => {
  describe("roundToDecimalPlaces", () => {
    it("rounds to 2 decimal places", () => {
      expect(roundToDecimalPlaces(1.2345, 2)).toBe(1.23);
    });

    it("rounds to 0 decimal places", () => {
      expect(roundToDecimalPlaces(1.7, 0)).toBe(2);
    });

    it("handles negative numbers", () => {
      expect(roundToDecimalPlaces(-1.555, 2)).toBe(-1.55);
    });
  });

  describe("toArray", () => {
    it("converts Vect3 to 3-element array", () => {
      const v = new Vect3(1.12345, 2.6789, 3.1);
      const arr = toArray(v);
      expect(arr).toHaveLength(3);
      expect(arr[0]).toBe(roundToDecimalPlaces(1.12345, 3));
      expect(arr[1]).toBe(roundToDecimalPlaces(2.6789, 3));
    });

    it("converts Quat to 4-element array", () => {
      const q = new Quat(0.1, 0.2, 0.3, 0.9);
      const arr = toArray(q);
      expect(arr).toHaveLength(4);
      expect(arr[3]).toBe(roundToDecimalPlaces(0.9, 3));
    });

    it("respects custom precision", () => {
      const v = new Vect3(1.123456, 0, 0);
      const arr = toArray(v, 5);
      expect(arr[0]).toBe(1.12346);
    });
  });

  describe("getSpawnPositionInsideCircle", () => {
    it("returns a Vect3 at id=0", () => {
      const pos = getSpawnPositionInsideCircle(10, 100, 0);
      expect(pos).toBeInstanceOf(Vect3);
      expect(pos.x).toBe(0);
      expect(pos.z).toBe(0);
      expect(pos.y).toBe(0);
    });

    it("returns different positions for different ids", () => {
      const pos1 = getSpawnPositionInsideCircle(10, 100, 1);
      const pos2 = getSpawnPositionInsideCircle(10, 100, 2);
      expect(pos1.x === pos2.x && pos1.z === pos2.z).toBe(false);
    });

    it("uses yPos parameter", () => {
      const pos = getSpawnPositionInsideCircle(10, 100, 5, 42);
      expect(pos.y).toBe(42);
    });
  });

  describe("round", () => {
    it("rounds to specified digits", () => {
      expect(round(1.2345, 2)).toBe(1.23);
      expect(round(1.2355, 2)).toBe(1.24);
    });
  });

  describe("ease", () => {
    it("returns eased value", () => {
      const result = ease(10, 0, 0.5);
      expect(result).toBe(round((10 - 0) * 0.5, 5));
    });

    it("returns 0 when target equals current", () => {
      expect(ease(5, 5, 0.5)).toBe(0);
    });
  });

  describe("clamp", () => {
    it("clamps below min", () => {
      expect(clamp(-5, 0, 10)).toBe(0);
    });

    it("clamps above max", () => {
      expect(clamp(15, 0, 10)).toBe(10);
    });

    it("passes through values in range", () => {
      expect(clamp(5, 0, 10)).toBe(5);
    });
  });

  describe("remap", () => {
    it("remaps midpoint", () => {
      expect(remap(5, 0, 10, 0, 100)).toBe(50);
    });

    it("remaps min to min", () => {
      expect(remap(0, 0, 10, 100, 200)).toBe(100);
    });

    it("remaps max to max", () => {
      expect(remap(10, 0, 10, 100, 200)).toBe(200);
    });
  });
});
