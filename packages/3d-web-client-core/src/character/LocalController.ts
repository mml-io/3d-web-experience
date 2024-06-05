import { Euler, Line3, Matrix4, Quaternion, Ray, Raycaster, Vector3 } from "three";

import { CameraManager } from "../camera/CameraManager";
import { CollisionMeshState, CollisionsManager } from "../collisions/CollisionsManager";
import { KeyInputManager } from "../input/KeyInputManager";
import { VirtualJoystick } from "../input/VirtualJoystick";
import { TimeManager } from "../time/TimeManager";
import { characterControllerValues } from "../tweakpane/blades/characterControlsFolder";

import { Character } from "./Character";
import { AnimationState, CharacterState } from "./CharacterState";

const downVector = new Vector3(0, -1, 0);

export type LocalControllerConfig = {
  id: number;
  character: Character;
  collisionsManager: CollisionsManager;
  keyInputManager: KeyInputManager;
  virtualJoystick?: VirtualJoystick;
  cameraManager: CameraManager;
  timeManager: TimeManager;
};

export class LocalController {
  public capsuleInfo = {
    radius: 0.4,
    segment: new Line3(new Vector3(), new Vector3(0, 1.05, 0)),
  };

  public gravity: number = -characterControllerValues.gravity;
  public jumpForce: number = characterControllerValues.jumpForce;
  public doubleJumpForce: number = characterControllerValues.doubleJumpForce;
  public coyoteTimeThreshold: number = characterControllerValues.coyoteJump;
  public canJump: boolean = true;
  public canDoubleJump: boolean = true;
  public coyoteJumped = false;
  public doubleJumpUsed: boolean = false;
  public jumpCounter: number = 0;

  public airResistance = characterControllerValues.airResistance;
  public groundResistance = 0.99999999 + characterControllerValues.groundResistance * 1e-7;
  public airControlModifier = characterControllerValues.airControlModifier;
  public groundWalkControl = characterControllerValues.groundWalkControl;
  public groundRunControl = characterControllerValues.groundRunControl;
  public baseControl = characterControllerValues.baseControlMultiplier;
  public minimumSurfaceAngle = characterControllerValues.minimumSurfaceAngle;

  public latestPosition: Vector3 = new Vector3();
  public characterOnGround: boolean = false;
  public coyoteTime: boolean = false;

  private collisionDetectionSteps = 15;

  private characterWasOnGround: boolean = false;
  private characterAirborneSince: number = 0;
  private currentHeight: number = 0;
  private currentSurfaceAngle = new Vector3();

  private characterVelocity: Vector3 = new Vector3();
  private vectorUp: Vector3 = new Vector3(0, 1, 0);
  private vectorDown: Vector3 = new Vector3(0, -1, 0);

  private rotationOffset: number = 0;
  private azimuthalAngle: number = 0;

  private tempMatrix: Matrix4 = new Matrix4();
  private tempSegment: Line3 = new Line3();
  private tempQuaternion: Quaternion = new Quaternion();
  private tempEuler: Euler = new Euler();
  private tempVector: Vector3 = new Vector3();
  private tempVector2: Vector3 = new Vector3();
  private tempVector3: Vector3 = new Vector3();
  private rayCaster: Raycaster = new Raycaster();

  private surfaceTempQuaternion = new Quaternion();
  private surfaceTempQuaternion2 = new Quaternion();
  private surfaceTempVector1 = new Vector3();
  private surfaceTempVector2 = new Vector3();
  private surfaceTempVector3 = new Vector3();
  private surfaceTempVector4 = new Vector3();
  private surfaceTempVector5 = new Vector3();
  private surfaceTempRay = new Ray();
  private lastFrameSurfaceState:
    | [
        CollisionMeshState,
        {
          lastMatrix: Matrix4;
        },
      ]
    | null = null;

  private forward: boolean;
  private backward: boolean;
  private left: boolean;
  private right: boolean;
  private run: boolean;
  private jump: boolean;
  private anyDirection: boolean;
  private conflictingDirections: boolean;

  public jumpPressed: boolean = false; // Tracks if the jump button is pressed
  public jumpReleased: boolean = true; // Indicates if the jump button has been released

  public networkState: CharacterState;

  constructor(private config: LocalControllerConfig) {
    this.networkState = {
      id: this.config.id,
      position: { x: 0, y: 0, z: 0 },
      rotation: { quaternionY: 0, quaternionW: 1 },
      state: AnimationState.idle,
    };
  }

