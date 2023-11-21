import { Quaternion, Vector3 } from "three";

import { Character } from "./Character";
import { AnimationState, CharacterState } from "./CharacterState";

export class RemoteController {
  public currentAnimation: AnimationState = AnimationState.idle;

  public networkState: CharacterState;

  constructor(
    public readonly character: Character,
    public readonly id: number,
  ) {
    this.networkState = {
      id: this.id,
      position: { x: 0, y: 0, z: 0 },
      rotation: { quaternionY: 0, quaternionW: 1 },
      state: this.currentAnimation as AnimationState,
    };
  }

  public update(clientUpdate: CharacterState, time: number, deltaTime: number): void {
    if (!this.character) return;
    this.updateFromNetwork(clientUpdate);
    this.character.update(time, deltaTime);
  }

  private updateFromNetwork(clientUpdate: CharacterState): void {
    const { position, rotation, state } = clientUpdate;
    this.character.position.lerp(new Vector3(position.x, position.y, position.z), 0.15);
    const rotationQuaternion = new Quaternion(0, rotation.quaternionY, 0, rotation.quaternionW);
    this.character.quaternion.slerp(rotationQuaternion, 0.6);
    if (state !== this.currentAnimation) {
      this.currentAnimation = state;
      this.character.updateAnimation(state);
    }
  }
}
