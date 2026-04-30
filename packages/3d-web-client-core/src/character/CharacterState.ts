export enum AnimationState {
  "idle" = 0,
  "walking" = 1,
  "running" = 2,
  "jumpToAir" = 3,
  "air" = 4,
  "airToGround" = 5,
  "doubleJump" = 6,
  // Non-locomotion clip slot; LocalController never produces this.
  "emote" = 7,
}

export type CharacterState = {
  position: {
    x: number;
    y: number;
    z: number;
  };
  rotation: {
    eulerY: number;
  };
  state: AnimationState;
};
