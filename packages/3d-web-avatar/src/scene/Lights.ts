import {
  AmbientLight,
  CameraHelper,
  DirectionalLight,
  OrthographicCamera,
  Scene,
  Vector3,
} from "three";

export class Lights {
  public ambientLight = new AmbientLight(0xffffff, 0.1);
  public mainLight = new DirectionalLight(0xffffff, 1.0);

  private shadowCamHelper: CameraHelper | null = null;
  private shadowResolution: number = 8192;
  private shadowCamFrustum: number = 10;
  private lookAt: Vector3;

  private shadowCamera = new OrthographicCamera(
    -this.shadowCamFrustum,
    this.shadowCamFrustum,
    this.shadowCamFrustum,
    -this.shadowCamFrustum,
    0.1,
    200,
  );

  constructor(private cameraOffset: Vector3) {
    this.shadowCamHelper = new CameraHelper(this.shadowCamera);

    this.lookAt = new Vector3().copy(new Vector3()).add(this.cameraOffset);

    this.mainLight = new DirectionalLight(0xffffff, 1.0);
    this.mainLight.position.set(2, 4, 2);
    this.mainLight.shadow.normalBias = 0.05;
    this.mainLight.shadow.radius = 1.5;
    this.mainLight.shadow.camera = this.shadowCamera;
    this.mainLight.shadow.mapSize.set(this.shadowResolution, this.shadowResolution);
    this.mainLight.castShadow = true;
    this.mainLight.target.position.copy(this.lookAt);
    this.mainLight.target.updateMatrixWorld();
  }
}
