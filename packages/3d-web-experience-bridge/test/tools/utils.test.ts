import { describe, expect, test } from "vitest";

import { distance, distance2D, roundPos, textResult } from "../../src/tools/utils";

describe("tools/utils", () => {
  describe("distance", () => {
    test("returns 0 for identical points", () => {
      const p = { x: 3, y: 4, z: 5 };
      expect(distance(p, p)).toBe(0);
    });

    test("computes 3D Euclidean distance", () => {
      expect(distance({ x: 0, y: 0, z: 0 }, { x: 3, y: 4, z: 0 })).toBe(5);
    });

    test("includes Y axis in distance", () => {
      const d = distance({ x: 0, y: 0, z: 0 }, { x: 1, y: 2, z: 2 });
      expect(d).toBe(3);
    });

    test("is symmetric", () => {
      const a = { x: 1, y: 2, z: 3 };
      const b = { x: 4, y: 6, z: 8 };
      expect(distance(a, b)).toBeCloseTo(distance(b, a));
    });
  });

  describe("distance2D", () => {
    test("returns 0 for identical XZ positions", () => {
      expect(distance2D({ x: 1, y: 0, z: 1 }, { x: 1, y: 99, z: 1 })).toBe(0);
    });

    test("ignores Y axis", () => {
      const d = distance2D({ x: 0, y: 0, z: 0 }, { x: 3, y: 100, z: 4 });
      expect(d).toBe(5);
    });

    test("computes XZ plane distance", () => {
      expect(distance2D({ x: 1, y: 0, z: 1 }, { x: 4, y: 0, z: 5 })).toBe(5);
    });
  });

  describe("roundPos", () => {
    test("rounds to two decimal places", () => {
      const result = roundPos({ x: 1.2345, y: 2.6789, z: -3.999 });
      expect(result.x).toBe(1.23);
      expect(result.y).toBe(2.68);
      expect(result.z).toBe(-4);
    });

    test("preserves exact values", () => {
      const result = roundPos({ x: 1, y: 2, z: 3 });
      expect(result).toEqual({ x: 1, y: 2, z: 3 });
    });

    test("returns a new object", () => {
      const original = { x: 1, y: 2, z: 3 };
      const result = roundPos(original);
      expect(result).not.toBe(original);
    });
  });

  describe("textResult", () => {
    test("wraps data in tool result format", () => {
      const result = textResult({ status: "ok" });
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe("text");
      expect(JSON.parse(result.content[0].text)).toEqual({ status: "ok" });
    });

    test("handles complex data", () => {
      const data = { a: [1, 2, 3], b: { nested: true } };
      const result = textResult(data);
      expect(JSON.parse(result.content[0].text)).toEqual(data);
    });

    test("handles null and primitive values", () => {
      expect(JSON.parse(textResult(null).content[0].text)).toBeNull();
      expect(JSON.parse(textResult(42).content[0].text)).toBe(42);
      expect(JSON.parse(textResult("hello").content[0].text)).toBe("hello");
    });
  });
});
