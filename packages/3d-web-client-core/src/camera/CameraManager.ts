import { PerspectiveCamera, Raycaster, Vector3 } from "three";

import { CollisionsManager } from "../collisions/CollisionsManager";
import { remap } from "../helpers/math-helpers";
import { EventHandlerCollection } from "../input/EventHandlerCollection";
import { getTweakpaneActive } from "../tweakpane/tweakPaneActivity";

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
  private desiredDistance: number = this.initialDistance;

  private targetPhi: number | null;
  private phi: number | null;
  private targetTheta: number | null;
  private theta: number | null;
  public dragging: boolean = false;

  private target: Vector3 = new Vector3(0, 1.55, 0);
  private hadTarget: boolean = false;

  private rayCaster: Raycaster;

  private eventHandlerCollection: EventHandlerCollection;

  private isLerping: boolean = false;
  private finalTarget: Vector3 = new Vector3();
  private lerpTarget: Vector3 = new Vector3();

  private lerpFactor: number = 0;
  private lerpDuration: number = 2.1;

  constructor(
    targetElement: HTMLElement,
    private collisionsManager: CollisionsManager,
    initialPhi = Math.PI / 2,
    initialTheta = -Math.PI / 2,
  ) {
    this.phi = initialPhi;
    this.targetPhi = initialPhi;
    this.theta = initialTheta;
    this.targetTheta = initialTheta;
    this.camera = new PerspectiveCamera(this.fov, window.innerWidth / window.innerHeight, 0.1, 400);
    this.camera.position.set(0, 1.4, -this.initialDistance);
    this.rayCaster = new Raycaster();
    this.eventHandlerCollection = EventHandlerCollection.create([
      [targetElement, "mousedown", this.onMouseDown.bind(this)],
      [document, "mouseup", this.onMouseUp.bind(this)],
      [document, "mousemove", this.onMouseMove.bind(this)],
      [targetElement, "wheel", this.onMouseWheel.bind(this)],
    ]);
  }

  private onMouseDown(): void {
    this.dragging = true;
  }

  private onMouseUp(_event: MouseEvent): void {
    this.dragging = false;
  }

  private onMouseMove(event: MouseEvent): void {
    if (!this.dragging || getTweakpaneActive()) return;
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
    this.desiredDistance = this.targetDistance;
    event.preventDefault();
  }

  public setTarget(target: Vector3): void {
    if (!this.isLerping) {
      this.target.copy(target);
    } else {
      this.finalTarget.copy(target);
      this.lerpTarget.copy(this.target);
      this.lerpFactor = 0;
    }

    if (!this.hadTarget) {
      this.hadTarget = true;
      this.reverseUpdateFromPositions();
    }
  }

  public setLerpedTarget(target: Vector3, targetDistance: number): void {
    this.isLerping = true;
    this.targetDistance = targetDistance;
    this.desiredDistance = targetDistance;
    this.setTarget(target);
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

  public adjustCameraPosition(): void {
    this.rayCaster.set(
      this.camera.position,
      this.target.clone().sub(this.camera.position).normalize(),
    );
    const minimumDistance = this.collisionsManager.raycastFirstDistance(this.rayCaster.ray);
    const cameraToPlayerDistance = this.camera.position.distanceTo(this.target);

    if (minimumDistance !== null && minimumDistance <= cameraToPlayerDistance) {
      this.targetDistance = cameraToPlayerDistance - minimumDistance;
      this.distance = this.targetDistance;
    } else {
      this.targetDistance += (this.desiredDistance - this.targetDistance) * this.dampingFactor * 4;
    }
  }

  public dispose() {
    this.eventHandlerCollection.clear();
  }

  private easeOutExpo(x: number): number {
    return x === 1 ? 1 : 1 - Math.pow(2, -10 * x);
  }

  public updateAspect(aspect: number): void {
    this.camera.aspect = aspect;
  }

  public update(): void {
    if (this.isLerping && this.lerpFactor < 1) {
      this.lerpFactor += 0.01 / this.lerpDuration;
      this.lerpFactor = Math.min(1, this.lerpFactor);
      this.target.lerpVectors(this.lerpTarget, this.finalTarget, this.easeOutExpo(this.lerpFactor));
    } else {
      this.adjustCameraPosition();
    }

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
      this.fov += (this.targetFOV - this.fov) * this.dampingFactor;
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();

      this.camera.position.set(x, y, z);
      this.camera.lookAt(this.target);

      if (this.isLerping && this.lerpFactor >= 1) {
        this.isLerping = false;
      }
    }
  }
}
