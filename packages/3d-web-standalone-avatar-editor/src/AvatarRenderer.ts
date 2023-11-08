import { ModelLoader } from "@mml-io/3d-web-avatar";
import { TimeManager, CameraManager, CollisionsManager } from "@mml-io/3d-web-client-core";
import {
  AnimationMixer,
  Color,
  Fog,
  LinearSRGBColorSpace,
  LoadingManager,
  LoopRepeat,
  Mesh,
  Object3D,
  PCFSoftShadowMap,
  PMREMGenerator,
  Scene,
  Vector3,
  WebGLRenderer,
} from "three";
import { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { RGBELoader } from "three/examples/jsm/loaders/RGBELoader.js";

import { Floor } from "./scene/Floor";
import { Lights } from "./scene/Lights";

export class AvatarRenderer {
  private readonly camOffset: Vector3 = new Vector3(0, 1.2, 0);
  private readonly floorSize: number = 50;
  private readonly fogDistance: number = this.floorSize - this.floorSize * 0.1;

  private canvasDiv: HTMLDivElement | null = null;
  private cameraManager: CameraManager | null = null;

  private timeManager: TimeManager = new TimeManager();
  private modelLoader: ModelLoader = new ModelLoader();

  public renderer: WebGLRenderer | null = null;
  public scene: Scene;

  private mixer: AnimationMixer | null = null;
  private animationAsset: GLTF | null | undefined = null;

  private lights: Lights;
  private floor: Mesh | null = null;

  public cameraTargetOffset: { x?: number; y?: number; z?: number } = {};
  public cameraTargetDistance: number = 0;

  constructor(
    private hdrURL: string,
    private idleAnimationURL: string,
  ) {
    this.scene = new Scene();
    this.scene.fog = new Fog(new Color().setRGB(0.42, 0.48, 0.6), 1, this.fogDistance);
    this.renderer = new WebGLRenderer({ antialias: true });
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    this.renderer.shadowMap.enabled = true;
    this.renderer.setSize(window.innerWidth, window.innerHeight);

    this.useHDRI(this.hdrURL);

    // Floor
    this.floor = new Floor(this.floorSize).mesh;
    this.scene.add(this.floor);

    // Lights
    this.lights = new Lights(this.camOffset);
    this.scene.add(this.lights.ambientLight);
    this.scene.add(this.lights.mainLight);

    // Events
    this.update = this.update.bind(this);
    window.addEventListener("resize", this.updateProjection.bind(this));
  }

  public updateProjection(): void {
    if (!this.renderer) return;
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    if (this.cameraManager) {
      this.cameraManager.updateAspect(window.innerWidth / window.innerHeight);
    }
  }

  public useHDRI(url: string): void {
    if (!this.renderer) return;
    const pmremGenerator = new PMREMGenerator(this.renderer);
    new RGBELoader(new LoadingManager()).load(
      url,
      (texture) => {
        const envMap = pmremGenerator!.fromEquirectangular(texture).texture;
        if (envMap) {
          envMap.colorSpace = LinearSRGBColorSpace;
          envMap.needsUpdate = true;
          this.scene.environment = envMap;
          this.scene.background = envMap;
          this.scene.backgroundIntensity = 0.5;
          texture.dispose();
          pmremGenerator!.dispose();
        }
      },
      () => {},
      (error: ErrorEvent) => {
        console.error(`Can't load ${url}: ${JSON.stringify(error)}`);
      },
    );
  }

  public setDistanceAndOffset(
    cameraTargetOffset: { x?: number; y?: number; z?: number },
    cameraTargetDistance: number,
  ) {
    if (!this.cameraManager) return;
    this.cameraTargetOffset = cameraTargetOffset;
    this.cameraTargetDistance = cameraTargetDistance;
    this.cameraManager.setLerpedTarget(
      new Vector3(this.cameraTargetOffset.x, this.cameraTargetOffset.y, this.cameraTargetOffset.z),
      this.cameraTargetDistance,
    );
  }

  public async animateCharacter(model: Object3D) {
    this.mixer = new AnimationMixer(model);
    if (this.animationAsset === null) {
      this.animationAsset = await this.modelLoader.load(this.idleAnimationURL);
    }
    if (this.animationAsset && this.animationAsset.animations) {
      const animationClip = this.animationAsset.animations[0];
      const animationAction = this.mixer.clipAction(animationClip);
      animationAction.setLoop(LoopRepeat, Infinity);
      animationAction.play();
    }
  }

  public update(): void {
    if (!this.scene || !this.renderer) return;
    this.timeManager.update();
    if (!this.canvasDiv) {
      const canvasDiv = document.getElementById("avatar-canvas-container");
      if (canvasDiv !== null) {
        this.canvasDiv = canvasDiv as HTMLDivElement;
        this.canvasDiv.appendChild(this.renderer.domElement);
      }
    } else if (this.cameraManager === null) {
      this.cameraManager = new CameraManager(
        this.canvasDiv,
        new CollisionsManager(this.scene),
        Math.PI / 2.3,
        Math.PI / 2,
      );
      this.cameraManager.setLerpedTarget(new Vector3(0, 0.9, 0), 2.1);
    }
    if (this.cameraManager?.camera) {
      this.cameraManager.update();
      this.renderer.render(this.scene, this.cameraManager.camera);
    }
    if (this.mixer) {
      this.mixer.setTime(this.timeManager.time);
      this.mixer.update(this.timeManager.smoothDeltaTime);
    }
  }

  public dispose(): void {
    //
  }
}
