import { PerspectiveCamera, Raycaster, Vector3 } from "three";

import { CollisionsManager } from "../collisions/CollisionsManager";
import { remap } from "../helpers/math-helpers";
import { EventHandlerCollection } from "../input/EventHandlerCollection";
import { camValues } from "../tweakpane/blades/cameraFolder";
import { TweakPane } from "../tweakpane/TweakPane";
import { getTweakpaneActive } from "../tweakpane/tweakPaneActivity";

const mouseCameraSensitivity = 20;
const scrollZoomSensitivity = 0.1;
const pinchZoomSensitivity = 0.025;

export class CameraManager {
  public readonly camera: PerspectiveCamera;

  public initialDistance: number = camValues.initialDistance;
  public minDistance: number = camValues.minDistance;
  public maxDistance: number = camValues.maxDistance;
  public zoomScale: number = camValues.zoomScale;
  public zoomDamping: number = camValues.zoomDamping;

  public initialFOV: number = camValues.initialFOV;
  public maxFOV: number = camValues.maxFOV;
  public minFOV: number = camValues.minFOV;
  public invertFOVMapping: boolean = camValues.invertFOVMapping;
  public fov: number = this.initialFOV;
  private targetFOV: number = this.initialFOV;

  public minPolarAngle: number = Math.PI * 0.25;
  private maxPolarAngle: number = Math.PI * 0.95;

  public distance: number = this.initialDistance;
  public targetDistance: number = this.initialDistance;
  public desiredDistance: number = this.initialDistance;

  private phi: number = Math.PI / 2;
  private theta: number = Math.PI / 2;

  private target: Vector3 = new Vector3(0, 1.55, 0);
  private hadTarget: boolean = false;

  private rayCaster: Raycaster;

  private eventHandlerCollection: EventHandlerCollection;

  private finalTarget: Vector3 = new Vector3();
  private isLerping: boolean = false;
  private lerpTarget: Vector3 = new Vector3();
  private lerpFactor: number = 0;
  private lerpDuration: number = 2.1;

  private activePointers = new Map<number, { x: number; y: number }>();

  constructor(
    private targetElement: HTMLElement,
    private collisionsManager: CollisionsManager,
    initialPhi = Math.PI / 2,
    initialTheta = -Math.PI / 2,
  ) {
    this.targetElement.style.touchAction = "pinch-zoom";
    this.phi = initialPhi;
    this.theta = initialTheta;
    this.camera = new PerspectiveCamera(this.fov, window.innerWidth / window.innerHeight, 0.1, 400);
    this.camera.position.set(0, 1.4, -this.initialDistance);
    this.rayCaster = new Raycaster();

    this.eventHandlerCollection = EventHandlerCollection.create([
      [targetElement, "pointerdown", this.onMouseDown.bind(this)],
      [targetElement, "gesturestart", this.preventDefaultAndStopPropagation.bind(this)],
      [document, "pointerup", this.onMouseUp.bind(this)],
      [document, "pointercancel", this.onMouseUp.bind(this)],
      [document, "pointermove", this.onMouseMove.bind(this)],
      [targetElement, "wheel", this.onMouseWheel.bind(this)],
      [targetElement, "contextmenu", this.onContextMenu.bind(this)],
    ]);
  }

  private preventDefaultAndStopPropagation(evt: PointerEvent): void {
    evt.preventDefault();
    evt.stopPropagation();
  }

  public setupTweakPane(tweakPane: TweakPane) {
    tweakPane.setupCamPane(this);
  }

  private onMouseDown(event: PointerEvent): void {
    if (event.button === 0 || event.button === 2) {
      // Left or right mouse button

      const pointerInfo = { x: event.clientX, y: event.clientY };
      this.activePointers.set(event.pointerId, pointerInfo);
      document.body.style.cursor = "none";
    }
  }

  private onMouseUp(event: PointerEvent): void {
    const existingPointer = this.activePointers.get(event.pointerId);
    if (existingPointer) {
      this.activePointers.delete(event.pointerId);
      if (this.activePointers.size === 0) {
        document.body.style.cursor = "default";
      }
    }
  }

  private getAveragePointerPositionAndSpread(): { pos: { x: number; y: number }; spread: number } {
    const existingSum = { x: 0, y: 0 };
    this.activePointers.forEach((p) => {
      existingSum.x += p.x;
      existingSum.y += p.y;
    });
    const aX = existingSum.x / this.activePointers.size;
    const aY = existingSum.y / this.activePointers.size;

    let sumOfDistances = 0;
    this.activePointers.forEach((p) => {
      const distance = Math.sqrt((p.x - aX) ** 2 + (p.y - aY) ** 2);
      sumOfDistances += distance;
    });
    return { pos: { x: aX, y: aY }, spread: sumOfDistances / this.activePointers.size };
  }

