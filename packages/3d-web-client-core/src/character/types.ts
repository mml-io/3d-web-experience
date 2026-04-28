export type AnimationConfig = {
  idleAnimationFileUrl: string;
  jogAnimationFileUrl: string;
  sprintAnimationFileUrl: string;
  airAnimationFileUrl: string;
  doubleJumpAnimationFileUrl: string;
  // Optional emote/non-locomotion clip. Bound to AnimationState.emote.
  // When omitted, characters that target emote will crossfade to an
  // empty mix slot (no clip plays). Local input never targets emote.
  emoteAnimationFileUrl?: string;
};
