import { Box, Matr4, Vect3 } from "../../src/math";

describe("Box", () => {
  it("defaults to min and max at origin", () => {
    const b = new Box();
    expect(b.min.x).toBe(0);
    expect(b.max.x).toBe(0);
  });

  it("constructs with min and max", () => {
    const b = new Box({ x: -1, y: -1, z: -1 }, { x: 1, y: 1, z: 1 });
    expect(b.min.x).toBe(-1);
    expect(b.max.x).toBe(1);
  });

  it("setStart and setEnd", () => {
    const b = new Box();
    b.setStart({ x: -2, y: -2, z: -2 });
    b.setEnd({ x: 2, y: 2, z: 2 });
    expect(b.min.x).toBe(-2);
    expect(b.max.x).toBe(2);
  });

  it("copy", () => {
    const a = new Box({ x: -1, y: -1, z: -1 }, { x: 1, y: 1, z: 1 });
    const b = new Box().copy(a);
    expect(b.min.x).toBe(-1);
    expect(b.max.x).toBe(1);
  });

  it("clone", () => {
    const a = new Box({ x: -1, y: -1, z: -1 }, { x: 1, y: 1, z: 1 });
    const b = a.clone();
    expect(b).not.toBe(a);
    expect(b.min.x).toBe(-1);
    expect(b.max.x).toBe(1);
  });

  it("makeEmpty and isEmpty", () => {
    const b = new Box({ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 });
    expect(b.isEmpty()).toBe(false);
    b.makeEmpty();
    expect(b.isEmpty()).toBe(true);
    expect(b.min.x).toBe(Infinity);
    expect(b.max.x).toBe(-Infinity);
  });

  it("expandByPoint", () => {
    const b = new Box().makeEmpty();
    b.expandByPoint(new Vect3(1, 2, 3));
    b.expandByPoint(new Vect3(-1, -2, -3));
    expect(b.min.x).toBe(-1);
    expect(b.min.y).toBe(-2);
    expect(b.max.x).toBe(1);
    expect(b.max.y).toBe(2);
  });

  it("union", () => {
    const a = new Box({ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 });
    const b = new Box({ x: -1, y: -1, z: -1 }, { x: 0, y: 0, z: 0 });
    a.union(b);
    expect(a.min.x).toBe(-1);
    expect(a.max.x).toBe(1);
  });

  it("length", () => {
    const b = new Box({ x: 0, y: 0, z: 0 }, { x: 3, y: 4, z: 0 });
    expect(b.length()).toBe(5);
  });

  it("applyMatrix4 — translation", () => {
    const b = new Box({ x: -1, y: -1, z: -1 }, { x: 1, y: 1, z: 1 });
    const m = new Matr4().makeTranslation(10, 0, 0);
    b.applyMatrix4(m);
    expect(b.min.x).toBeCloseTo(9);
    expect(b.max.x).toBeCloseTo(11);
  });

  it("applyMatrix4 — empty box returns early", () => {
    const b = new Box().makeEmpty();
    const m = new Matr4().makeTranslation(10, 0, 0);
    b.applyMatrix4(m);
    // Should still be empty
    expect(b.isEmpty()).toBe(true);
  });
});
