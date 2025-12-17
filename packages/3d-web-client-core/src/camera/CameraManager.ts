import { CollisionsManager } from "../collisions/CollisionsManager";
import { remap } from "../helpers/math-helpers";
import { EventHandlerCollection } from "../input/EventHandlerCollection";
import { Matr4, Quat, Ray, Vect3 } from "../math";
import { getTweakpaneActive } from "../tweakpane/tweakPaneActivity";

export type CameraState = {
  position: Vect3;
  rotation: Quat;
  fov: number;
  aspect: number;
};

const cameraPanSensitivity = 20;
const scrollZoomSensitivity = 0.1;
const pinchZoomSensitivity = 0.025;

export class CameraManager {
  private isMainCameraActive: boolean = true;

  public initialDistance = 3.3;
  public minDistance = 0.1;
  public maxDistance = 5;
  public damping = 0.21;
  public zoomScale = 0.04;
  public zoomDamping = 0.04;

  public initialFOV = 60;
  public maxFOV = 70;
  public minFOV = 60;
  public invertFOVMapping = false;

  public fov: number = this.initialFOV;
  private targetFOV: number = this.initialFOV;

  public minPolarAngle: number = Math.PI * 0.05;
  private maxPolarAngle: number = Math.PI * 0.95;

  public distance: number = this.initialDistance;
  public targetDistance: number = this.initialDistance;
  public desiredDistance: number = this.initialDistance;

  private phi: number;
  private targetPhi: number;
  private theta: number;
  private targetTheta: number;

  private target: Vect3 = new Vect3(0, 1.55, 0);
  private hadTarget: boolean = false;

  private cameraRay: Ray = new Ray();
  private tempVec3: Vect3 = new Vect3();

  private eventHandlerCollection: EventHandlerCollection;

  private finalTarget: Vect3 = new Vect3();
  private isLerping: boolean = false;
  private lerpTarget: Vect3 = new Vect3();
  private lerpFactor: number = 0;
  private lerpDuration: number = 2.1;

  private tempMatr4: Matr4 = new Matr4();

  private activePointers = new Map<number, { x: number; y: number }>();

  private cameraState: CameraState;
  private flyCameraState: CameraState;
  private aspect: number;

  // Fly camera orbit controls state
  private flyCameraLookAt: Vect3 = new Vect3(0, 0, 0);
  private flyCameraYaw: number = 0;
  private flyCameraPitch: number = Math.PI * 0.4;
  private flyCameraDistance: number = 15.0;
  private flyCameraMouseDown: boolean = false;
  private flyCameraIsPanning: boolean = false;
  private flyCameraLastMouseX: number = 0;
  private flyCameraLastMouseY: number = 0;
  private flyCameraEventHandlerCollection: EventHandlerCollection | null = null;

  // Orbit controls settings
  private orbitControlsRotateSensitivity: number = 0.002;
  private orbitControlsPanSensitivity: number = 0.01;
  private orbitControlsZoomSensitivity: number = 0.1;
  // Polar angle constraints: 0 = camera above lookAt (looking down), π = camera below lookAt (looking up)
  // Constrain to prevent going over the top (pitch < 0) but allow pointing above horizon (pitch > π/2)
  private orbitControlsMinPolarAngle: number = 0.001; // Just above 0 to prevent going over the top
  private orbitControlsMaxPolarAngle: number = Math.PI - 0.001; // Just below π to allow looking up

  // Temporary vectors for panning calculations
  private tempPanRight: Vect3 = new Vect3();
  private tempPanUp: Vect3 = new Vect3();
  private tempPanForward: Vect3 = new Vect3();

  constructor(
    private targetElement: HTMLElement,
    private collisionsManager: CollisionsManager,
    initialPhi = Math.PI / 2,
    initialTheta = -Math.PI / 2,
  ) {
    this.targetElement.style.touchAction = "pinch-zoom";
    this.phi = initialPhi;
    this.targetPhi = this.phi;
    this.theta = initialTheta;
    this.targetTheta = this.theta;

    this.aspect = window.innerWidth / window.innerHeight;

    const initialPosition = new Vect3(0, 1.4, -this.initialDistance);
    const initialRotation = new Quat();

    this.cameraState = {
      position: initialPosition,
      rotation: initialRotation,
      fov: this.fov,
      aspect: this.aspect,
    };

    this.flyCameraState = {
      position: new Vect3().copy(initialPosition),
      rotation: new Quat().copy(initialRotation),
      fov: this.initialFOV,
      aspect: this.aspect,
    };

    this.createEventHandlers();
  }

