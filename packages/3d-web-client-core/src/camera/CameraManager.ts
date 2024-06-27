import { PerspectiveCamera, Raycaster, Vector3 } from "three";

import { CollisionsManager } from "../collisions/CollisionsManager";
import { remap } from "../helpers/math-helpers";
import { EventHandlerCollection } from "../input/EventHandlerCollection";
import { VirtualJoystick } from "../input/VirtualJoystick";
import { camValues } from "../tweakpane/blades/cameraFolder";
import { TweakPane } from "../tweakpane/TweakPane";
import { getTweakpaneActive } from "../tweakpane/tweakPaneActivity";

export class CameraManager {
  public readonly camera: PerspectiveCamera;

  public initialDistance: number = camValues.initialDistance;
  public minDistance: number = camValues.minDistance;
  public maxDistance: number = camValues.maxDistance;
  public initialFOV: number = camValues.initialFOV;
  public maxFOV: number = camValues.maxFOV;
  public minFOV: number = camValues.minFOV;
  public damping: number = camValues.damping;
  public dampingScale: number = 0.01;
  public zoomScale: number = camValues.zoomScale;
  public zoomDamping: number = camValues.zoomDamping;
  public invertFOVMapping: boolean = camValues.invertFOVMapping;
  public fov: number = this.initialFOV;

  private targetFOV: number = this.initialFOV;

  public minPolarAngle: number = Math.PI * 0.25;
  private maxPolarAngle: number = Math.PI * 0.95;

  public targetDistance: number = this.initialDistance;
  public distance: number = this.initialDistance;
  public desiredDistance: number = this.initialDistance;

  private targetPhi: number | null;
  private phi: number = Math.PI / 2;
  private targetTheta: number | null;
  private theta: number = Math.PI / 2;
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

  private hasTouchControl: boolean = false;
  private lastTouchX: number = 0;
  private lastTouchY: number = 0;

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

    this.hasTouchControl = VirtualJoystick.checkForTouch();

    this.eventHandlerCollection = EventHandlerCollection.create([
      [targetElement, "mousedown", this.onMouseDown.bind(this)],
      [document, "mouseup", this.onMouseUp.bind(this)],
      [document, "mousemove", this.onMouseMove.bind(this)],
      [targetElement, "wheel", this.onMouseWheel.bind(this)],
      [targetElement, "contextmenu", this.onContextMenu.bind(this)],
    ]);

    if (this.hasTouchControl) {
      this.eventHandlerCollection.add(targetElement, "touchstart", this.onTouchStart.bind(this), {
        passive: false,
      });
      this.eventHandlerCollection.add(document, "touchmove", this.onTouchMove.bind(this), {
        passive: false,
      });
      this.eventHandlerCollection.add(document, "touchend", this.onTouchEnd.bind(this), {
        passive: false,
      });
    }
  }

  public setupTweakPane(tweakPane: TweakPane) {
    tweakPane.setupCamPane(this);
  }

  private onTouchStart(evt: TouchEvent): void {
    Array.from(evt.touches).forEach((touch) => {
      this.dragging = true;
      this.lastTouchX = touch.clientX;
      this.lastTouchY = touch.clientY;
    });
  }

  private onTouchMove(evt: TouchEvent): void {
    if (!this.dragging || getTweakpaneActive()) {
      return;
    }
    evt.preventDefault();

    // TODO - handle multi-touch correctly
    const touch = Array.from(evt.touches).find((t) => true);
    if (touch) {
      const dx = touch.clientX - this.lastTouchX;
      const dy = touch.clientY - this.lastTouchY;
      this.lastTouchX = touch.clientX;
      this.lastTouchY = touch.clientY;

      if (this.targetTheta !== null && this.targetPhi !== null) {
        this.targetTheta += dx * this.dampingScale;
        this.targetPhi -= dy * this.dampingScale;
        this.targetPhi = Math.max(this.minPolarAngle, Math.min(this.maxPolarAngle, this.targetPhi));
      }
    }
  }

  private onTouchEnd(evt: TouchEvent): void {
    if (this.dragging) {
      // TODO - handle multi-touch correctly
      const touchEnded = Array.from(evt.changedTouches).some((t) => true);
      if (touchEnded) {
        this.dragging = false;
      }
    }
  }

  private onMouseDown(event: MouseEvent): void {
    if (event.button === 0 || event.button === 2) {
      // Left or right mouse button
      this.dragging = true;
      document.body.style.cursor = "none";
    }
  }

  private onMouseUp(event: MouseEvent): void {
    if (event.button === 0 || event.button === 2) {
      this.dragging = false;
      document.body.style.cursor = "default";
    }
  }

  private onMouseMove(event: MouseEvent): void {
    if (getTweakpaneActive()) {
      return;
    }
    if (this.dragging) {
      if (this.targetTheta === null || this.targetPhi === null) return;
      this.targetTheta += event.movementX * this.dampingScale;
      this.targetPhi -= event.movementY * this.dampingScale;
      this.targetPhi = Math.max(this.minPolarAngle, Math.min(this.maxPolarAngle, this.targetPhi));
      event.preventDefault();
    }
  }

  private onMouseWheel(event: WheelEvent): void {
    if (getTweakpaneActive()) {
      return;
    }
    const scrollAmount = event.deltaY * this.zoomScale * 0.1;
    this.targetDistance += scrollAmount;
    this.targetDistance = Math.max(
      this.minDistance,
      Math.min(this.maxDistance, this.targetDistance),
    );
    this.desiredDistance = this.targetDistance;
    event.preventDefault();
  }

  private onContextMenu(event: MouseEvent): void {
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
    this.targetTheta = Math.atan2(dz, dx);
    this.targetPhi = Math.acos(dy / this.targetDistance);
    this.phi = this.targetPhi;
    this.theta = this.targetTheta;
    this.distance = this.targetDistance;
    this.desiredDistance = this.targetDistance;
    this.recomputeFoV(true);
  }

  public adjustCameraPosition(): void {
    const offsetDistance = 0.5;
    const offset = new Vector3(0, 0, offsetDistance);
    offset.applyEuler(this.camera.rotation);
    const rayOrigin = this.camera.position.clone().add(offset);
    const rayDirection = this.target.clone().sub(rayOrigin).normalize();

    this.rayCaster.set(rayOrigin, rayDirection);
    const firstRaycastHit = this.collisionsManager.raycastFirst(this.rayCaster.ray);
    const cameraToPlayerDistance = this.camera.position.distanceTo(this.target);

    if (firstRaycastHit !== null && firstRaycastHit[0] <= cameraToPlayerDistance) {
      this.targetDistance = cameraToPlayerDistance - firstRaycastHit[0];
      this.distance = this.targetDistance;
    } else {
      this.targetDistance += (this.desiredDistance - this.targetDistance) * this.damping * 4;
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

    if (
      this.phi !== null &&
      this.targetPhi !== null &&
      this.theta !== null &&
      this.targetTheta !== null
    ) {
      this.distance +=
        (this.targetDistance - this.distance) * this.damping * (0.21 + this.zoomDamping);
      this.phi += (this.targetPhi - this.phi) * this.damping;
      this.theta += (this.targetTheta - this.theta) * this.damping;

      const x = this.target.x + this.distance * Math.sin(this.phi) * Math.cos(this.theta);
      const y = this.target.y + this.distance * Math.cos(this.phi);
      const z = this.target.z + this.distance * Math.sin(this.phi) * Math.sin(this.theta);

      this.recomputeFoV();
      this.fov += (this.targetFOV - this.fov) * this.damping;
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
