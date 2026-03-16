import type { InputOutput, InputProvider } from "@mml-io/3d-web-client-core";

/**
 * An InputProvider for programmatic control of a LocalController.
 *
 * Instead of reading keyboard input, this allows setting direction, sprint,
 * and jump state directly — used by the agent bridge's AvatarController
 * to drive the same physics code that the human client uses.
 *
 * Direction is a world-space heading angle (radians), where 0 = +Z.
 * When paired with a HeadlessCameraManager at azimuthalAngle=0,
 * the heading maps directly to world-space movement direction.
 */
export class ProgrammaticInputProvider implements InputProvider {
  private direction: number | null = null;
  private isSprinting: boolean = false;

  getOutput(): InputOutput | null {
    if (this.direction === null) {
      return null;
    }
    return {
      direction: this.direction,
      isSprinting: this.isSprinting,
      jump: false,
    };
  }

  /**
   * Set the movement direction in world-space radians (0 = +Z axis).
   * Set to null to stop moving.
   */
  setDirection(direction: number | null): void {
    this.direction = direction;
  }

  setSprinting(sprinting: boolean): void {
    this.isSprinting = sprinting;
  }

  /** Stop all input. */
  clear(): void {
    this.direction = null;
    this.isSprinting = false;
  }
}
