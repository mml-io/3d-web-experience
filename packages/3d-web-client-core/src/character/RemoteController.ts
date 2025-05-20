import { Quat, Vect3 } from "../math";

import { Character } from "./Character";
import { AnimationState, CharacterState } from "./CharacterState";

export type RemoteControllerConfig = {
  id: number;
  character: Character;
};

const tempQuaternion = new Quat();

export class RemoteController {
  public currentAnimation: AnimationState = AnimationState.idle;
  public networkState: CharacterState;

  private hasReceivedInitialUpdate = false;

  constructor(private config: RemoteControllerConfig) {
    const pos = this.config.character.getPosition();
    const rot = this.config.character.getRotation();

    this.networkState = {
      id: this.config.id,
      position: { x: pos.x, y: pos.y, z: pos.z },
      rotation: { quaternionY: rot.y, quaternionW: 1 },
      state: this.currentAnimation,
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

    if (!this.hasReceivedInitialUpdate) {
      // First update, snap into position
      this.config.character.setPosition(targetPos.x, targetPos.y, targetPos.z);
      this.hasReceivedInitialUpdate = true;
    } else {
      const distSq = currentPos.distanceToSquared(targetPos);
      // More than 5m of movement in a tick
      // the character is likely teleporting rather than just moving quickly
      // snap to the new position
      if (distSq > 5 * 5) {
        this.config.character.setPosition(targetPos.x, targetPos.y, targetPos.z);
      } else {
        const interpolatedPos = currentPos.lerp(targetPos, deltaTime * 1.5);
        this.config.character.setPosition(interpolatedPos.x, interpolatedPos.y, interpolatedPos.z);
      }
    }

    const rotationQuaternion = tempQuaternion.set(0, rotation.quaternionY, 0, rotation.quaternionW);
    this.config.character.setRotation(
      rotationQuaternion.x,
      rotationQuaternion.y,
      rotationQuaternion.z,
      rotationQuaternion.w,
    );

    if (state !== this.currentAnimation) {
      this.currentAnimation = state;
      this.config.character.updateAnimation(state);
    }
  }
}
