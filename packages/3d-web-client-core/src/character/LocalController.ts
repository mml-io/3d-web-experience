import { Line3, Matrix4, Quaternion, Raycaster, Vector3 } from "three";

import { CameraManager } from "../camera/CameraManager";
import { CollisionsManager } from "../collisions/CollisionsManager";
import { ease } from "../helpers/math-helpers";
import { KeyInputManager } from "../input/KeyInputManager";
import { TimeManager } from "../time/TimeManager";

import { Character } from "./Character";
import { AnimationState, CharacterState } from "./CharacterState";

export class LocalController {
  private collisionDetectionSteps = 15;

  public capsuleInfo = {
    radius: 0.4,
    segment: new Line3(new Vector3(), new Vector3(0, 1.05, 0)),
  };

  private maxWalkSpeed = 6;
  private maxRunSpeed = 8.5;
  private gravity: number = -42;
  private jumpForce: number = 16;
  private coyoteTimeThreshold: number = 70;

  private coyoteTime: boolean = false;
  private canJump: boolean = true;
  private characterOnGround: boolean = false;
  private characterWasOnGround: boolean = false;
  private characterAirborneSince: number = 0;
  private currentHeight: number = 0;

  private characterVelocity: Vector3 = new Vector3();
  private vectorUp: Vector3 = new Vector3(0, 1, 0);
  private vectorDown: Vector3 = new Vector3(0, -1, 0);

  private rotationOffset: number = 0;
  private azimuthalAngle: number = 0;

  private tempMatrix: Matrix4 = new Matrix4();
  private tempSegment: Line3 = new Line3();
  private tempVector: Vector3 = new Vector3();
  private tempVector2: Vector3 = new Vector3();
  private rayCaster: Raycaster = new Raycaster();

  private forward: boolean;
  private backward: boolean;
  private left: boolean;
  private right: boolean;
  private run: boolean;
  private jump: boolean;
  private anyDirection: boolean;
  private conflictingDirections: boolean;

  private speed: number = 0;
  private targetSpeed: number = 0;

  public networkState: CharacterState;

  constructor(
    private readonly character: Character,
    private readonly id: number,
    private readonly collisionsManager: CollisionsManager,
    private readonly keyInputManager: KeyInputManager,
    private readonly cameraManager: CameraManager,
    private readonly timeManager: TimeManager,
  ) {
    this.networkState = {
      id: this.id,
      position: { x: 0, y: 0, z: 0 },
      rotation: { quaternionY: 0, quaternionW: 1 },
      state: AnimationState.idle,
    };
  }

  public update(): void {
    const { forward, backward, left, right, run, jump, anyDirection, conflictingDirection } =
      this.keyInputManager;

    this.forward = forward;
    this.backward = backward;
    this.left = left;
    this.right = right;
    this.run = run;
    this.jump = jump;
    this.anyDirection = anyDirection;
    this.conflictingDirections = conflictingDirection;

    this.targetSpeed = this.run ? this.maxRunSpeed : this.maxWalkSpeed;
    this.speed += ease(this.targetSpeed, this.speed, 0.07);

    this.rayCaster.set(this.character.position, this.vectorDown);
    const minimumDistance = this.collisionsManager.raycastFirstDistance(this.rayCaster.ray);
    if (minimumDistance !== null) {
      this.currentHeight = minimumDistance;
    }

    if (anyDirection || !this.characterOnGround) {
      const targetAnimation = this.getTargetAnimation();
      this.character.updateAnimation(targetAnimation);
    } else {
      this.character.updateAnimation(AnimationState.idle);
    }

    if (this.anyDirection) this.updateRotation();

    for (let i = 0; i < this.collisionDetectionSteps; i++) {
      this.updatePosition(this.timeManager.deltaTime / this.collisionDetectionSteps, i);
    }

    if (this.character.position.y < 0) this.resetPosition();
    this.updateNetworkState();
  }

  private getTargetAnimation(): AnimationState {
    if (!this.character) return AnimationState.idle;

    if (this.conflictingDirections) return AnimationState.idle;
    const jumpHeight = this.characterVelocity.y > 0 ? 0.2 : 1.8;
    if (this.currentHeight > jumpHeight && !this.characterOnGround) {
      return AnimationState.air;
    }
    return this.run && this.anyDirection
      ? AnimationState.running
      : this.anyDirection
        ? AnimationState.walking
        : AnimationState.idle;
  }

  private updateRotationOffset(): void {
    if (this.conflictingDirections) return;
    if (this.forward) {
      this.rotationOffset = Math.PI;
      if (this.left) this.rotationOffset = Math.PI + Math.PI / 4;
      if (this.right) this.rotationOffset = Math.PI - Math.PI / 4;
    } else if (this.backward) {
      this.rotationOffset = Math.PI * 2;
      if (this.left) this.rotationOffset = -Math.PI * 2 - Math.PI / 4;
      if (this.right) this.rotationOffset = Math.PI * 2 + Math.PI / 4;
    } else if (this.left) {
      this.rotationOffset = Math.PI * -0.5;
    } else if (this.right) {
      this.rotationOffset = Math.PI * 0.5;
    }
  }

