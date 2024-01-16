import { ModelLoader } from "@mml-io/3d-web-avatar";
import {
  AmbientLight,
  AnimationAction,
  AnimationClip,
  AnimationMixer,
  Box3,
  Color,
  DirectionalLight,
  LoopRepeat,
  Object3D,
  OrthographicCamera,
  PerspectiveCamera,
  Scene,
  VSMShadowMap,
  Vector3,
  WebGLRenderTarget,
  WebGLRenderer,
} from "three";
import { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";

const toRad = (angle: number): number => (angle * Math.PI) / 180.0;

export class ModelScreenshot {
  private modelLoader = new ModelLoader();

  private renderer: WebGLRenderer;
  private scene: Scene;

  private model: Object3D;

  private mixer: AnimationMixer;
  private animationAsset: GLTF | null | undefined = null;
  private animationClip: AnimationClip;
  private animationAction: AnimationAction;

  constructor() {
    this.renderer = new WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.shadowMap.type = VSMShadowMap;
    this.renderer.shadowMap.enabled = true;
    this.scene = new Scene();
  }

  private async setupModel(model: Object3D | string): Promise<void> {
    if (model instanceof Object3D) {
      this.model = model;
    } else {
      const gltf = (await this.modelLoader.load(model)) as GLTF;
      this.model = gltf.scene;
    }
  }

  private async setupAnimation(animationURL: string): Promise<void> {
    if (!this.model) {
      throw new Error("setupAnimation: model not Available");
    }
    this.mixer = new AnimationMixer(this.model);

    this.animationAsset = await this.modelLoader.load(animationURL);
    if (this.animationAsset && this.animationAsset.animations) {
      this.animationClip = this.animationAsset.animations[0];
      this.animationAction = this.mixer.clipAction(this.animationClip);
      this.animationAction.setLoop(LoopRepeat, Infinity);
    }
  }

  private positionCamera(
    camera: PerspectiveCamera,
    boundingBox: Box3,
    size: Vector3,
    isFitVertically: boolean,
    padding: number,
    cameraRotation: [number, number, number],
  ): void {
    const paddingFactor = 1 - -padding / 100;
    let distance: number;
    if (isFitVertically) {
      distance = (size.y / 2 / Math.tan(((camera.fov / 2) * Math.PI) / 180)) * paddingFactor;
    } else {
      distance =
        (size.x / 2 / Math.tan(((camera.fov / 2) * Math.PI) / 180) / camera.aspect) * paddingFactor;
    }

    const center = new Vector3();
    boundingBox.getCenter(center);

    // Convert spherical coordinates (polar and azimuthal angles) to Cartesian coordinates
    const polarAngle = cameraRotation[1] * (Math.PI / 180); // Convert to radians
    const azimuthalAngle = cameraRotation[2] * (Math.PI / 180); // Convert to radians

    const rotatedPosition = new Vector3();
    rotatedPosition.x = center.x + distance * Math.sin(polarAngle) * Math.cos(azimuthalAngle);
    rotatedPosition.y = center.y + distance * Math.sin(polarAngle) * Math.sin(azimuthalAngle);
    rotatedPosition.z = center.z + distance * Math.cos(polarAngle);

    camera.position.set(rotatedPosition.x, rotatedPosition.y, rotatedPosition.z);
    camera.lookAt(center);
  }

  private renderObjectToRenderTarget(
    width: number,
    height: number,
    padding: number,
    ssaa: number,
  ): WebGLRenderTarget {
    // Create a new WebGLRenderTarget
    const renderTarget = new WebGLRenderTarget(width * ssaa, height * ssaa);
    this.model.updateMatrixWorld();
    this.animationAction.play();
    this.mixer.setTime(0.4);
    this.mixer.update(0);

    // Compute the bounding box of the object
    const boundingBox = new Box3().setFromObject(this.model);
    const size = new Vector3();
    boundingBox.getSize(size);

    const center = new Vector3();
    boundingBox.getCenter(center);

    // Determine if the object should fit vertically or horizontally
    const aspectRatio = width / height;
    const objectAspectRatio = size.x / size.y;
    const isFitVertically = objectAspectRatio <= aspectRatio;

    // Create a new camera for rendering
    const camera = new PerspectiveCamera(50, aspectRatio, 0.1, 1000);
    this.positionCamera(camera, boundingBox, size, isFitVertically, padding, [0, 15, 30]);

    // Render the object to the render target
    const backupScene = this.scene;
    const backupRenderTarget = this.renderer!.getRenderTarget();

    this.scene = new Scene();
    this.scene.add(this.model);

    const ambientLight = new AmbientLight(0xffffff, 0.5);

    const backLightColor = new Color().setRGB(0.85, 1, 1);
    const frontLightColor = new Color().setRGB(1, 0.85, 0.9);

    const backLight = new DirectionalLight(backLightColor, 3);
    const frontLight = new DirectionalLight(frontLightColor, 1.5);

    backLight.position.set(4, 4, -10);
    frontLight.position.set(-2, 1, 5);

    const frustum = 5;
    const shadowCamera = new OrthographicCamera(-frustum, frustum, frustum, -frustum, 0.01, 20);

    frontLight.shadow.normalBias = 0.05;
    frontLight.shadow.radius = 2.5;
    frontLight.shadow.camera = shadowCamera;
    frontLight.shadow.mapSize.set(8192, 8192);
    frontLight.castShadow = true;

    backLight.shadow.normalBias = 0.05;
    backLight.shadow.radius = 2.5;
    backLight.shadow.camera = shadowCamera;
    backLight.shadow.mapSize.set(8192, 8192);
    backLight.castShadow = true;

    this.scene.add(ambientLight);
    this.scene.add(backLight);
    this.scene.add(frontLight);

    this.renderer.setRenderTarget(renderTarget);
    this.renderer.render(this.scene, camera);

    this.scene.remove(ambientLight);
    this.scene.remove(backLight);
    this.scene.remove(frontLight);
    this.scene.remove(this.model);

    ambientLight.dispose();
    backLight.dispose();
    frontLight.dispose();

    return renderTarget;
  }

  private getDataUrlFromRenderTarget(
    renderTarget: WebGLRenderTarget,
    width: number,
    height: number,
    ssaa: number,
  ): string {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d")!;

    // super-sampling AA
    const ssWidth = width * ssaa;
    const ssHeight = height * ssaa;

    const pixels = new Uint8Array(ssWidth * ssHeight * 4);
    this.renderer!.readRenderTargetPixels(renderTarget, 0, 0, ssWidth, ssHeight, pixels);

    const rowBytes = ssWidth * 4;
    const halfHeight = Math.floor(ssWidth / 2);
    for (let y = 0; y < halfHeight; ++y) {
      const topIndex = y * rowBytes;
      const bottomIndex = (ssWidth - y - 1) * rowBytes;
      for (let x = 0; x < rowBytes; ++x) {
        const topPixel = pixels[topIndex + x];
        pixels[topIndex + x] = pixels[bottomIndex + x];
        pixels[bottomIndex + x] = topPixel;
      }
    }

    if (ssaa > 1.0) {
      const ssCanvas = document.createElement("canvas");
      ssCanvas.width = ssWidth;
      ssCanvas.height = ssHeight;
      const ssContext = ssCanvas.getContext("2d")!;

      const ssImageData = ssContext.createImageData(ssWidth, ssHeight);
      ssImageData.data.set(pixels);
      ssContext.putImageData(ssImageData, 0, 0);
      context.drawImage(ssCanvas, 0, 0, ssWidth, ssHeight, 0, 0, width, height);
    } else {
      const imageData = context.createImageData(width, height);
      imageData.data.set(pixels);
      context.putImageData(imageData, 0, 0);
    }

    return canvas.toDataURL("image/png");
  }

  public getObjectScreenshot(width: number, height: number, padding: number, ssaa: number): string {
    const renderTarget = this.renderObjectToRenderTarget(width, height, padding, ssaa);
    const dataUrl = this.getDataUrlFromRenderTarget(renderTarget, width, height, ssaa);
    return dataUrl;
  }

  public async screenshot(
    model: Object3D | string,
    animationURL: string,
    width: number,
    height: number,
    padding: number,
    ssaa: number,
  ): Promise<string> {
    await this.setupModel(model);
    await this.setupAnimation(animationURL);
    return this.getObjectScreenshot(width, height, padding, ssaa);
  }
}
