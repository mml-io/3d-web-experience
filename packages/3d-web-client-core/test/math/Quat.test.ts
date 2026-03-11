import { EulXYZ, Matr4, Quat } from "../../src/math";

describe("Quat", () => {
  it("defaults to identity (0,0,0,1)", () => {
    const q = new Quat();
    expect(q.x).toBe(0);
    expect(q.y).toBe(0);
    expect(q.z).toBe(0);
    expect(q.w).toBe(1);
  });

  it("constructs with values", () => {
    const q = new Quat(1, 2, 3, 4);
    expect(q.x).toBe(1);
    expect(q.y).toBe(2);
    expect(q.z).toBe(3);
    expect(q.w).toBe(4);
  });

  it("set", () => {
    const q = new Quat().set(1, 2, 3, 4);
    expect(q.x).toBe(1);
    expect(q.w).toBe(4);
  });

  it("copy", () => {
    const a = new Quat(1, 2, 3, 4);
    const b = new Quat().copy(a);
    expect(b.x).toBe(1);
    expect(b.y).toBe(2);
    expect(b.z).toBe(3);
    expect(b.w).toBe(4);
  });

  it("clone", () => {
    const a = new Quat(1, 2, 3, 4);
    const b = a.clone();
    expect(b).not.toBe(a);
    expect(b.x).toBe(1);
    expect(b.w).toBe(4);
  });

  it("multiply identity * identity = identity", () => {
    const a = new Quat();
    const b = new Quat();
    a.multiply(b);
    expect(a.x).toBe(0);
    expect(a.y).toBe(0);
    expect(a.z).toBe(0);
    expect(a.w).toBe(1);
  });

  it("multiply two rotations", () => {
    const a = new Quat().setFromAxisAngle({ x: 0, y: 1, z: 0 }, Math.PI / 2);
    const b = new Quat().setFromAxisAngle({ x: 0, y: 1, z: 0 }, Math.PI / 2);
    a.multiply(b);
    // Combined = 180 degrees around Y
    const expected = new Quat().setFromAxisAngle({ x: 0, y: 1, z: 0 }, Math.PI);
    expect(a.x).toBeCloseTo(expected.x);
    expect(a.y).toBeCloseTo(expected.y);
    expect(a.z).toBeCloseTo(expected.z);
    expect(a.w).toBeCloseTo(expected.w);
  });

  it("premultiply", () => {
    const a = new Quat().setFromAxisAngle({ x: 1, y: 0, z: 0 }, Math.PI / 2);
    const b = new Quat().setFromAxisAngle({ x: 0, y: 1, z: 0 }, Math.PI / 2);
    const result = a.clone();
    result.premultiply(b);
    // b * a
    const expected = new Quat().multiplyQuaternions(b, a);
    expect(result.x).toBeCloseTo(expected.x);
    expect(result.y).toBeCloseTo(expected.y);
    expect(result.z).toBeCloseTo(expected.z);
    expect(result.w).toBeCloseTo(expected.w);
  });

  it("setFromEulerXYZ 90° around X", () => {
    const q = new Quat().setFromEulerXYZ({ x: Math.PI / 2, y: 0, z: 0 });
    expect(q.x).toBeCloseTo(Math.sin(Math.PI / 4));
    expect(q.y).toBeCloseTo(0);
    expect(q.z).toBeCloseTo(0);
    expect(q.w).toBeCloseTo(Math.cos(Math.PI / 4));
  });

  it("setFromEulerXYZ 90° around Y", () => {
    const q = new Quat().setFromEulerXYZ({ x: 0, y: Math.PI / 2, z: 0 });
    expect(q.x).toBeCloseTo(0);
    expect(q.y).toBeCloseTo(Math.sin(Math.PI / 4));
    expect(q.z).toBeCloseTo(0);
    expect(q.w).toBeCloseTo(Math.cos(Math.PI / 4));
  });

  it("setFromEulerXYZ 90° around Z", () => {
    const q = new Quat().setFromEulerXYZ({ x: 0, y: 0, z: Math.PI / 2 });
    expect(q.x).toBeCloseTo(0);
    expect(q.y).toBeCloseTo(0);
    expect(q.z).toBeCloseTo(Math.sin(Math.PI / 4));
    expect(q.w).toBeCloseTo(Math.cos(Math.PI / 4));
  });

  it("setFromRotationMatrix — trace > 0 branch", () => {
    // Identity matrix: trace = 3 > 0
    const m = new Matr4();
    const q = new Quat().setFromRotationMatrix(m);
    expect(q.x).toBeCloseTo(0);
    expect(q.y).toBeCloseTo(0);
    expect(q.z).toBeCloseTo(0);
    expect(q.w).toBeCloseTo(1);
  });

  it("setFromRotationMatrix — m11 largest branch", () => {
    // 180° rotation around X: m11=1, m22=-1, m33=-1, trace=-1
    const m = new Matr4().makeRotationX(Math.PI);
    const q = new Quat().setFromRotationMatrix(m);
    q.normalize();
    expect(Math.abs(q.x)).toBeCloseTo(1);
    expect(q.y).toBeCloseTo(0, 4);
    expect(q.z).toBeCloseTo(0, 4);
    expect(q.w).toBeCloseTo(0, 4);
  });

  it("setFromRotationMatrix — m22 largest branch", () => {
    // 180° rotation around Y: m11=-1, m22=1, m33=-1, trace=-1
    const m = new Matr4().makeRotationY(Math.PI);
    const q = new Quat().setFromRotationMatrix(m);
    q.normalize();
    expect(q.x).toBeCloseTo(0, 4);
    expect(Math.abs(q.y)).toBeCloseTo(1);
    expect(q.z).toBeCloseTo(0, 4);
    expect(q.w).toBeCloseTo(0, 4);
  });

  it("setFromRotationMatrix — m33 largest branch", () => {
    // 180° rotation around Z: m11=-1, m22=-1, m33=1, trace=-1
    const m = new Matr4().makeRotationZ(Math.PI);
    const q = new Quat().setFromRotationMatrix(m);
    q.normalize();
    expect(q.x).toBeCloseTo(0, 4);
    expect(q.y).toBeCloseTo(0, 4);
    expect(Math.abs(q.z)).toBeCloseTo(1);
    expect(q.w).toBeCloseTo(0, 4);
  });

  it("setFromAxisAngle", () => {
    const q = new Quat().setFromAxisAngle({ x: 0, y: 0, z: 1 }, Math.PI);
    expect(q.x).toBeCloseTo(0);
    expect(q.y).toBeCloseTo(0);
    expect(q.z).toBeCloseTo(1);
    expect(q.w).toBeCloseTo(0);
  });

  it("slerp t=0 returns this", () => {
    const a = new Quat().setFromAxisAngle({ x: 1, y: 0, z: 0 }, 0.5);
    const b = new Quat().setFromAxisAngle({ x: 0, y: 1, z: 0 }, 1.0);
    const original = a.clone();
    a.slerp(b, 0);
    expect(a.x).toBe(original.x);
    expect(a.y).toBe(original.y);
    expect(a.z).toBe(original.z);
    expect(a.w).toBe(original.w);
  });

  it("slerp t=1 copies target", () => {
    const a = new Quat().setFromAxisAngle({ x: 1, y: 0, z: 0 }, 0.5);
    const b = new Quat().setFromAxisAngle({ x: 0, y: 1, z: 0 }, 1.0);
    a.slerp(b, 1);
    expect(a.x).toBeCloseTo(b.x);
    expect(a.y).toBeCloseTo(b.y);
    expect(a.z).toBeCloseTo(b.z);
    expect(a.w).toBeCloseTo(b.w);
  });

  it("slerp t=0.5", () => {
    const a = new Quat(0, 0, 0, 1);
    const b = new Quat().setFromAxisAngle({ x: 0, y: 1, z: 0 }, Math.PI / 2);
    a.slerp(b, 0.5);
    // Halfway between identity and 90° Y rotation
    const expected = new Quat().setFromAxisAngle({ x: 0, y: 1, z: 0 }, Math.PI / 4);
    expect(a.x).toBeCloseTo(expected.x, 4);
    expect(a.y).toBeCloseTo(expected.y, 4);
    expect(a.z).toBeCloseTo(expected.z, 4);
    expect(a.w).toBeCloseTo(expected.w, 4);
  });

  it("slerp near-identical quaternions", () => {
    const a = new Quat(0, 0, 0, 1);
    const b = new Quat(0, 0, 0.0001, 1).normalize();
    a.slerp(b, 0.5);
    expect(a.length()).toBeCloseTo(1);
  });

  it("rotateTowards", () => {
    const a = new Quat(0, 0, 0, 1);
    const b = new Quat().setFromAxisAngle({ x: 0, y: 1, z: 0 }, Math.PI);
    a.rotateTowards(b, Math.PI / 4);
    const angle = a.angleTo(new Quat(0, 0, 0, 1));
    expect(angle).toBeCloseTo(Math.PI / 4, 4);
  });

  it("rotateTowards same quaternion returns this", () => {
    const a = new Quat(0, 0, 0, 1);
    const b = new Quat(0, 0, 0, 1);
    a.rotateTowards(b, 1);
    expect(a.w).toBe(1);
  });

  it("angleTo", () => {
    const a = new Quat(0, 0, 0, 1);
    const b = new Quat().setFromAxisAngle({ x: 0, y: 1, z: 0 }, Math.PI / 2);
    expect(a.angleTo(b)).toBeCloseTo(Math.PI / 2, 4);
  });

  it("normalize", () => {
    const q = new Quat(1, 2, 3, 4);
    q.normalize();
    expect(q.length()).toBeCloseTo(1);
  });

  it("normalize zero quaternion returns identity", () => {
    const q = new Quat(0, 0, 0, 0);
    q.normalize();
    expect(q.x).toBe(0);
    expect(q.y).toBe(0);
    expect(q.z).toBe(0);
    expect(q.w).toBe(1);
  });

  it("invert", () => {
    const q = new Quat(1, 2, 3, 4);
    q.invert();
    expect(q.x).toBe(-1);
    expect(q.y).toBe(-2);
    expect(q.z).toBe(-3);
    expect(q.w).toBe(4);
  });

  it("dot", () => {
    const a = new Quat(1, 0, 0, 0);
    const b = new Quat(1, 0, 0, 0);
    expect(a.dot(b)).toBe(1);
  });

  it("length", () => {
    const q = new Quat(0, 0, 0, 1);
    expect(q.length()).toBe(1);
  });

  it("round-trip: Euler → Quat → Euler", () => {
    const euler = new EulXYZ(0.3, 0.7, 1.1);
    const q = new Quat().setFromEulerXYZ(euler);
    const euler2 = new EulXYZ().setFromQuaternion(q);
    expect(euler2.x).toBeCloseTo(euler.x, 4);
    expect(euler2.y).toBeCloseTo(euler.y, 4);
    expect(euler2.z).toBeCloseTo(euler.z, 4);
  });
});
