import { EulXYZ, Matr4, Quat } from "../../src/math";

describe("EulXYZ", () => {
  it("defaults to (0,0,0)", () => {
    const e = new EulXYZ();
    expect(e.x).toBe(0);
    expect(e.y).toBe(0);
    expect(e.z).toBe(0);
  });

  it("constructs with values", () => {
    const e = new EulXYZ(1, 2, 3);
    expect(e.x).toBe(1);
    expect(e.y).toBe(2);
    expect(e.z).toBe(3);
  });

  it("set", () => {
    const e = new EulXYZ().set(4, 5, 6);
    expect(e.x).toBe(4);
    expect(e.y).toBe(5);
    expect(e.z).toBe(6);
  });

  it("copy", () => {
    const a = new EulXYZ(1, 2, 3);
    const b = new EulXYZ().copy(a);
    expect(b.x).toBe(1);
    expect(b.y).toBe(2);
    expect(b.z).toBe(3);
  });

  it("clone", () => {
    const a = new EulXYZ(1, 2, 3);
    const b = a.clone();
    expect(b).not.toBe(a);
    expect(b.x).toBe(1);
    expect(b.y).toBe(2);
    expect(b.z).toBe(3);
  });

  it("length", () => {
    const e = new EulXYZ(3, 4, 0);
    expect(e.length()).toBe(5);
  });

  it("lengthSquared", () => {
    const e = new EulXYZ(3, 4, 0);
    expect(e.lengthSquared()).toBe(25);
  });

  it("setFromRotationMatrix — non-gimbal", () => {
    const m = new Matr4().makeRotationY(0.5);
    const e = new EulXYZ().setFromRotationMatrix(m);
    expect(e.x).toBeCloseTo(0);
    expect(e.y).toBeCloseTo(0.5);
    expect(e.z).toBeCloseTo(0);
  });

  it("setFromRotationMatrix — gimbal lock (m13 ≈ ±1)", () => {
    // 90° Y rotation → m13 = sin(π/2) ≈ 1 → gimbal lock branch
    const m = new Matr4().makeRotationY(Math.PI / 2);
    const e = new EulXYZ().setFromRotationMatrix(m);
    expect(e.y).toBeCloseTo(Math.PI / 2, 4);
    expect(e.z).toBe(0); // gimbal lock sets z=0
  });

  it("setFromQuaternion round-trip", () => {
    const original = new EulXYZ(0.3, 0.7, 1.1);
    const q = new Quat().setFromEulerXYZ(original);
    const result = new EulXYZ().setFromQuaternion(q);
    expect(result.x).toBeCloseTo(original.x, 4);
    expect(result.y).toBeCloseTo(original.y, 4);
    expect(result.z).toBeCloseTo(original.z, 4);
  });

  it("round-trip: Euler → Quat → Euler → Quat", () => {
    const e1 = new EulXYZ(0.2, -0.4, 0.8);
    const q1 = new Quat().setFromEulerXYZ(e1);
    const e2 = new EulXYZ().setFromQuaternion(q1);
    const q2 = new Quat().setFromEulerXYZ(e2);
    expect(q1.x).toBeCloseTo(q2.x, 4);
    expect(q1.y).toBeCloseTo(q2.y, 4);
    expect(q1.z).toBeCloseTo(q2.z, 4);
    expect(q1.w).toBeCloseTo(q2.w, 4);
  });
});