  private updateControllerState(): void {
    this.forward = this.config.keyInputManager.forward || this.config.virtualJoystick?.up || false;
    this.backward =
      this.config.keyInputManager.backward || this.config.virtualJoystick?.down || false;
    this.left = this.config.keyInputManager.left || this.config.virtualJoystick?.left || false;
    this.right = this.config.keyInputManager.right || this.config.virtualJoystick?.right || false;
    this.run = this.config.keyInputManager.run;
    this.jump = this.config.keyInputManager.jump;
    this.anyDirection =
      this.config.keyInputManager.anyDirection ||
      this.config.virtualJoystick?.hasDirection ||
      false;
    this.conflictingDirections = this.config.keyInputManager.conflictingDirection;

    if (!this.jump) {
      this.jumpReleased = true;
    }
  }

  public update(): void {
    this.updateControllerState();

    this.rayCaster.set(this.config.character.position, this.vectorDown);
    const firstRaycastHit = this.config.collisionsManager.raycastFirst(this.rayCaster.ray);
    if (firstRaycastHit !== null) {
      this.currentHeight = firstRaycastHit[0];
      this.currentSurfaceAngle.copy(firstRaycastHit[1]);
    }

    if (this.anyDirection || !this.characterOnGround) {
      const targetAnimation = this.getTargetAnimation();
      this.config.character.updateAnimation(targetAnimation);
    } else {
      this.config.character.updateAnimation(AnimationState.idle);
    }

    if (this.anyDirection) {
      this.updateRotation();
    }

    for (let i = 0; i < this.collisionDetectionSteps; i++) {
      this.updatePosition(
        this.config.timeManager.deltaTime,
        this.config.timeManager.deltaTime / this.collisionDetectionSteps,
        i,
      );
    }

    // Allow the user to fall far below zero before resetting
    // TODO - Might want to make this a configurable value
    if (this.config.character.position.y < -100) {
      this.resetPosition();
    }
    this.updateNetworkState();
  }

