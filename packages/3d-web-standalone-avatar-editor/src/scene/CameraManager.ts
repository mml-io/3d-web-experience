import { PerspectiveCamera, Raycaster, Vector3 } from "three";

export const round = (n: number, digits: number): number => {
  return Number(n.toFixed(digits));
};

export const ease = (target: number, n: number, factor: number): number => {
  return round((target - n) * factor, 5);
};

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export const remap = (
  value: number,
  minValue: number,
  maxValue: number,
  minScaledValue: number,
  maxScaledValue: number,
): number => {
  return (
    minScaledValue +
    ((maxScaledValue - minScaledValue) * (value - minValue)) / (maxValue - minValue)
  );
};

export class CameraManager {
  public readonly camera: PerspectiveCamera;

  public initialDistance: number = 3.3;

  private minDistance: number = 0.1;
  private maxDistance: number = 8;

  private initialFOV: number = 60;
  private fov: number = this.initialFOV;
  private minFOV: number = 50;
  private maxFOV: number = 70;
  private targetFOV: number = this.initialFOV;

  private minPolarAngle: number = Math.PI * 0.25;
  private maxPolarAngle: number = Math.PI * 0.95;

  private dampingFactor: number = 0.091;

  public targetDistance: number = this.initialDistance;
  private distance: number = this.initialDistance;

  private targetPhi: number | null;
  private phi: number | null;
  private targetTheta: number | null;
  private theta: number | null;
  public dragging: boolean = false;

  private target: Vector3 = new Vector3(0, 1.55, 0);

  private hadTarget: boolean = false;

  constructor(initialPhi = Math.PI / 2, initialTheta = -Math.PI / 2) {
    this.phi = initialPhi;
    this.targetPhi = initialPhi;
    this.theta = initialTheta;
    this.targetTheta = initialTheta;
    this.camera = new PerspectiveCamera(this.fov, window.innerWidth / window.innerHeight, 0.1, 400);
    this.camera.position.set(0, 1.4, -this.initialDistance);
    window.addEventListener("mousedown", this.onMouseDown.bind(this));
    window.addEventListener("mouseup", this.onMouseUp.bind(this));
    window.addEventListener("mousemove", this.onMouseMove.bind(this));
  }

  private onMouseDown(): void {
    this.dragging = true;
  }

  private onMouseUp(_event: MouseEvent): void {
    this.dragging = false;
  }

  private onMouseMove(event: MouseEvent): void {
    if (!this.dragging) return;
    if (this.targetTheta === null || this.targetPhi === null) return;
    this.targetTheta += event.movementX * 0.01;
    this.targetPhi -= event.movementY * 0.01;
    this.targetPhi = Math.max(this.minPolarAngle, Math.min(this.maxPolarAngle, this.targetPhi));
    event.preventDefault();
  }

  private onMouseWheel(event: WheelEvent): void {
    const scrollAmount = event.deltaY * 0.001;
    this.targetDistance += scrollAmount;
    this.targetDistance = Math.max(
      this.minDistance,
      Math.min(this.maxDistance, this.targetDistance),
    );
    event.preventDefault();
  }

  public setTarget(target: Vector3): void {
    this.target.copy(target);
    if (!this.hadTarget) {
      this.hadTarget = true;
      this.reverseUpdateFromPositions();
    }
  }

  private reverseUpdateFromPositions(): void {
    if (this.phi === null || this.theta == null) return;
    const dx = this.camera.position.x - this.target.x;
    const dy = this.camera.position.y - this.target.y;
    const dz = this.camera.position.z - this.target.z;
    this.targetDistance = Math.sqrt(dx * dx + dy * dy + dz * dz);
    this.targetTheta = (this.theta + 2 * Math.PI) % (2 * Math.PI);
    this.targetPhi = Math.max(0, Math.min(Math.PI, this.phi));
    this.phi = this.targetPhi;
    this.theta = this.targetTheta;
    this.distance = this.targetDistance;
  }

  public update(): void {
    if (this.target === null) return;
    if (
      this.phi !== null &&
      this.targetPhi !== null &&
      this.theta !== null &&
      this.targetTheta !== null
    ) {
      this.distance += (this.targetDistance - this.distance) * this.dampingFactor * 0.21;
      this.phi += (this.targetPhi - this.phi) * this.dampingFactor;
      this.theta += (this.targetTheta - this.theta) * this.dampingFactor;

      const x = this.target.x + this.distance * Math.sin(this.phi) * Math.cos(this.theta);
      const y = this.target.y + this.distance * Math.cos(this.phi);
      const z = this.target.z + this.distance * Math.sin(this.phi) * Math.sin(this.theta);

      this.targetFOV = remap(
        this.targetDistance,
        this.minDistance,
        this.maxDistance,
        this.minFOV,
        this.maxFOV,
      );

      this.fov += ease(this.targetFOV, this.fov, 0.07);
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
      this.camera.updateMatrixWorld();

      this.camera.position.set(x, clamp(y, 0.1, Infinity), z);
      this.camera.lookAt(this.target);
    }
  }
}