  private createEventHandlers(): void {
    this.eventHandlerCollection = EventHandlerCollection.create([
      [this.targetElement, "pointerdown", this.onPointerDown.bind(this)],
      [this.targetElement, "gesturestart", this.preventDefaultAndStopPropagation.bind(this)],
      [this.targetElement, "wheel", this.onMouseWheel.bind(this)],
      [this.targetElement, "contextmenu", this.onContextMenu.bind(this)],
      [document, "pointerup", this.onPointerUp.bind(this)],
      [document, "pointercancel", this.onPointerUp.bind(this)],
      [document, "pointermove", this.onPointerMove.bind(this)],
    ]);
  }

  private disposeEventHandlers(): void {
    this.eventHandlerCollection.clear();
  }

  private createFlyCameraEventHandlers(): void {
    this.flyCameraEventHandlerCollection = EventHandlerCollection.create([
      [window, "blur", this.onFlyCameraBlur.bind(this)],
      [this.targetElement, "mousedown", this.onFlyCameraMouseDown.bind(this)],
      [document, "mousemove", this.onFlyCameraMouseMove.bind(this)],
      [document, "mouseup", this.onFlyCameraMouseUp.bind(this)],
      [this.targetElement, "wheel", this.onFlyCameraWheel.bind(this)],
      [this.targetElement, "contextmenu", this.onContextMenu.bind(this)],
    ]);
  }

  private disposeFlyCameraEventHandlers(): void {
    if (this.flyCameraEventHandlerCollection) {
      this.flyCameraEventHandlerCollection.clear();
      this.flyCameraEventHandlerCollection = null;
    }
  }

  private onFlyCameraBlur(): void {
    this.flyCameraMouseDown = false;
    this.flyCameraIsPanning = false;
  }

  private onFlyCameraMouseDown(event: MouseEvent): void {
    if (event.button === 0) {
      // Left mouse button - rotate
      this.flyCameraMouseDown = true;
      this.flyCameraIsPanning = false;
      this.flyCameraLastMouseX = event.clientX;
      this.flyCameraLastMouseY = event.clientY;
      document.body.style.cursor = "none";
      event.preventDefault();
    } else if (event.button === 1 || event.button === 2) {
      // Middle or right mouse button - pan
      this.flyCameraMouseDown = true;
      this.flyCameraIsPanning = true;
      this.flyCameraLastMouseX = event.clientX;
      this.flyCameraLastMouseY = event.clientY;
      document.body.style.cursor = "move";
      event.preventDefault();
    }
  }

  private onFlyCameraMouseUp(event: MouseEvent): void {
    this.flyCameraMouseDown = false;
    this.flyCameraIsPanning = false;
    document.body.style.cursor = "default";
  }

  private onFlyCameraMouseMove(event: MouseEvent): void {
    if (!this.flyCameraMouseDown || getTweakpaneActive()) {
      return;
    }

    const movementX =
      event.movementX !== undefined ? event.movementX : event.clientX - this.flyCameraLastMouseX;
    const movementY =
      event.movementY !== undefined ? event.movementY : event.clientY - this.flyCameraLastMouseY;

    if (this.flyCameraIsPanning) {
      // Pan the lookAt target
      this.panFlyCameraLookAt(movementX, movementY);
    } else {
      // Rotate around lookAt target
      this.flyCameraYaw -= movementX * this.orbitControlsRotateSensitivity;
      this.flyCameraPitch -= movementY * this.orbitControlsRotateSensitivity;

      this.flyCameraYaw = this.flyCameraYaw % (Math.PI * 2);
      this.flyCameraPitch = Math.max(
        this.orbitControlsMinPolarAngle,
        Math.min(this.orbitControlsMaxPolarAngle, this.flyCameraPitch),
      );
    }

    this.flyCameraLastMouseX = event.clientX;
    this.flyCameraLastMouseY = event.clientY;
    event.preventDefault();
  }

