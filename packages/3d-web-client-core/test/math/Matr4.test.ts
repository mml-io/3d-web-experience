import { Matr4, Quat, Vect3 } from "../../src/math";

describe("Matr4", () => {
  it("defaults to identity", () => {
    const m = new Matr4();
    expect(m.data).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  });

  it("constructs with values", () => {
    const m = new Matr4(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16);
    // Column-major: row1=[1,2,3,4] means data[0]=1, data[4]=2, data[8]=3, data[12]=4
    expect(m.data[0]).toBe(1);
    expect(m.data[4]).toBe(2);
    expect(m.data[12]).toBe(4);
  });

  it("identity()", () => {
    const m = new Matr4(2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2);
    m.identity();
    expect(m.data).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  });

  it("set", () => {
    const m = new Matr4();
    m.set(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16);
    expect(m.data[0]).toBe(1);
    expect(m.data[5]).toBe(6);
  });

  it("copy", () => {
    const a = new Matr4(2, 0, 0, 0, 0, 3, 0, 0, 0, 0, 4, 0, 0, 0, 0, 1);
    const b = new Matr4().copy(a);
    expect(b.data).toEqual(a.data);
  });

  it("clone", () => {
    const a = new Matr4(2, 0, 0, 0, 0, 3, 0, 0, 0, 0, 4, 0, 0, 0, 0, 1);
    const b = a.clone();
    expect(b).not.toBe(a);
    expect(b.data).toEqual(a.data);
  });

  it("fromArray", () => {
    const data: [
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
    ] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
    const m = new Matr4().fromArray(data);
    expect(m.data).toEqual(data);
  });

  it("equals", () => {
    const a = new Matr4();
    const b = new Matr4();
    expect(a.equals(b)).toBe(true);
    b.data[0] = 2;
    expect(a.equals(b)).toBe(false);
  });

  it("setPosition", () => {
    const m = new Matr4();
    m.setPosition(10, 20, 30);
    expect(m.data[12]).toBe(10);
    expect(m.data[13]).toBe(20);
    expect(m.data[14]).toBe(30);
  });

  it("makeRotationX", () => {
    const m = new Matr4().makeRotationX(Math.PI / 2);
    const v = new Vect3(0, 1, 0).applyMatrix4(m);
    expect(v.x).toBeCloseTo(0);
    expect(v.y).toBeCloseTo(0);
    expect(v.z).toBeCloseTo(1);
  });

  it("makeRotationY", () => {
    const m = new Matr4().makeRotationY(Math.PI / 2);
    const v = new Vect3(1, 0, 0).applyMatrix4(m);
    expect(v.x).toBeCloseTo(0);
    expect(v.z).toBeCloseTo(-1);
  });

  it("makeRotationZ", () => {
    const m = new Matr4().makeRotationZ(Math.PI / 2);
    const v = new Vect3(1, 0, 0).applyMatrix4(m);
    expect(v.x).toBeCloseTo(0);
    expect(v.y).toBeCloseTo(1);
  });

  it("makeTranslation", () => {
    const m = new Matr4().makeTranslation(5, 10, 15);
    expect(m.data[12]).toBe(5);
    expect(m.data[13]).toBe(10);
    expect(m.data[14]).toBe(15);
  });

  it("makeScale", () => {
    const m = new Matr4().makeScale(2, 3, 4);
    const v = new Vect3(1, 1, 1).applyMatrix4(m);
    expect(v.x).toBe(2);
    expect(v.y).toBe(3);
    expect(v.z).toBe(4);
  });

  it("compose and decompose round-trip", () => {
    const pos = { x: 1, y: 2, z: 3 };
    const quat = new Quat().setFromAxisAngle({ x: 0, y: 1, z: 0 }, Math.PI / 4);
    const scale = { x: 2, y: 3, z: 4 };

    const m = new Matr4().compose(pos, quat, scale);

    const outPos = { x: 0, y: 0, z: 0 };
    const outQuat = { x: 0, y: 0, z: 0, w: 0 };
    const outScale = { x: 0, y: 0, z: 0 };

    m.decompose(outPos, outQuat, outScale);

    expect(outPos.x).toBeCloseTo(1);
    expect(outPos.y).toBeCloseTo(2);
    expect(outPos.z).toBeCloseTo(3);

    expect(outQuat.x).toBeCloseTo(quat.x);
    expect(outQuat.y).toBeCloseTo(quat.y);
    expect(outQuat.z).toBeCloseTo(quat.z);
    expect(outQuat.w).toBeCloseTo(quat.w);

    expect(outScale.x).toBeCloseTo(2);
    expect(outScale.y).toBeCloseTo(3);
    expect(outScale.z).toBeCloseTo(4);
  });

  it("multiply identity * identity = identity", () => {
    const a = new Matr4();
    const b = new Matr4();
    a.multiply(b);
    expect(a.equals(new Matr4())).toBe(true);
  });

  it("multiply two matrices", () => {
    const a = new Matr4().makeTranslation(1, 0, 0);
    const b = new Matr4().makeTranslation(0, 1, 0);
    a.multiply(b);
    // Combined translation: (1, 1, 0)
    expect(a.data[12]).toBeCloseTo(1);
    expect(a.data[13]).toBeCloseTo(1);
  });

  it("premultiply", () => {
    const a = new Matr4().makeScale(2, 2, 2);
    const b = new Matr4().makeTranslation(1, 0, 0);
    a.premultiply(b);
    // b * a = translate then scale
    const result = new Matr4().multiplyMatrices(b, new Matr4().makeScale(2, 2, 2));
    expect(a.equals(result)).toBe(true);
  });

  it("determinant of identity is 1", () => {
    expect(new Matr4().determinant()).toBe(1);
  });

  it("determinant of scale matrix", () => {
    const m = new Matr4().makeScale(2, 3, 4);
    expect(m.determinant()).toBeCloseTo(24);
  });

  it("invert", () => {
    const m = new Matr4().makeTranslation(5, 10, 15);
    const inv = m.clone().invert();
    const result = new Matr4().multiplyMatrices(m, inv);
    expect(result.equals(new Matr4())).toBe(true);
  });

  it("invert singular matrix returns zeros", () => {
    const m = new Matr4().set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
    m.invert();
    for (let i = 0; i < 16; i++) {
      expect(m.data[i]).toBe(0);
    }
  });

  it("getScale", () => {
    const m = new Matr4().compose(
      { x: 0, y: 0, z: 0 },
      new Quat().setFromAxisAngle({ x: 0, y: 1, z: 0 }, 0.5),
      { x: 2, y: 3, z: 4 },
    );
    const scale = { x: 0, y: 0, z: 0 };
    m.getScale(scale);
    expect(scale.x).toBeCloseTo(2);
    expect(scale.y).toBeCloseTo(3);
    expect(scale.z).toBeCloseTo(4);
  });

  it("setRotationFromQuaternion", () => {
    const q = new Quat().setFromAxisAngle({ x: 0, y: 1, z: 0 }, Math.PI / 2);
    const m = new Matr4().setRotationFromQuaternion(q);
    // Position should be zeros, scale = 1
    expect(m.data[12]).toBe(0);
    expect(m.data[13]).toBe(0);
    expect(m.data[14]).toBe(0);
  });
});
