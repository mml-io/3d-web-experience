import { TimeManager } from "@mml-io/3d-web-client-core";
import {
  Color,
  Fog,
  LinearSRGBColorSpace,
  LoadingManager,
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
import { RGBELoader } from "three/examples/jsm/loaders/RGBELoader.js";

import { Floor } from "./Floor";
import { Lights } from "./Lights";

export class AvatarVisualizer {
  private readonly camOffset: Vector3 = new Vector3(0, 1.2, 0);
  private readonly floorSize: number = 50;
  private readonly fogDistance: number = this.floorSize - this.floorSize * 0.1;

  private canvasDiv: HTMLDivElement | null = null;

  private scene: Scene;
  private renderer: WebGLRenderer | null = null;
  private camera: PerspectiveCamera | null = null;
  private lights: Lights;

  private lookAt: Vector3;

  private floor: Mesh | null = null;

  private orbitControls: OrbitControls;

  constructor(private timeManager: TimeManager) {
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

  private updateProjection(): void {
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
  }

  public addToScene(object: Object3D): void {
    this.scene.add(object);
  }

  public get avatarScene(): Scene {
    return this.scene;
  }

  public dispose(): void {
    //
  }
}