  private panFlyCameraLookAt(deltaX: number, deltaY: number): void {
    // Calculate camera's forward direction (from camera to lookAt)
    const sinPhi = Math.sin(this.flyCameraPitch);
    const cosPhi = Math.cos(this.flyCameraPitch);
    const sinTheta = Math.sin(this.flyCameraYaw);
    const cosTheta = Math.cos(this.flyCameraYaw);

    // Forward vector (from camera position towards lookAt)
    this.tempPanForward.set(-sinPhi * sinTheta, -cosPhi, -sinPhi * cosTheta).normalize();

    // World up vector
    const worldUp = new Vect3(0, 1, 0);

    // Right vector = forward × worldUp (perpendicular to forward and world up)
    this.tempPanRight.copy(this.tempPanForward).cross(worldUp).normalize();

    // If forward is parallel to world up, use a different approach
    if (this.tempPanRight.lengthSquared() < 0.01) {
      // Camera is looking straight up or down, use yaw-based right vector
      this.tempPanRight.set(cosTheta, 0, -sinTheta).normalize();
    }

    // Up vector = right × forward (perpendicular to both)
    this.tempPanUp.copy(this.tempPanRight).cross(this.tempPanForward).normalize();

    // Pan distance is proportional to camera distance
    const panDistance = this.flyCameraDistance * this.orbitControlsPanSensitivity;

    // Move lookAt target along camera's right and up vectors
    // Clone vectors before scaling to avoid mutation
    const panRight = this.tempPanRight.clone().multiplyScalar(-deltaX * panDistance);
    const panUp = this.tempPanUp.clone().multiplyScalar(deltaY * panDistance);

    this.flyCameraLookAt.add(panRight);
    this.flyCameraLookAt.add(panUp);
  }

  private onFlyCameraWheel(event: WheelEvent): void {
    if (getTweakpaneActive()) {
      return;
    }
    event.preventDefault();
    this.flyCameraDistance += event.deltaY * this.orbitControlsZoomSensitivity;
    this.flyCameraDistance = Math.max(0.01, Math.min(this.flyCameraDistance, 1000));
  }

  private preventDefaultAndStopPropagation(evt: PointerEvent): void {
    evt.preventDefault();
    evt.stopPropagation();
  }

  private onPointerDown(event: PointerEvent): void {
    if (event.button === 0 || event.button === 2) {
      // Left or right mouse button

      const pointerInfo = { x: event.clientX, y: event.clientY };
      this.activePointers.set(event.pointerId, pointerInfo);
      document.body.style.cursor = "none";
    }
  }