  private onMouseMove(event: PointerEvent): void {
    if (getTweakpaneActive()) {
      return;
    }

    const existingPointer = this.activePointers.get(event.pointerId);
    if (existingPointer) {
      const previous = this.getAveragePointerPositionAndSpread();

      // Replace the pointer info and recalculate to determine the delta
      existingPointer.x = event.clientX;
      existingPointer.y = event.clientY;

      const latest = this.getAveragePointerPositionAndSpread();

      const sX = latest.pos.x - previous.pos.x;
      const sY = latest.pos.y - previous.pos.y;

      const dx = (sX / this.targetElement.clientWidth) * mouseCameraSensitivity;
      const dy = (sY / this.targetElement.clientHeight) * mouseCameraSensitivity;

      const zoomDelta = latest.spread - previous.spread;
      this.zoom(-zoomDelta * pinchZoomSensitivity);

      this.theta += dx;
      this.phi -= dy;
      this.phi = Math.max(this.minPolarAngle, Math.min(this.maxPolarAngle, this.phi));
      event.preventDefault();
    }
  }

  private onMouseWheel(event: WheelEvent): void {
    if (getTweakpaneActive()) {
      return;
    }
    event.preventDefault();
    const scrollAmount = event.deltaY * this.zoomScale * scrollZoomSensitivity;
    this.zoom(scrollAmount);
  }

  private zoom(delta: number) {
    this.targetDistance += delta;
    this.targetDistance = Math.max(
      this.minDistance,
      Math.min(this.maxDistance, this.targetDistance),
    );
    this.desiredDistance = this.targetDistance;
  }

  private onContextMenu(event: PointerEvent): void {
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

  public reverseUpdateFromPositions(): void {
    const dx = this.camera.position.x - this.target.x;
    const dy = this.camera.position.y - this.target.y;
    const dz = this.camera.position.z - this.target.z;
    this.targetDistance = Math.sqrt(dx * dx + dy * dy + dz * dz);
    this.theta = Math.atan2(dz, dx);
    this.phi = Math.acos(dy / this.targetDistance);
    this.distance = this.targetDistance;
    this.desiredDistance = this.targetDistance;
    this.recomputeFoV(true);
  }

  public adjustCameraPosition(): void {
    const offsetDistance = 0.5;
    const offset = new Vector3(0, 0, offsetDistance);
    offset.applyEuler(this.camera.rotation);
    const rayOrigin = this.camera.position.clone().add(offset);
    const rayDirection = rayOrigin.sub(this.target.clone()).normalize();

    this.rayCaster.set(this.target.clone(), rayDirection);
    const firstRaycastHit = this.collisionsManager.raycastFirst(this.rayCaster.ray);
    const cameraToPlayerDistance = this.camera.position.distanceTo(this.target);

    if (firstRaycastHit !== null && firstRaycastHit[0] <= this.desiredDistance) {
      this.targetDistance = firstRaycastHit[0] - 0.1;
      this.distance = firstRaycastHit[0] - 0.1;
    } else {
      this.targetDistance = this.desiredDistance;
      this.distance = this.desiredDistance;
    }
  }

  public dispose() {
    this.eventHandlerCollection.clear();
    document.body.style.cursor = "";
  }

  private easeOutExpo(x: number): number {
    return x === 1 ? 1 : 1 - Math.pow(2, -10 * x);
  }

  public updateAspect(aspect: number): void {
    this.camera.aspect = aspect;
  }

  public recomputeFoV(immediately: boolean = false): void {
    this.targetFOV = remap(
      this.targetDistance,
      this.minDistance,
      this.maxDistance,
      this.invertFOVMapping ? this.minFOV : this.maxFOV,
      this.invertFOVMapping ? this.maxFOV : this.minFOV,
    );
    if (immediately) {
      this.fov = this.targetFOV;
    }
  }

  public update(): void {
    if (this.isLerping && this.lerpFactor < 1) {
      this.lerpFactor += 0.01 / this.lerpDuration;
      this.lerpFactor = Math.min(1, this.lerpFactor);
      this.target.lerpVectors(this.lerpTarget, this.finalTarget, this.easeOutExpo(this.lerpFactor));
    } else {
      this.adjustCameraPosition();
    }

    if (this.phi !== null && this.theta !== null) {
      this.distance += (this.targetDistance - this.distance) * this.zoomDamping;

      const x = this.target.x + this.distance * Math.sin(this.phi) * Math.cos(this.theta);
      const y = this.target.y + this.distance * Math.cos(this.phi);
      const z = this.target.z + this.distance * Math.sin(this.phi) * Math.sin(this.theta);

      this.recomputeFoV();
      this.fov += (this.targetFOV - this.fov) * this.zoomDamping;
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();

      this.camera.position.set(x, y, z);
      this.camera.lookAt(this.target);

      if (this.isLerping && this.lerpFactor >= 1) {
        this.isLerping = false;
      }
    }
  }

  public hasActiveInput(): boolean {
    return this.activePointers.size > 0;
  }
}
