import { EulXYZ, Quat, Vect3 } from "../math";

import { AnimationState, CharacterState } from "./CharacterState";

const tempQuaternion = new Quat();

/**
 * RemoteController handles interpolation of remote character state.
 * It's renderer-agnostic and only calculates interpolated positions/rotations.
 */
export class RemoteController {
  // Current interpolated state
  public position: Vect3;
  public rotation: Quat;
  public animationState: AnimationState;

  private hasReceivedInitialUpdate = false;
  private interpolationRate = 8.0; // How quickly to interpolate (higher = faster)
  private cachedTargetPos = new Vect3();

  constructor(initialPosition: Vect3, initialRotation: EulXYZ, initialAnimation: AnimationState) {
    this.position = new Vect3(initialPosition.x, initialPosition.y, initialPosition.z);
    this.rotation = new Quat().setFromEulerXYZ(initialRotation);
    this.animationState = initialAnimation;
  }

  public update(networkUpdate: CharacterState, deltaTime: number): void {
    const { position, rotation, state } = networkUpdate;

    // Reuse cached Vect3 instead of allocating new one
    const targetPos = this.cachedTargetPos.set(position.x, position.y, position.z);
    const targetRotQuat = tempQuaternion.set(0, rotation.quaternionY, 0, rotation.quaternionW);

    if (!this.hasReceivedInitialUpdate) {
      // First update, snap into position
      this.position.set(targetPos.x, targetPos.y, targetPos.z);
      this.rotation.set(targetRotQuat.x, targetRotQuat.y, targetRotQuat.z, targetRotQuat.w);
      this.animationState = state;
      this.hasReceivedInitialUpdate = true;
    } else {
      // Interpolate position
      const distSq = this.position.distanceToSquared(targetPos);
      if (distSq > 5 * 5) {
        // More than 5m of movement - teleport
        this.position.set(targetPos.x, targetPos.y, targetPos.z);
      } else {
        // Frame-rate independent exponential smoothing
        const lerpFactor = Math.min(1.0, 1.0 - Math.exp(-this.interpolationRate * deltaTime));
        this.position.lerp(targetPos, lerpFactor);
      }

      // Interpolate rotation
      const lerpFactor = Math.min(1.0, 1.0 - Math.exp(-this.interpolationRate * deltaTime));
      this.rotation.slerp(targetRotQuat, lerpFactor);

      // Update animation
      this.animationState = state;
    }
  }

  public getRotationEuler(): EulXYZ {
    return new EulXYZ().setFromQuaternion(this.rotation);
  }
}
