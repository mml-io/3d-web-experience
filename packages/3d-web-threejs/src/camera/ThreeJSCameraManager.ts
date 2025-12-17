import { CameraManager, Quat, Vect3 } from "@mml-io/3d-web-client-core";
import { PerspectiveCamera } from "three";

export class ThreeJSCameraManager {
  public readonly mainCamera: PerspectiveCamera;
  private flyCamera: PerspectiveCamera;

  constructor(private coreCameraManager: CameraManager) {
    const aspect = window.innerWidth / window.innerHeight;
    const initialState = this.coreCameraManager.getMainCameraState();

    this.mainCamera = new PerspectiveCamera(initialState.fov, aspect, 0.1, 400);
    this.mainCamera.far = 10000;
    this.mainCamera.position.set(
      initialState.position.x,
      initialState.position.y,
      initialState.position.z,
    );
    this.mainCamera.name = "MainCamera";

    this.flyCamera = new PerspectiveCamera(initialState.fov, aspect, 0.1, 400);
    this.flyCamera.name = "FlyCamera";
    this.flyCamera.position.copy(this.mainCamera.position);

    this.update();
  }

  getActiveCamera(): PerspectiveCamera {
    return this.coreCameraManager.isFlyCameraOn() ? this.flyCamera : this.mainCamera;
  }

  getDistance(): number {
    return this.coreCameraManager.distance;
  }

  public update(): void {
    this.syncMainCamera();
    this.syncFlyCamera();
  }

  private syncMainCamera(): void {
    const state = this.coreCameraManager.getMainCameraState();

    this.mainCamera.position.set(state.position.x, state.position.y, state.position.z);
    this.mainCamera.quaternion.set(
      state.rotation.x,
      state.rotation.y,
      state.rotation.z,
      state.rotation.w,
    );
    this.mainCamera.fov = state.fov;
    this.mainCamera.aspect = state.aspect;
    this.mainCamera.updateProjectionMatrix();
  }

  private syncFlyCamera(): void {
    const flyState = this.coreCameraManager.getFlyCameraState();

    this.flyCamera.position.set(flyState.position.x, flyState.position.y, flyState.position.z);
    this.flyCamera.quaternion.set(
      flyState.rotation.x,
      flyState.rotation.y,
      flyState.rotation.z,
      flyState.rotation.w,
    );
    this.flyCamera.fov = flyState.fov;
    this.flyCamera.aspect = flyState.aspect;
    this.flyCamera.updateProjectionMatrix();
  }

  public updateAspect(aspect: number): void {
    this.coreCameraManager.updateAspect(aspect);
    this.mainCamera.aspect = aspect;
    this.flyCamera.aspect = aspect;
    this.mainCamera.updateProjectionMatrix();
    this.flyCamera.updateProjectionMatrix();
  }

  public dispose(): void {
    this.coreCameraManager.dispose();
  }
}
