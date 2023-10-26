import { ModelLoader } from "@mml-io/3d-web-avatar";
import { TimeManager } from "@mml-io/3d-web-client-core";
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
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { RGBELoader } from "three/examples/jsm/loaders/RGBELoader.js";

import { Floor } from "./scene/Floor";
import { Lights } from "./scene/Lights";

export class AvatarRenderer {
  private readonly camOffset: Vector3 = new Vector3(0, 1.2, 0);
  private readonly floorSize: number = 50;
  private readonly fogDistance: number = this.floorSize - this.floorSize * 0.1;

  private canvasDiv: HTMLDivElement | null = null;

  private timeManager: TimeManager = new TimeManager();
  private modelLoader: ModelLoader = new ModelLoader();

  public renderer: WebGLRenderer | null = null;
  public scene: Scene;

  private camera: PerspectiveCamera | null = null;
  private mixer: AnimationMixer | null = null;
  private animationAsset: GLTF | null | undefined = null;

  private lights: Lights;
  private lookAt: Vector3;
  private floor: Mesh | null = null;
  private orbitControls: OrbitControls;

  constructor() {
    this.scene = new Scene();
    this.scene.fog = new Fog(new Color().setRGB(0.42, 0.48, 0.6), 1, this.fogDistance);
    this.renderer = new WebGLRenderer({ antialias: true });
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    this.renderer.shadowMap.enabled = true;
    this.renderer.setSize(window.innerWidth, window.innerHeight);

    this.useHDRI("/assets/hdr/industrial_sunset_2k.hdr");

    this.lookAt = new Vector3().copy(this.scene.position).add(this.camOffset);

    this.camera = new PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.01, 400);
    this.camera.position.set(-1, 1.3, 3);
    this.camera.lookAt(this.lookAt);
    this.camera.updateProjectionMatrix();

    this.orbitControls = new OrbitControls(this.camera, this.renderer.domElement);
    this.orbitControls.domElement = this.renderer.domElement;
    this.orbitControls.enableDamping = true;
    this.orbitControls.dampingFactor = 0.07;
    this.orbitControls.minDistance = 0.0001;
    this.orbitControls.maxDistance = 200;
    this.orbitControls.update();

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
    if (!this.camera || !this.renderer) return;
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
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

  public async animateCharacter(model: Object3D) {
    this.mixer = new AnimationMixer(model);
    if (this.animationAsset === null) {
      this.animationAsset = await this.modelLoader.load("/assets/avatar/AS_Andor_Stand_Idle.glb");
    }
    if (this.animationAsset && this.animationAsset.animations) {
      const animationClip = this.animationAsset.animations[0];
      const animationAction = this.mixer.clipAction(animationClip);
      animationAction.setLoop(LoopRepeat, Infinity);
      animationAction.play();
    }
  }

  public update(): void {
    if (!this.scene || !this.camera || !this.renderer) return;
    this.timeManager.update();
    if (!this.canvasDiv) {
      const canvasDiv = document.getElementById("avatar-canvas-container");
      if (canvasDiv !== null) {
        this.canvasDiv = canvasDiv as HTMLDivElement;
        this.canvasDiv.appendChild(this.renderer.domElement);
      }
    }
    this.renderer.render(this.scene, this.camera);
    this.orbitControls.target = this.lookAt;
    this.orbitControls.update();
    if (this.mixer) {
      this.mixer.setTime(this.timeManager.time);
      this.mixer.update(this.timeManager.smoothDeltaTime);
    }
  }

  public dispose(): void {
    //
  }
}
