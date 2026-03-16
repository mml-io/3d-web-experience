import type { CameraProvider } from "@mml-io/3d-web-client-core";
import { Quat, Vect3 } from "@mml-io/3d-web-client-core";

/**
 * A minimal CameraProvider for headless/programmatic use.
 *
 * Positions the virtual camera directly behind the character on the +Z axis,
 * far enough away to avoid the first-person code path in LocalController
 * (which triggers when camera distance < 2).
 *
 * With the camera at (charX, charY, charZ + 5):
 *   azimuthalAngle = atan2(0, 5) = 0
 *
 * This means the heading from ProgrammaticInputProvider maps 1:1 to
 * world-space direction, making waypoint-following straightforward.
 */
export class HeadlessCameraManager implements CameraProvider {
  private position: Vect3 = new Vect3(0, 1.55, 5);
  private rotation: Quat = new Quat();
  private characterPosition: Vect3 = new Vect3();

  /**
   * Update the camera position to track the character.
   * Call this before LocalController.update() each tick.
   */
  setCharacterPosition(pos: { x: number; y: number; z: number }): void {
    this.characterPosition.set(pos.x, pos.y, pos.z);
    // Camera is always 5 units behind on +Z axis, at head height
    this.position.set(pos.x, pos.y + 1.55, pos.z + 5);
  }

  getCameraPosition(): Vect3 {
    return this.position;
  }

  getCameraRotation(): Quat {
    return this.rotation;
  }
}
