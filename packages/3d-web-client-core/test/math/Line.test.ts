import { Line, Matr4, Vect3 } from "../../src/math";

describe("Line", () => {
  it("defaults to start and end at origin", () => {
    const l = new Line();
    expect(l.start.x).toBe(0);
    expect(l.end.x).toBe(0);
  });

  it("constructs with start and end", () => {
    const l = new Line({ x: 0, y: 0, z: 0 }, { x: 3, y: 4, z: 0 });
    expect(l.start.x).toBe(0);
    expect(l.end.x).toBe(3);
    expect(l.end.y).toBe(4);
  });

  it("set, setStart, setEnd", () => {
    const l = new Line();
    l.setStart({ x: 1, y: 2, z: 3 });
    l.setEnd({ x: 4, y: 5, z: 6 });
    expect(l.start.x).toBe(1);
    expect(l.end.x).toBe(4);
  });

  it("copy", () => {
    const a = new Line({ x: 1, y: 2, z: 3 }, { x: 4, y: 5, z: 6 });
    const b = new Line().copy(a);
    expect(b.start.x).toBe(1);
    expect(b.end.x).toBe(4);
  });

  it("clone", () => {
    const a = new Line({ x: 1, y: 2, z: 3 }, { x: 4, y: 5, z: 6 });
    const b = a.clone();
    expect(b).not.toBe(a);
    expect(b.start.x).toBe(1);
  });

  it("length and lengthSquared", () => {
    const l = new Line({ x: 0, y: 0, z: 0 }, { x: 3, y: 4, z: 0 });
    expect(l.length()).toBe(5);
    expect(l.lengthSquared()).toBe(25);
  });

  it("distance", () => {
    const l = new Line({ x: 0, y: 0, z: 0 }, { x: 3, y: 4, z: 0 });
    expect(l.distance()).toBe(5);
  });

  it("at t=0 returns start", () => {
    const l = new Line({ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 });
    const target = new Vect3();
    l.at(0, target);
    expect(target.x).toBe(0);
  });

  it("at t=1 returns end", () => {
    const l = new Line({ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 });
    const target = new Vect3();
    l.at(1, target);
    expect(target.x).toBe(10);
  });

  it("at t=0.5 returns midpoint", () => {
    const l = new Line({ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 });
    const target = new Vect3();
    l.at(0.5, target);
    expect(target.x).toBe(5);
  });

  it("delta", () => {
    const l = new Line({ x: 1, y: 2, z: 3 }, { x: 4, y: 6, z: 8 });
    const target = new Vect3();
    l.delta(target);
    expect(target.x).toBe(3);
    expect(target.y).toBe(4);
    expect(target.z).toBe(5);
  });

  it("closestPointToPointParameter — clamped", () => {
    const l = new Line({ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 });
    // Point far before start
    expect(l.closestPointToPointParameter(new Vect3(-5, 0, 0), true)).toBe(0);
    // Point far after end
    expect(l.closestPointToPointParameter(new Vect3(15, 0, 0), true)).toBe(1);
    // Point at midpoint
    expect(l.closestPointToPointParameter(new Vect3(5, 5, 0), true)).toBe(0.5);
  });

  it("closestPointToPointParameter — unclamped", () => {
    const l = new Line({ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 });
    const t = l.closestPointToPointParameter(new Vect3(-5, 0, 0), false);
    expect(t).toBe(-0.5);
  });

  it("closestPointToPoint", () => {
    const l = new Line({ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 });
    const target = new Vect3();
    l.closestPointToPoint(new Vect3(5, 5, 0), true, target);
    expect(target.x).toBe(5);
    expect(target.y).toBe(0);
  });

  it("applyMatrix4", () => {
    const l = new Line({ x: 1, y: 0, z: 0 }, { x: 2, y: 0, z: 0 });
    const m = new Matr4().makeTranslation(10, 0, 0);
    l.applyMatrix4(m);
    expect(l.start.x).toBe(11);
    expect(l.end.x).toBe(12);
  });
});