  private updateAzimuthalAngle(): void {
    const camToModelDistance = this.cameraManager.camera.position.distanceTo(
      this.character.position,
    );
    const isCameraFirstPerson = camToModelDistance < 2;
    if (isCameraFirstPerson) {
      const cameraForward = new Vector3(0, 0, 1).applyQuaternion(
        this.cameraManager.camera.quaternion,
      );
      this.azimuthalAngle = Math.atan2(cameraForward.x, cameraForward.z);
    } else {
      this.azimuthalAngle = Math.atan2(
        this.cameraManager.camera.position.x - this.character.position.x,
        this.cameraManager.camera.position.z - this.character.position.z,
      );
    }
  }

  private computeAngularDifference(rotationQuaternion: Quaternion): number {
    return 2 * Math.acos(Math.abs(this.character.quaternion.dot(rotationQuaternion)));
  }

  private updateRotation(): void {
    this.updateRotationOffset();
    this.updateAzimuthalAngle();
    const rotationQuaternion = new Quaternion();
    rotationQuaternion.setFromAxisAngle(this.vectorUp, this.azimuthalAngle + this.rotationOffset);
    const angularDifference = this.computeAngularDifference(rotationQuaternion);
    const desiredTime = 0.07;
    const angularSpeed = angularDifference / desiredTime;
    const frameRotation = angularSpeed * this.timeManager.deltaTime;
    this.character.quaternion.rotateTowards(rotationQuaternion, frameRotation);
  }

  private addScaledVectorToCharacter(deltaTime: number) {
    this.character.position.addScaledVector(this.tempVector, this.speed * deltaTime);
  }

  private updatePosition(deltaTime: number, _iter: number): void {
    if (this.characterOnGround) {
      if (!this.jump) this.canJump = true;

      if (this.jump && this.canJump) {
        this.characterVelocity.y += this.jumpForce;
        this.canJump = false;
      } else {
        this.characterVelocity.y = deltaTime * this.gravity;
      }
    } else if (this.jump && this.coyoteTime) {
      this.characterVelocity.y = this.jumpForce;
      this.canJump = false;
    } else {
      this.characterVelocity.y += deltaTime * this.gravity;
      this.canJump = false;
    }

    this.character.position.addScaledVector(this.characterVelocity, deltaTime);

    this.tempVector.set(0, 0, 0);

    if (this.forward) {
      const forward = new Vector3(0, 0, -1).applyAxisAngle(this.vectorUp, this.azimuthalAngle);
      this.tempVector.add(forward);
    }

    if (this.backward) {
      const backward = new Vector3(0, 0, 1).applyAxisAngle(this.vectorUp, this.azimuthalAngle);
      this.tempVector.add(backward);
    }

    if (this.left) {
      const left = new Vector3(-1, 0, 0).applyAxisAngle(this.vectorUp, this.azimuthalAngle);
      this.tempVector.add(left);
    }

    if (this.right) {
      const right = new Vector3(1, 0, 0).applyAxisAngle(this.vectorUp, this.azimuthalAngle);
      this.tempVector.add(right);
    }

    if (this.tempVector.length() > 0) {
      this.tempVector.normalize();
      this.addScaledVectorToCharacter(deltaTime);
    }

    this.character.updateMatrixWorld();

    this.tempSegment.copy(this.capsuleInfo.segment!);
    this.tempSegment.start.applyMatrix4(this.character.matrixWorld).applyMatrix4(this.tempMatrix);
    this.tempSegment.end.applyMatrix4(this.character.matrixWorld).applyMatrix4(this.tempMatrix);

    this.collisionsManager.applyColliders(this.tempSegment, this.capsuleInfo.radius!);

    const newPosition = this.tempVector;
    newPosition.copy(this.tempSegment.start);

    const deltaVector = this.tempVector2;
    deltaVector.subVectors(newPosition, this.character.position);

    const offset = Math.max(0.0, deltaVector.length() - 1e-5);
    deltaVector.normalize().multiplyScalar(offset);

    this.character.position.add(deltaVector);

    this.characterOnGround = deltaVector.y > Math.abs(deltaTime * this.characterVelocity.y * 0.25);

    if (this.characterWasOnGround && !this.characterOnGround) {
      this.characterAirborneSince = Date.now();
    }

    this.coyoteTime =
      this.characterVelocity.y < 0 &&
      !this.characterOnGround &&
      Date.now() - this.characterAirborneSince < this.coyoteTimeThreshold;

    this.characterWasOnGround = this.characterOnGround;

    if (this.characterOnGround) {
      this.characterVelocity.set(0, 0, 0);
    } else {
      deltaVector.normalize();
      this.characterVelocity.addScaledVector(deltaVector, -deltaVector.dot(this.characterVelocity));
    }
  }

  private updateNetworkState(): void {
    const characterQuaternion = this.character.getWorldQuaternion(new Quaternion());
    const positionUpdate = new Vector3(
      this.character.position.x,
      this.character.position.y,
      this.character.position.z,
    );
    this.networkState = {
      id: this.id,
      position: positionUpdate,
      rotation: { quaternionY: characterQuaternion.y, quaternionW: characterQuaternion.w },
      state: this.character.getCurrentAnimation(),
    };
  }

  private resetPosition(): void {
    this.characterVelocity.y = 0;
    this.character.position.y = 3;
    this.characterOnGround = false;
  }
}
