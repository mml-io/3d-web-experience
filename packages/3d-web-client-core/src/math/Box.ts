import { Matr4 } from "./Matr4";
import { IVect3, Vect3 } from "./Vect3";

const tempVect3 = new Vect3();

export class Box {
  public min = new Vect3();
  public max = new Vect3();

  constructor(min?: IVect3, max?: IVect3) {
    if (min) {
      this.min.copy(min);
    }
    if (max) {
      this.max.copy(max);
    }
  }

  setStart(min: IVect3): this {
    this.min.copy(min);
    return this;
  }

  setEnd(max: IVect3): this {
    this.max.copy(max);
    return this;
  }

  length(): number {
    const dx = this.max.x - this.min.x;
    const dy = this.max.y - this.min.y;
    const dz = this.max.z - this.min.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  clone(): Box {
    return new Box(this.min, this.max);
  }

  copy(other: Box): this {
    this.min.copy(other.min);
    this.max.copy(other.max);
    return this;
  }

  expandByPoint(point: Vect3): this {
    this.min.min(point);
    this.max.max(point);
    return this;
  }

  makeEmpty(): this {
    this.min.set(Infinity, Infinity, Infinity);
    this.max.set(-Infinity, -Infinity, -Infinity);
    return this;
  }

  isEmpty() {
    return this.max.x < this.min.x || this.max.y < this.min.y || this.max.z < this.min.z;
  }

  applyMatrix4(matr4: Matr4) {
    if (this.isEmpty()) {
      return this;
    }

    this.makeEmpty();

    this.expandByPoint(tempVect3.set(this.min.x, this.min.y, this.min.z).applyMatrix4(matr4));
    this.expandByPoint(tempVect3.set(this.min.x, this.min.y, this.max.z).applyMatrix4(matr4));
    this.expandByPoint(tempVect3.set(this.min.x, this.max.y, this.min.z).applyMatrix4(matr4));
    this.expandByPoint(tempVect3.set(this.min.x, this.max.y, this.max.z).applyMatrix4(matr4));
    this.expandByPoint(tempVect3.set(this.max.x, this.min.y, this.min.z).applyMatrix4(matr4));
    this.expandByPoint(tempVect3.set(this.max.x, this.min.y, this.max.z).applyMatrix4(matr4));
    this.expandByPoint(tempVect3.set(this.max.x, this.max.y, this.min.z).applyMatrix4(matr4));
    this.expandByPoint(tempVect3.set(this.max.x, this.max.y, this.max.z).applyMatrix4(matr4));

    return this;
  }
}
