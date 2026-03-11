import { degToRad, radToDeg } from "../../src/math/radToDeg";

describe("radToDeg / degToRad", () => {
  it("radToDeg 0 → 0", () => {
    expect(radToDeg(0)).toBe(0);
  });

  it("radToDeg π → 180", () => {
    expect(radToDeg(Math.PI)).toBeCloseTo(180);
  });

  it("degToRad 0 → 0", () => {
    expect(degToRad(0)).toBe(0);
  });

  it("degToRad 180 → π", () => {
    expect(degToRad(180)).toBeCloseTo(Math.PI);
  });

  it("round-trip: radToDeg(degToRad(x)) ≈ x", () => {
    expect(radToDeg(degToRad(45))).toBeCloseTo(45);
    expect(radToDeg(degToRad(90))).toBeCloseTo(90);
    expect(radToDeg(degToRad(360))).toBeCloseTo(360);
  });
});
