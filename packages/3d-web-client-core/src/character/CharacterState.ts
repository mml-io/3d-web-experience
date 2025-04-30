export enum AnimationState {
  "idle" = "idle",
  "walking" = "walking",
  "running" = "running",
  "jumpToAir" = "jumpToAir",
  "air" = "air",
  "airToGround" = "airToGround",
  "doubleJump" = "doubleJump",
}

export type CharacterState = {
  id: number;
  position: {
    x: number;
    y: number;
    z: number;
  };
  rotation: {
    quaternionY: number;
    quaternionW: number;
  };
  camPosition?: {
    x: number;
    y: number;
    z: number;
  };
  camQuaternion?: {
    y: number;
    w: number;
  };
  state: AnimationState;
};
