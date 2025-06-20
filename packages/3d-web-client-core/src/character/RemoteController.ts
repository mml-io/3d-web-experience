import { Quat, Vect3 } from "../math";

import { Character } from "./Character";
import { CharacterState } from "./CharacterState";

export type RemoteControllerConfig = {
  id: number;
  character: Character;
};

const tempQuaternion = new Quat();

export class RemoteController {
  public networkState: CharacterState;

  private hasReceivedInitialUpdate = false;
  private interpolationRate = 8.0; // How quickly to interpolate (higher = faster)

  constructor(private config: RemoteControllerConfig) {
    const pos = this.config.character.getPosition();
    const rot = this.config.character.getRotation();
    const currentAnimation = this.config.character.getCurrentAnimation();

    this.networkState = {
      id: this.config.id,
      position: { x: pos.x, y: pos.y, z: pos.z },
      rotation: { quaternionY: rot.y, quaternionW: 1 },
      state: currentAnimation,
    };
  }

  public update(clientUpdate: CharacterState, time: number, deltaTime: number): void {
    if (!this.config.character) return;
    this.updateFromNetwork(clientUpdate, deltaTime);
    this.config.character.update(time, deltaTime);
  }

  private updateFromNetwork(clientUpdate: CharacterState, deltaTime: number): void {
    const { position, rotation, state } = clientUpdate;

    const currentPos = new Vect3(this.config.character.getPosition());
    const targetPos = new Vect3(position.x, position.y, position.z);

    const rotationQuaternion = tempQuaternion.set(0, rotation.quaternionY, 0, rotation.quaternionW);

    if (!this.hasReceivedInitialUpdate) {
      // First update, snap into position
      this.config.character.setPosition(targetPos.x, targetPos.y, targetPos.z);

      // Also snap rotation on first update
      this.config.character.setRotation(
        rotationQuaternion.x,
        rotationQuaternion.y,
        rotationQuaternion.z,
        rotationQuaternion.w,
      );

      this.hasReceivedInitialUpdate = true;
    } else {
      const distSq = currentPos.distanceToSquared(targetPos);
      // More than 5m of movement in a tick
      // the character is likely teleporting rather than just moving quickly
      // snap to the new position
      if (distSq > 5 * 5) {
        this.config.character.setPosition(targetPos.x, targetPos.y, targetPos.z);
      } else {
        // Frame-rate independent exponential smoothing
        const lerpFactor = Math.min(1.0, 1.0 - Math.exp(-this.interpolationRate * deltaTime));
        const interpolatedPos = currentPos.lerp(targetPos, lerpFactor);
        this.config.character.setPosition(interpolatedPos.x, interpolatedPos.y, interpolatedPos.z);
      }

      // Smooth rotation interpolation
      const currentRot = this.config.character.getRotation();
      const currentRotQuat = new Quat().setFromEulerXYZ(currentRot);

      // Frame-rate independent exponential smoothing for rotation
      const lerpFactor = Math.min(1.0, 1.0 - Math.exp(-this.interpolationRate * deltaTime));
      const interpolatedRot = currentRotQuat.slerp(rotationQuaternion, lerpFactor);

      this.config.character.setRotation(
        interpolatedRot.x,
        interpolatedRot.y,
        interpolatedRot.z,
        interpolatedRot.w,
      );
    }

    if (state !== this.config.character.getCurrentAnimation()) {
      this.config.character.updateAnimation(state);
    }
  }
}
