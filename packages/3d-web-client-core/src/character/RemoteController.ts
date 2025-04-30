import { Quat } from "../math";

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

  constructor(private config: RemoteControllerConfig) {
    this.networkState = {
      id: this.config.id,
      position: {
        x: this.config.character.position.x,
        y: this.config.character.position.y,
        z: this.config.character.position.z,
      },
      rotation: {
        quaternionY: tempQuaternion.setFromEulerXYZ(this.config.character.rotation).y,
        quaternionW: 1,
      },
      state: this.currentAnimation as AnimationState,
    };
  }

  public update(clientUpdate: CharacterState, time: number, deltaTime: number): void {
    if (!this.config.character) {
      return;
    }
    this.updateFromNetwork(clientUpdate);
    this.config.character.update(time, deltaTime);
  }

  private updateFromNetwork(clientUpdate: CharacterState): void {
    const { position, rotation, state } = clientUpdate;
    const distanceSquared = this.config.character.position.distanceToSquared(position);
    if (distanceSquared > 5 * 5) {
      // More than 5m of movement in a tick - the character is likely teleporting rather than just moving quickly - snap to the new position
      this.config.character.setPosition(position.x, position.y, position.z);
    } else {
      // TODO - lerp
      this.config.character.setPosition(position.x, position.y, position.z);
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
