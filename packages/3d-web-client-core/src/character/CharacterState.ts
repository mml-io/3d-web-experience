export enum AnimationState {
  "idle" = 0,
  "walking" = 1,
  "running" = 2,
  "jumpToAir" = 3,
  "air" = 4,
  "airToGround" = 5,
  "doubleJump" = 6,
  // Emote / non-locomotion clip slot. Producers other than LocalController
  // (e.g. bots in the showcase) emit this to play an emote animation
  // (clap, wave, etc.) without colliding with locomotion states. Local
  // input never produces emote — LocalController only returns
  // idle/walking/running/jumpToAir/air/airToGround/doubleJump.
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
