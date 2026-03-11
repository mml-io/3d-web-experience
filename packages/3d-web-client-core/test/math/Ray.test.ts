import { Matr4, Ray, Vect3 } from "../../src/math";

describe("Ray", () => {
  it("defaults to origin (0,0,0) direction (0,0,0)", () => {
    const r = new Ray();
    expect(r.origin.x).toBe(0);
    expect(r.direction.x).toBe(0);
  });

  it("constructs with origin and direction", () => {
    const r = new Ray({ x: 1, y: 2, z: 3 }, { x: 0, y: 0, z: 1 });
    expect(r.origin.x).toBe(1);
    expect(r.direction.z).toBe(1);
  });

  it("set", () => {
    const r = new Ray();
    r.set({ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
    expect(r.origin.x).toBe(1);
    expect(r.direction.y).toBe(1);
  });

  it("setOrigin and setDirection", () => {
    const r = new Ray();
    r.setOrigin({ x: 5, y: 6, z: 7 });
    r.setDirection({ x: 0, y: 0, z: -1 });
    expect(r.origin.x).toBe(5);
    expect(r.direction.z).toBe(-1);
  });

  it("copy", () => {
    const a = new Ray({ x: 1, y: 2, z: 3 }, { x: 0, y: 1, z: 0 });
    const b = new Ray().copy(a);
    expect(b.origin.x).toBe(1);
    expect(b.direction.y).toBe(1);
  });

  it("clone", () => {
    const a = new Ray({ x: 1, y: 2, z: 3 }, { x: 0, y: 1, z: 0 });
    const b = a.clone();
    expect(b).not.toBe(a);
    expect(b.origin.x).toBe(1);
    expect(b.direction.y).toBe(1);
  });

  it("at", () => {
    const r = new Ray({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });
    const target = new Vect3();
    r.at(5, target);
    expect(target.x).toBe(5);
    expect(target.y).toBe(0);
    expect(target.z).toBe(0);
  });

  it("applyMatrix4 — translation", () => {
    const r = new Ray({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });
    const m = new Matr4().makeTranslation(10, 20, 30);
    r.applyMatrix4(m);
    expect(r.origin.x).toBe(10);
    expect(r.origin.y).toBe(20);
    // Direction is normalized after transformDirection, should still point along X
    expect(r.direction.x).toBeCloseTo(1);
  });

  it("intersectTriangle — hit", () => {
    const r = new Ray({ x: 0, y: 0, z: -1 }, { x: 0, y: 0, z: 1 });
    const a = new Vect3(-1, -1, 0);
    const b = new Vect3(1, -1, 0);
    const c = new Vect3(0, 1, 0);
    const target = new Vect3();
    const result = r.intersectTriangle(a, b, c, false, target);
    expect(result).not.toBeNull();
    expect(target.z).toBeCloseTo(0);
  });

  it("intersectTriangle — miss", () => {
    const r = new Ray({ x: 10, y: 10, z: -1 }, { x: 0, y: 0, z: 1 });
    const a = new Vect3(-1, -1, 0);
    const b = new Vect3(1, -1, 0);
    const c = new Vect3(0, 1, 0);
    const target = new Vect3();
    const result = r.intersectTriangle(a, b, c, false, target);
    expect(result).toBeNull();
  });

  it("intersectTriangle — backface culling blocks front-facing", () => {
    // Ray going in +Z direction, triangle normal faces +Z (front face)
    const r = new Ray({ x: 0, y: 0, z: -1 }, { x: 0, y: 0, z: 1 });
    const a = new Vect3(-1, -1, 0);
    const b = new Vect3(1, -1, 0);
    const c = new Vect3(0, 1, 0);
    const target = new Vect3();
    // With backface culling on, DdN > 0 is rejected
    const result = r.intersectTriangle(a, b, c, true, target);
    expect(result).toBeNull();
  });

  it("intersectTriangle — parallel ray returns null", () => {
    const r = new Ray({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });
    const a = new Vect3(0, 0, 0);
    const b = new Vect3(1, 0, 0);
    const c = new Vect3(0, 1, 0);
    const target = new Vect3();
    // Ray is in the plane of the triangle → DdN = 0 → null
    const result = r.intersectTriangle(a, b, c, false, target);
    expect(result).toBeNull();
  });

  it("intersectTriangle — behind origin returns null", () => {
    const r = new Ray({ x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 1 });
    const a = new Vect3(-1, -1, 0);
    const b = new Vect3(1, -1, 0);
    const c = new Vect3(0, 1, 0);
    const target = new Vect3();
    // Triangle is behind the ray
    const result = r.intersectTriangle(a, b, c, false, target);
    expect(result).toBeNull();
  });
});
