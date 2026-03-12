import { EulXYZ, Matr4, Quat, Vect3 } from "../../src/math";

describe("Vect3", () => {
  it("defaults to (0,0,0)", () => {
    const v = new Vect3();
    expect(v.x).toBe(0);
    expect(v.y).toBe(0);
    expect(v.z).toBe(0);
  });

  it("constructs with values", () => {
    const v = new Vect3(1, 2, 3);
    expect(v.x).toBe(1);
    expect(v.y).toBe(2);
    expect(v.z).toBe(3);
  });

  it("set", () => {
    const v = new Vect3().set(4, 5, 6);
    expect(v.x).toBe(4);
    expect(v.y).toBe(5);
    expect(v.z).toBe(6);
  });

  it("copy", () => {
    const a = new Vect3(1, 2, 3);
    const b = new Vect3().copy(a);
    expect(b.x).toBe(1);
    expect(b.y).toBe(2);
    expect(b.z).toBe(3);
  });

  it("clone", () => {
    const a = new Vect3(1, 2, 3);
    const b = a.clone();
    expect(b).not.toBe(a);
    expect(b.x).toBe(1);
    expect(b.y).toBe(2);
    expect(b.z).toBe(3);
  });

  it("add", () => {
    const a = new Vect3(1, 2, 3);
    a.add(new Vect3(4, 5, 6));
    expect(a.x).toBe(5);
    expect(a.y).toBe(7);
    expect(a.z).toBe(9);
  });

  it("sub", () => {
    const a = new Vect3(5, 7, 9);
    a.sub(new Vect3(4, 5, 6));
    expect(a.x).toBe(1);
    expect(a.y).toBe(2);
    expect(a.z).toBe(3);
  });

  it("multiply", () => {
    const a = new Vect3(2, 3, 4);
    a.multiply(new Vect3(3, 4, 5));
    expect(a.x).toBe(6);
    expect(a.y).toBe(12);
    expect(a.z).toBe(20);
  });

  it("multiplyScalar", () => {
    const a = new Vect3(1, 2, 3);
    a.multiplyScalar(2);
    expect(a.x).toBe(2);
    expect(a.y).toBe(4);
    expect(a.z).toBe(6);
  });

  it("addScalar", () => {
    const a = new Vect3(1, 2, 3);
    a.addScalar(10);
    expect(a.x).toBe(11);
    expect(a.y).toBe(12);
    expect(a.z).toBe(13);
  });

  it("subScalar", () => {
    const a = new Vect3(11, 12, 13);
    a.subScalar(10);
    expect(a.x).toBe(1);
    expect(a.y).toBe(2);
    expect(a.z).toBe(3);
  });

  it("addScaledVector", () => {
    const a = new Vect3(1, 1, 1);
    a.addScaledVector(new Vect3(1, 2, 3), 2);
    expect(a.x).toBe(3);
    expect(a.y).toBe(5);
    expect(a.z).toBe(7);
  });

  it("length and lengthSquared", () => {
    const v = new Vect3(3, 4, 0);
    expect(v.length()).toBe(5);
    expect(v.lengthSquared()).toBe(25);
  });

  it("normalize", () => {
    const v = new Vect3(0, 0, 5);
    v.normalize();
    expect(v.x).toBe(0);
    expect(v.y).toBe(0);
    expect(v.z).toBe(1);
  });

  it("normalize zero vector returns (0,0,0)", () => {
    const v = new Vect3(0, 0, 0);
    v.normalize();
    expect(v.x).toBe(0);
    expect(v.y).toBe(0);
    expect(v.z).toBe(0);
  });

  it("dot", () => {
    const a = new Vect3(1, 2, 3);
    const b = new Vect3(4, 5, 6);
    expect(a.dot(b)).toBe(32);
  });

  it("cross", () => {
    const a = new Vect3(1, 0, 0);
    const b = new Vect3(0, 1, 0);
    a.cross(b);
    expect(a.x).toBe(0);
    expect(a.y).toBe(0);
    expect(a.z).toBe(1);
  });

  it("crossVectors", () => {
    const result = new Vect3();
    result.crossVectors(new Vect3(0, 1, 0), new Vect3(0, 0, 1));
    expect(result.x).toBe(1);
    expect(result.y).toBe(0);
    expect(result.z).toBe(0);
  });

  it("subVectors", () => {
    const result = new Vect3();
    result.subVectors(new Vect3(5, 7, 9), new Vect3(1, 2, 3));
    expect(result.x).toBe(4);
    expect(result.y).toBe(5);
    expect(result.z).toBe(6);
  });

  it("lerp alpha=0", () => {
    const a = new Vect3(1, 2, 3);
    a.lerp(new Vect3(5, 6, 7), 0);
    expect(a.x).toBe(1);
    expect(a.y).toBe(2);
    expect(a.z).toBe(3);
  });

  it("lerp alpha=1", () => {
    const a = new Vect3(1, 2, 3);
    a.lerp(new Vect3(5, 6, 7), 1);
    expect(a.x).toBe(5);
    expect(a.y).toBe(6);
    expect(a.z).toBe(7);
  });

  it("lerp alpha=0.5", () => {
    const a = new Vect3(0, 0, 0);
    a.lerp(new Vect3(10, 20, 30), 0.5);
    expect(a.x).toBe(5);
    expect(a.y).toBe(10);
    expect(a.z).toBe(15);
  });

  it("lerpVectors", () => {
    const result = new Vect3();
    result.lerpVectors(new Vect3(0, 0, 0), new Vect3(10, 20, 30), 0.5);
    expect(result.x).toBe(5);
    expect(result.y).toBe(10);
    expect(result.z).toBe(15);
  });

  it("min", () => {
    const a = new Vect3(5, 1, 8);
    a.min(new Vect3(2, 3, 4));
    expect(a.x).toBe(2);
    expect(a.y).toBe(1);
    expect(a.z).toBe(4);
  });

  it("max", () => {
    const a = new Vect3(5, 1, 8);
    a.max(new Vect3(2, 3, 4));
    expect(a.x).toBe(5);
    expect(a.y).toBe(3);
    expect(a.z).toBe(8);
  });

  it("distanceTo and distanceToSquared", () => {
    const a = new Vect3(0, 0, 0);
    const b = new Vect3(3, 4, 0);
    expect(a.distanceTo(b)).toBe(5);
    expect(a.distanceToSquared(b)).toBe(25);
  });

  it("applyMatrix4 with translation", () => {
    const m = new Matr4().makeTranslation(10, 20, 30);
    const v = new Vect3(1, 2, 3);
    v.applyMatrix4(m);
    expect(v.x).toBe(11);
    expect(v.y).toBe(22);
    expect(v.z).toBe(33);
  });

  it("applyQuat with identity", () => {
    const v = new Vect3(1, 2, 3);
    v.applyQuat(new Quat(0, 0, 0, 1));
    expect(v.x).toBeCloseTo(1);
    expect(v.y).toBeCloseTo(2);
    expect(v.z).toBeCloseTo(3);
  });

  it("applyQuat with 90-degree Y rotation", () => {
    const q = new Quat().setFromAxisAngle({ x: 0, y: 1, z: 0 }, Math.PI / 2);
    const v = new Vect3(1, 0, 0);
    v.applyQuat(q);
    expect(v.x).toBeCloseTo(0);
    expect(v.y).toBeCloseTo(0);
    expect(v.z).toBeCloseTo(-1);
  });

  it("applyEulerXYZ", () => {
    const v = new Vect3(1, 0, 0);
    v.applyEulerXYZ(new EulXYZ(0, Math.PI / 2, 0));
    expect(v.x).toBeCloseTo(0);
    expect(v.z).toBeCloseTo(-1);
  });

  it("applyAxisAngle", () => {
    const v = new Vect3(1, 0, 0);
    v.applyAxisAngle({ x: 0, y: 1, z: 0 }, Math.PI / 2);
    expect(v.x).toBeCloseTo(0);
    expect(v.z).toBeCloseTo(-1);
  });

  it("transformDirection", () => {
    const m = new Matr4().makeRotationY(Math.PI / 2);
    const v = new Vect3(1, 0, 0);
    v.transformDirection(m);
    expect(v.x).toBeCloseTo(0);
    expect(v.z).toBeCloseTo(-1);
    expect(v.length()).toBeCloseTo(1);
  });

  it("toArray", () => {
    const v = new Vect3(1, 2, 3);
    expect(v.toArray()).toEqual([1, 2, 3]);
  });
});
