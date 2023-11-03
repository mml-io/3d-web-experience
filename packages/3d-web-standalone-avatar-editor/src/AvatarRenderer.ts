import { ModelLoader } from "@mml-io/3d-web-avatar";
import { BodyPartTypes } from "@mml-io/3d-web-avatar-editor-ui";
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
  private lookAt: Vector3;
  private floor: Mesh | null = null;

  public selectedPart: BodyPartTypes = "fullBody";
  private cameraFocusMap: Map<string, Vector3> = new Map();

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

    this.lookAt = new Vector3().copy(this.scene.position).add(this.camOffset);

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

  public setSelectedPart(part: BodyPartTypes) {
    if (!this.cameraManager) return;
    this.selectedPart = part;
    if (this.cameraFocusMap.has(part)) {
      this.cameraManager.setLerpedTarget(this.cameraFocusMap.get(part)!);
      switch (part) {
        case "fullBody": {
          this.cameraManager.targetDistance = 2.5;
          break;
        }
        case "head": {
          this.cameraManager.targetDistance = 0.8;
          break;
        }
        case "upperBody": {
          this.cameraManager.targetDistance = 1.2;
          break;
        }
        case "lowerBody": {
          this.cameraManager.targetDistance = 1.3;
          break;
        }
        case "feet": {
          this.cameraManager.targetDistance = 0.9;
          break;
        }
        default: {
          break;
        }
      }
    }
  }

  public async animateCharacter(model: Object3D) {
    model.traverse((child) => {
      if (child.type === "Bone") {
        if (child.name === "head") {
          this.cameraFocusMap.set("head", child.getWorldPosition(new Vector3()));
        }
        if (child.name === "spine_01") {
          this.cameraFocusMap.set("fullBody", child.getWorldPosition(new Vector3()));
        }
        if (child.name === "spine_03") {
          this.cameraFocusMap.set("upperBody", child.getWorldPosition(new Vector3()));
        }
        if (child.name === "pelvis") {
          this.cameraFocusMap.set(
            "lowerBody",
            child.getWorldPosition(new Vector3()).sub(new Vector3(0.0, 0.35, 0.0)),
          );
          this.cameraFocusMap.set(
            "feet",
            child.getWorldPosition(new Vector3()).sub(new Vector3(0.0, 0.8, 0.0)),
          );
        }
      }
    });
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
      this.cameraManager.setLerpedTarget(new Vector3(0, 0.9, 0));
      this.cameraManager.targetDistance = 2.1;
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