  private onPointerUp(event: PointerEvent): void {
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

  private onPointerMove(event: PointerEvent): void {
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

      const dx = (sX / this.targetElement.clientWidth) * cameraPanSensitivity;
      const dy = (sY / this.targetElement.clientHeight) * cameraPanSensitivity;

      if (this.activePointers.size > 1) {
        const zoomDelta = latest.spread - previous.spread;
        this.zoom(-zoomDelta * pinchZoomSensitivity);
      }

      this.targetTheta += dx;
      this.targetPhi -= dy;
      this.targetPhi = Math.max(this.minPolarAngle, Math.min(this.maxPolarAngle, this.targetPhi));
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

  public setTarget(target: Vect3): void {
    if (!this.isLerping) {
      this.target.copy(target);
    } else {
      this.finalTarget.copy(target);
      this.lerpTarget.copy(this.target);
      this.lerpFactor = 0;
    }

    if (!this.hadTarget) {
      this.hadTarget = true;
      this.reverseUpdateFromPositions(this.cameraState.position, this.cameraState.rotation);
    }
  }

  public setLerpedTarget(target: Vect3, targetDistance: number): void {
    this.isLerping = true;
    this.targetDistance = targetDistance;
    this.desiredDistance = targetDistance;
    this.setTarget(target);
  }

  public reverseUpdateFromPositions(position: Vect3, rotation: Quat): void {
    const dx = position.x - this.target.x;
    const dy = position.y - this.target.y;
    const dz = position.z - this.target.z;
    this.targetDistance = Math.sqrt(dx * dx + dy * dy + dz * dz);
    this.distance = this.targetDistance;
    this.desiredDistance = this.targetDistance;
    this.theta = Math.atan2(dz, dx);
    this.targetTheta = this.theta;
    this.phi = Math.acos(dy / this.targetDistance);
    this.targetPhi = this.phi;
    this.recomputeFoV(true);
  }

  public adjustCameraPosition(position: Vect3, rotation: Quat): void {
    const offsetDistance = 0.5;
    const offset = this.tempVec3.set(0, 0, offsetDistance);
    const matr4 = this.tempMatr4.setRotationFromQuaternion(rotation);
    offset.applyMatrix4(matr4);
    const rayOrigin = offset.add(position);
    const rayDirection = rayOrigin.sub(this.target).normalize();

    this.cameraRay.set(this.target, rayDirection);
    const firstRaycastHit = this.collisionsManager.raycastFirst(this.cameraRay);
    if (firstRaycastHit !== null && firstRaycastHit[0] <= this.desiredDistance) {
      const distanceToCollision = firstRaycastHit[0] - 0.1;
      this.targetDistance = distanceToCollision;
      this.distance = distanceToCollision;
    } else {
      this.targetDistance = this.desiredDistance;
    }
  }

  private updateFlyCameraOrbitControls(): void {
    // Convert spherical coordinates to cartesian position
    const sinPhi = Math.sin(this.flyCameraPitch);
    const cosPhi = Math.cos(this.flyCameraPitch);
    const sinTheta = Math.sin(this.flyCameraYaw);
    const cosTheta = Math.cos(this.flyCameraYaw);

    const x = this.flyCameraLookAt.x + this.flyCameraDistance * sinPhi * sinTheta;
    const y = this.flyCameraLookAt.y + this.flyCameraDistance * cosPhi;
    const z = this.flyCameraLookAt.z + this.flyCameraDistance * sinPhi * cosTheta;

    this.flyCameraState.position.set(x, y, z);

    // Calculate rotation to look at target
    const direction = new Vect3()
      .copy(this.flyCameraLookAt)
      .sub(this.flyCameraState.position)
      .normalize();
    const up = new Vect3(0, 1, 0);
    const right = new Vect3().copy(direction).cross(up).normalize();
    const correctedUp = new Vect3().copy(right).cross(direction).normalize();

    const lookAtMatrix = this.tempMatr4.set(
      right.x,
      correctedUp.x,
      -direction.x,
      0,
      right.y,
      correctedUp.y,
      -direction.y,
      0,
      right.z,
      correctedUp.z,
      -direction.z,
      0,
      0,
      0,
      0,
      1,
    );

    this.flyCameraState.rotation.setFromRotationMatrix(lookAtMatrix);
  }

  public dispose() {
    this.disposeEventHandlers();
    this.disposeFlyCameraEventHandlers();
    document.body.style.cursor = "";
  }

  private easeOutExpo(x: number): number {
    return x === 1 ? 1 : 1 - Math.pow(2, -10 * x);
  }

  public updateAspect(aspect: number): void {
    this.aspect = aspect;
    this.cameraState.aspect = aspect;
    this.flyCameraState.aspect = aspect;
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

  public isFlyCameraOn(): boolean {
    return this.isMainCameraActive === false;
  }

  public toggleFlyCamera(): void {
    this.isMainCameraActive = !this.isMainCameraActive;

    if (!this.isMainCameraActive) {
      // Entering fly camera mode - initialize from current camera
      this.updateAspect(window.innerWidth / window.innerHeight);

      // Copy current camera state including FOV
      this.flyCameraState.position.copy(this.cameraState.position);
      this.flyCameraState.rotation.copy(this.cameraState.rotation);
      this.flyCameraState.fov = this.cameraState.fov;

      // Use the main camera's target as the lookAt point
      this.flyCameraLookAt.copy(this.target);

      // Calculate spherical coordinates from current camera position relative to target
      const toCamera = new Vect3().copy(this.flyCameraState.position).sub(this.flyCameraLookAt);
      this.flyCameraDistance = toCamera.length();
      if (this.flyCameraDistance > 0.001) {
        this.flyCameraPitch = Math.acos(toCamera.y / this.flyCameraDistance);
        this.flyCameraYaw = Math.atan2(toCamera.x, toCamera.z);
      } else {
        // Fallback if camera is at target
        this.flyCameraDistance = this.distance;
        this.flyCameraPitch = Math.PI * 0.4;
        this.flyCameraYaw = 0;
      }

      // Immediately update fly camera orbit controls to ensure position matches exactly
      // This prevents any shift when the first update() call recalculates position
      this.updateFlyCameraOrbitControls();

      // Dispose main camera handlers and create fly camera handlers
      this.disposeEventHandlers();
      this.createFlyCameraEventHandlers();
    } else {
      // Exiting fly camera mode
      this.disposeFlyCameraEventHandlers();
      this.createEventHandlers();
    }
  }

  public getCameraState(): CameraState {
    return this.isMainCameraActive ? this.cameraState : this.flyCameraState;
  }

  public getMainCameraState(): CameraState {
    return this.cameraState;
  }

  public getFlyCameraState(): CameraState {
    return this.flyCameraState;
  }

  public getCameraPosition(): Vect3 {
    const state = this.getCameraState();
    return state.position;
  }

  public getCameraRotation(): Quat {
    const state = this.getCameraState();
    return state.rotation;
  }

  public getCameraFOV(): number {
    const state = this.getCameraState();
    return state.fov;
  }

  public update(onFlyCameraUpdate?: (state: CameraState) => void): void {
    if (!this.isMainCameraActive) {
      // Update fly camera orbit controls
      this.updateFlyCameraOrbitControls();
      if (onFlyCameraUpdate) {
        onFlyCameraUpdate(this.flyCameraState);
      }
      return;
    }

    if (this.isLerping && this.lerpFactor < 1) {
      this.lerpFactor += 0.01 / this.lerpDuration;
      this.lerpFactor = Math.min(1, this.lerpFactor);
      this.target.lerpVectors(this.lerpTarget, this.finalTarget, this.easeOutExpo(this.lerpFactor));
    } else {
      this.adjustCameraPosition(this.cameraState.position, this.cameraState.rotation);
    }

    this.distance += (this.targetDistance - this.distance) * this.zoomDamping;

    this.theta += (this.targetTheta - this.theta) * this.damping;
    this.phi += (this.targetPhi - this.phi) * this.damping;

    const x = this.target.x + this.distance * Math.sin(this.phi) * Math.cos(this.theta);
    const y = this.target.y + this.distance * Math.cos(this.phi);
    const z = this.target.z + this.distance * Math.sin(this.phi) * Math.sin(this.theta);

    this.recomputeFoV();
    this.fov += (this.targetFOV - this.fov) * this.zoomDamping;

    this.cameraState.position.set(x, y, z);
    this.cameraState.fov = this.fov;

    const lookAtTarget = new Vect3(this.target.x, this.target.y, this.target.z);
    const direction = new Vect3().copy(lookAtTarget).sub(this.cameraState.position).normalize();
    const up = new Vect3(0, 1, 0);
    const right = new Vect3().copy(direction).cross(up).normalize();
    const correctedUp = new Vect3().copy(right).cross(direction).normalize();

    const lookAtMatrix = this.tempMatr4.set(
      right.x,
      correctedUp.x,
      -direction.x,
      0,
      right.y,
      correctedUp.y,
      -direction.y,
      0,
      right.z,
      correctedUp.z,
      -direction.z,
      0,
      0,
      0,
      0,
      1,
    );

    this.cameraState.rotation.setFromRotationMatrix(lookAtMatrix);

    if (this.isLerping && this.lerpFactor >= 1) {
      this.isLerping = false;
    }
  }

  public hasActiveInput(): boolean {
    return this.activePointers.size > 0;
  }
}