  private getTargetAnimation(): AnimationState {
    if (!this.config.character) return AnimationState.idle;

    const jumpHeight = this.characterVelocity.y > 0 ? 0.2 : 1.8;
    if (this.currentHeight > jumpHeight && !this.characterOnGround) {
      if (this.doubleJumpUsed) {
        return AnimationState.doubleJump;
      }
      return AnimationState.air;
    }
    if (this.conflictingDirections) {
      return AnimationState.idle;
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
    const camToModelDistance = this.config.cameraManager.camera.position.distanceTo(
      this.config.character.position,
    );
    const isCameraFirstPerson = camToModelDistance < 2;
    if (isCameraFirstPerson) {
      const cameraForward = this.tempVector
        .set(0, 0, 1)
        .applyQuaternion(this.config.cameraManager.camera.quaternion);
      this.azimuthalAngle = Math.atan2(cameraForward.x, cameraForward.z);
    } else {
      this.azimuthalAngle = Math.atan2(
        this.config.cameraManager.camera.position.x - this.config.character.position.x,
        this.config.cameraManager.camera.position.z - this.config.character.position.z,
      );
    }
  }

  private computeAngularDifference(rotationQuaternion: Quaternion): number {
    return 2 * Math.acos(Math.abs(this.config.character.quaternion.dot(rotationQuaternion)));
  }

  private updateRotation(): void {
    this.updateRotationOffset();
    this.updateAzimuthalAngle();
    const rotationQuaternion = this.tempQuaternion.setFromAxisAngle(
      this.vectorUp,
      this.azimuthalAngle + this.rotationOffset,
    );
    const angularDifference = this.computeAngularDifference(rotationQuaternion);
    const desiredTime = 0.07;
    const angularSpeed = angularDifference / desiredTime;
    const frameRotation = angularSpeed * this.config.timeManager.deltaTime;
    this.config.character.quaternion.rotateTowards(rotationQuaternion, frameRotation);
  }

  private processJump(currentAcceleration: Vector3, deltaTime: number) {
    if (this.characterOnGround) {
      this.coyoteJumped = false;
      this.canDoubleJump = false;
      this.doubleJumpUsed = false;
      this.jumpCounter = 0;

      if (!this.jump) {
        this.canDoubleJump = !this.doubleJumpUsed && this.jumpReleased && this.jumpCounter === 1;
        this.canJump = true;
        this.jumpReleased = true;
      }

      if (this.jump && this.canJump && this.jumpReleased) {
        currentAcceleration.y += this.jumpForce / deltaTime;
        this.canJump = false;
        this.jumpReleased = false;
        this.jumpCounter++;
      } else {
        if (this.currentSurfaceAngle.y < this.minimumSurfaceAngle) {
          currentAcceleration.y += this.gravity;
        }
      }
    } else {
      if (this.jump && !this.coyoteJumped && this.coyoteTime) {
        this.coyoteJumped = true;
        currentAcceleration.y += this.jumpForce / deltaTime;
        this.canJump = false;
        this.jumpReleased = false;
        this.jumpCounter++;
      } else if (this.jump && this.canDoubleJump) {
        currentAcceleration.y += this.doubleJumpForce / deltaTime;
        this.doubleJumpUsed = true;
        this.jumpReleased = false;
        this.jumpCounter++;
      } else {
        currentAcceleration.y += this.gravity;
        this.canJump = false;
      }
    }

    if (!this.jump) {
      this.jumpReleased = true;
      if (!this.characterOnGround) {
        currentAcceleration.y += this.gravity;
      }
    }
  }

  private applyControls(deltaTime: number) {
    const resistance = this.characterOnGround ? this.groundResistance : this.airResistance;

    // Dampen the velocity based on the resistance
    const speedFactor = Math.pow(1 - resistance, deltaTime);
    this.characterVelocity.multiplyScalar(speedFactor);

    const acceleration = this.tempVector.set(0, 0, 0);
    this.canDoubleJump = !this.doubleJumpUsed && this.jumpReleased && this.jumpCounter === 1;
    this.processJump(acceleration, deltaTime);

    const control =
      (this.characterOnGround
        ? this.run
          ? this.groundRunControl
          : this.groundWalkControl
        : this.airControlModifier) * this.baseControl;

    const controlAcceleration = this.tempVector2.set(0, 0, 0);

    if (!this.conflictingDirections) {
      if (this.forward) {
        const forward = this.tempVector3
          .set(0, 0, -1)
          .applyAxisAngle(this.vectorUp, this.azimuthalAngle);
        controlAcceleration.add(forward);
      }

      if (this.backward) {
        const backward = this.tempVector3
          .set(0, 0, 1)
          .applyAxisAngle(this.vectorUp, this.azimuthalAngle);
        controlAcceleration.add(backward);
      }

      if (this.left) {
        const left = this.tempVector3
          .set(-1, 0, 0)
          .applyAxisAngle(this.vectorUp, this.azimuthalAngle);
        controlAcceleration.add(left);
      }

      if (this.right) {
        const right = this.tempVector3
          .set(1, 0, 0)
          .applyAxisAngle(this.vectorUp, this.azimuthalAngle);
        controlAcceleration.add(right);
      }
    }
    if (controlAcceleration.length() > 0) {
      controlAcceleration.normalize();
      controlAcceleration.multiplyScalar(control);
    }
    acceleration.add(controlAcceleration);
    this.characterVelocity.addScaledVector(acceleration, deltaTime);

    this.config.character.position.addScaledVector(this.characterVelocity, deltaTime);
  }

  private updatePosition(deltaTime: number, stepDeltaTime: number, iter: number): void {
    this.applyControls(stepDeltaTime);

    if (iter === 0) {
      const lastMovement = this.getMovementFromSurfaces(this.config.character.position, deltaTime);
      if (lastMovement) {
        this.config.character.position.add(lastMovement.position);
        const asQuaternion = this.tempQuaternion.setFromEuler(this.config.character.rotation);
        const lastMovementEuler = this.tempEuler.setFromQuaternion(lastMovement.rotation);
        lastMovementEuler.x = 0;
        lastMovementEuler.z = 0;
        lastMovement.rotation.setFromEuler(lastMovementEuler);
        asQuaternion.multiply(lastMovement.rotation);
        this.config.character.rotation.setFromQuaternion(asQuaternion);
      }
    }
    this.config.character.updateMatrixWorld();

    const avatarSegment = this.tempSegment;
    avatarSegment.copy(this.capsuleInfo.segment!);
    avatarSegment.start
      .applyMatrix4(this.config.character.matrixWorld)
      .applyMatrix4(this.tempMatrix);
    avatarSegment.end.applyMatrix4(this.config.character.matrixWorld).applyMatrix4(this.tempMatrix);

    const positionBeforeCollisions = this.tempVector.copy(avatarSegment.start);
    this.config.collisionsManager.applyColliders(avatarSegment, this.capsuleInfo.radius!);
    this.config.character.position.copy(avatarSegment.start);
    const deltaCollisionPosition = avatarSegment.start.sub(positionBeforeCollisions);

    this.characterOnGround = deltaCollisionPosition.y > 0;

    if (this.characterOnGround) {
      this.doubleJumpUsed = false;
      this.jumpCounter = 0;
    }

    if (this.characterWasOnGround && !this.characterOnGround) {
      this.characterAirborneSince = Date.now();
    }

    if (!this.jump) {
      this.jumpReleased = true;
    }

    this.coyoteTime =
      this.characterVelocity.y < 0 &&
      !this.characterOnGround &&
      Date.now() - this.characterAirborneSince < this.coyoteTimeThreshold;

    this.latestPosition = this.config.character.position.clone();
    this.characterWasOnGround = this.characterOnGround;
  }

  public getMovementFromSurfaces(userPosition: Vector3, deltaTime: number) {
    let lastMovement: { rotation: Quaternion; position: Vector3 } | null = null;

    // If we have a last frame state, we can calculate the movement of the mesh to apply it to the user
    if (this.lastFrameSurfaceState !== null) {
      const meshState = this.lastFrameSurfaceState[0];

      // Extract the matrix from the current frame and the last frame
      const currentFrameMatrix = meshState.matrix;
      const lastFrameMatrix = this.lastFrameSurfaceState[1].lastMatrix;

      if (lastFrameMatrix.equals(currentFrameMatrix)) {
        // No movement from this mesh - do nothing
      } else {
        // The mesh has moved since the last frame - calculate the movement

        // Get the position of the mesh in the last frame
        const lastMeshPosition = this.surfaceTempVector1;
        const lastMeshRotation = this.surfaceTempQuaternion;
        lastFrameMatrix.decompose(lastMeshPosition, lastMeshRotation, this.surfaceTempVector3);

        // Get the position of the mesh in the current frame
        const currentMeshPosition = this.surfaceTempVector2;
        const currentMeshRotation = this.surfaceTempQuaternion2;
        currentFrameMatrix.decompose(
          currentMeshPosition,
          currentMeshRotation,
          this.surfaceTempVector3,
        );

        // Calculate the difference between the new position and the old position to determine the movement due to translation of position
        const meshTranslationDelta = this.surfaceTempVector5
          .copy(currentMeshPosition)
          .sub(lastMeshPosition);

        // Calculate the relative position of the user to the mesh in the last frame
        const lastFrameRelativeUserPosition = this.surfaceTempVector3
          .copy(userPosition)
          .sub(lastMeshPosition);

        // Calculate the relative quaternion of the mesh in the last frame to the mesh in the current frame
        const meshRotationDelta = lastMeshRotation.invert().multiply(currentMeshRotation);

        // Apply the relative quaternion to the relative user position to determine the new position of the user given just the rotation
        const translationDueToRotation = this.surfaceTempVector4
          .copy(lastFrameRelativeUserPosition)
          .applyQuaternion(meshRotationDelta)
          .sub(lastFrameRelativeUserPosition);

        // Combine the mesh translation delta and the rotation translation delta to determine the total movement of the user
        const translationAndRotationPositionDelta = this.surfaceTempVector1
          .copy(meshTranslationDelta)
          .add(translationDueToRotation);

        lastMovement = {
          position: translationAndRotationPositionDelta,
          rotation: meshRotationDelta,
        };
        lastFrameMatrix.copy(currentFrameMatrix);
      }
    }

    const newPosition = this.surfaceTempVector3.copy(userPosition);
    if (lastMovement) {
      newPosition.add(lastMovement.position);
    }
    newPosition.setY(newPosition.y + 0.05);

    // Raycast down from the new position to see if there is a surface below the user which will be tracked in the next frame
    const ray = this.surfaceTempRay.set(newPosition, downVector);
    const hit = this.config.collisionsManager.raycastFirst(ray);
    if (hit && hit[0] < 0.8) {
      // There is a surface below the user
      const currentCollisionMeshState = hit[2];
      this.lastFrameSurfaceState = [
        currentCollisionMeshState,
        { lastMatrix: currentCollisionMeshState.matrix.clone() },
      ];
    } else {
      if (this.lastFrameSurfaceState !== null && lastMovement) {
        // Apply the last movement to the user's velocity
        this.characterVelocity.add(
          lastMovement.position.clone().divideScalar(deltaTime), // The position delta is the result of one tick which is deltaTime seconds, so we need to divide by deltaTime to get the velocity per second
        );
      }
      this.lastFrameSurfaceState = null;
    }
    return lastMovement;
  }

  private updateNetworkState(): void {
    const characterQuaternion = this.config.character.getWorldQuaternion(this.tempQuaternion);
    const cameraQuaternion = new Quaternion();
    this.config.cameraManager.camera.getWorldQuaternion(cameraQuaternion);
    this.networkState = {
      id: this.config.id,
      position: {
        x: this.config.character.position.x,
        y: this.config.character.position.y,
        z: this.config.character.position.z,
      },
      rotation: { quaternionY: characterQuaternion.y, quaternionW: characterQuaternion.w },
      camPosition: {
        x: this.config.cameraManager.camera.position.x,
        y: this.config.cameraManager.camera.position.y,
        z: this.config.cameraManager.camera.position.z,
      },
      camQuaternion: {
        y: cameraQuaternion.y,
        w: cameraQuaternion.w,
      },
      state: this.config.character.getCurrentAnimation(),
    };
  }

  private resetPosition(): void {
    this.characterVelocity.y = 0;
    this.config.character.position.y = 3;
    this.characterOnGround = false;
    this.doubleJumpUsed = false;
    this.jumpReleased = true;
    this.jumpCounter = 0;
  }
}
