import { HDRJPGLoader } from "@monogrid/gainmap-js";
import {
  AmbientLight,
  Color,
  EquirectangularReflectionMapping,
  Euler,
  Fog,
  LinearSRGBColorSpace,
  LoadingManager,
  MathUtils,
  PMREMGenerator,
  Scene,
  Texture,
  WebGLRenderer,
} from "three";
import { RGBELoader } from "three/examples/jsm/loaders/RGBELoader.js";

import { CameraManager } from "../camera/CameraManager";
import { Sun } from "../sun/Sun";
import { TimeManager } from "../time/TimeManager";
import { envValues, sunValues } from "../tweakpane/blades/environmentFolder";
import { TweakPane } from "../tweakpane/TweakPane";

type ComposerContructorArgs = {
  scene: Scene;
  cameraManager: CameraManager;
  spawnSun: boolean;
  environmentConfiguration?: EnvironmentConfiguration;
};

export type EnvironmentConfiguration = {
  groundPlane?: boolean;
  skybox?: {
    intensity?: number;
    blurriness?: number;
    azimuthalAngle?: number;
    polarAngle?: number;
  } & (
    | {
        hdrJpgUrl: string;
      }
    | {
        hdrUrl: string;
      }
  );
  envMap?: {
    intensity?: number;
  };
  sun?: {
    intensity?: number;
    polarAngle?: number;
    azimuthalAngle?: number;
  };
  fog?: {
    fogNear?: number;
    fogFar?: number;
    fogColor?: {
      r: number;
      g: number;
      b: number;
    };
  };
  postProcessing?: {
    bloomIntensity?: number;
  };
  ambientLight?: {
    intensity?: number;
  };
};

export class Composer {
  private width: number = 1;
  private height: number = 1;
  private resizeListener: () => void;
  private readonly scene: Scene;

  private readonly cameraManager: CameraManager;
  public readonly renderer: WebGLRenderer;

  private ambientLight: AmbientLight | null = null;
  private environmentConfiguration?: EnvironmentConfiguration;

  private skyboxState: {
    src: {
      hdrJpgUrl?: string;
      hdrUrl?: string;
    };
    latestPromise: Promise<unknown> | null;
  } = { src: {}, latestPromise: null };

  public sun: Sun | null = null;
  public spawnSun: boolean;

  constructor({
    scene,
    cameraManager,
    spawnSun = false,
    environmentConfiguration,
  }: ComposerContructorArgs) {
    this.scene = scene;
    this.cameraManager = cameraManager;
    this.spawnSun = spawnSun;

    this.environmentConfiguration = environmentConfiguration;

    this.renderer = new WebGLRenderer({
      powerPreference: "high-performance",
    });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = 2;

    this.updateSkyboxAndEnvValues();
    this.updateAmbientLightValues();
    this.updateFogValues();

    if (this.spawnSun === true) {
      this.sun = new Sun();
      this.scene.add(this.sun);
    }

    if (this.environmentConfiguration?.skybox) {
      if ("hdrJpgUrl" in this.environmentConfiguration.skybox) {
        this.useHDRJPG(this.environmentConfiguration.skybox.hdrJpgUrl);
      } else if ("hdrUrl" in this.environmentConfiguration.skybox) {
        this.useHDRI(this.environmentConfiguration.skybox.hdrUrl);
      }
    }

    this.updateSunValues();

    this.resizeListener = () => {
      this.fitContainer();
    };
    window.addEventListener("resize", this.resizeListener, false);
    this.fitContainer();
  }

  public updateEnvironmentConfiguration(environmentConfiguration: EnvironmentConfiguration) {
    this.environmentConfiguration = environmentConfiguration;

    if (environmentConfiguration.skybox) {
      if ("hdrJpgUrl" in environmentConfiguration.skybox) {
        this.useHDRJPG(environmentConfiguration.skybox.hdrJpgUrl);
      } else if ("hdrUrl" in environmentConfiguration.skybox) {
        this.useHDRI(environmentConfiguration.skybox.hdrUrl);
      }
    }

    this.updateSkyboxAndEnvValues();
    this.updateAmbientLightValues();
    this.updateSunValues();
    this.updateFogValues();
  }

  public setupTweakPane(tweakPane: TweakPane) {
    // TODO
    //   tweakPane.setupRenderPane(
    //     this.spawnSun,
    //     this.sun,
    //     this.setHDRIFromFile.bind(this),
    //     (azimuthalAngle: number) => {
    //       envValues.skyboxAzimuthalAngle = azimuthalAngle;
    //       this.updateSkyboxRotation();
    //     },
    //     (polarAngle: number) => {
    //       envValues.skyboxPolarAngle = polarAngle;
    //       this.updateSkyboxRotation();
    //     },
    //     this.setAmbientLight.bind(this),
    //     this.setFog.bind(this),
    //   );
  }

  public dispose() {
    window.removeEventListener("resize", this.resizeListener);
    // this.renderer.dispose();
  }

  public fitContainer() {
    if (!this) {
      console.error("Composer not initialized");
      return;
    }
    const parentElement = this.renderer.domElement.parentNode as HTMLElement;
    if (!parentElement) {
      return;
    }
    this.width = parentElement.clientWidth;
    this.height = parentElement.clientHeight;
    this.renderer.setSize(this.width, this.height);
    this.cameraManager.camera.aspect = this.width / this.height;
    this.cameraManager.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(window.devicePixelRatio);
  }

  public render(timeManager: TimeManager) {
    if (!this.renderer || !this.scene) {
      return;
    }
    this.renderer.render(this.scene, this.cameraManager.activeCamera);
  }

  public updateSkyboxRotation() {
    this.scene.backgroundRotation = new Euler(
      MathUtils.degToRad(envValues.skyboxPolarAngle),
      MathUtils.degToRad(envValues.skyboxAzimuthalAngle),
      0,
    );
    this.scene.environmentRotation = new Euler(
      MathUtils.degToRad(envValues.skyboxPolarAngle),
      MathUtils.degToRad(envValues.skyboxAzimuthalAngle),
      0,
    );
  }

  private async loadHDRJPG(url: string): Promise<Texture> {
    return new Promise((resolve, reject) => {
      const pmremGenerator = new PMREMGenerator(this.renderer);
      const hdrJpg = new HDRJPGLoader(this.renderer).load(url, () => {
        const hdrJpgEquirectangularMap = hdrJpg.renderTarget.texture;
        hdrJpgEquirectangularMap.mapping = EquirectangularReflectionMapping;
        hdrJpgEquirectangularMap.needsUpdate = true;

        const envMap = pmremGenerator!.fromEquirectangular(hdrJpgEquirectangularMap).texture;
        hdrJpgEquirectangularMap.dispose();
        pmremGenerator!.dispose();
        hdrJpg.dispose();
        if (envMap) {
          envMap.colorSpace = LinearSRGBColorSpace;
          envMap.needsUpdate = true;
          resolve(envMap);
        } else {
          reject("Failed to generate environment map");
        }
      });
    });
  }

  private async loadHDRi(url: string): Promise<Texture> {
    return new Promise((resolve, reject) => {
      const pmremGenerator = new PMREMGenerator(this.renderer);
      new RGBELoader(new LoadingManager()).load(url, (texture) => {
        const envMap = pmremGenerator!.fromEquirectangular(texture).texture;
        texture.dispose();
        pmremGenerator!.dispose();
        if (envMap) {
          envMap.colorSpace = LinearSRGBColorSpace;
          envMap.needsUpdate = true;
          resolve(envMap);
        } else {
          reject("Failed to generate environment map");
        }
      });
    });
  }

  public useHDRJPG(url: string, fromFile: boolean = false): void {
    if (this.skyboxState.src.hdrJpgUrl === url) {
      return;
    }

    const hdrJPGPromise = this.loadHDRJPG(url);
    this.skyboxState.src = { hdrJpgUrl: url };
    this.skyboxState.latestPromise = hdrJPGPromise;
    hdrJPGPromise.then((envMap) => {
      if (this.skyboxState.latestPromise !== hdrJPGPromise) {
        return;
      }
      this.applyEnvMap(envMap);
    });
  }

  public useHDRI(url: string): void {
    if (this.skyboxState.src.hdrUrl === url) {
      return;
    }
    const hdrPromise = this.loadHDRi(url);
    this.skyboxState.src = { hdrUrl: url };
    this.skyboxState.latestPromise = hdrPromise;
    hdrPromise.then((envMap) => {
      if (this.skyboxState.latestPromise !== hdrPromise) {
        return;
      }
      this.applyEnvMap(envMap);
    });
  }

  public setHDRIFromFile(): void {
    if (!this.renderer) return;
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = ".hdr,.jpg";
    fileInput.addEventListener("change", () => {
      const file = fileInput.files?.[0];
      if (!file) {
        console.log("no file");
        return;
      }
      const extension = file.name.split(".").pop();
      const fileURL = URL.createObjectURL(file);
      if (fileURL) {
        if (extension === "hdr") {
          this.useHDRI(fileURL);
        } else if (extension === "jpg") {
          this.useHDRJPG(fileURL);
        } else {
          console.error(`Unrecognized extension for HDR file ${file.name}`);
        }
        URL.revokeObjectURL(fileURL);
        document.body.removeChild(fileInput);
      }
    });
    document.body.appendChild(fileInput);
    fileInput.click();
  }

  public setFog(): void {
    if (envValues.fog.fogFar === 0) {
      this.scene.fog = null;
      return;
    }
    const fogColor = new Color().setRGB(
      envValues.fog.fogColor.r,
      envValues.fog.fogColor.g,
      envValues.fog.fogColor.b,
    );
    this.scene.fog = new Fog(fogColor, envValues.fog.fogNear, envValues.fog.fogFar);
  }

  public setAmbientLight(): void {
    if (this.ambientLight) {
      this.scene.remove(this.ambientLight);
      this.ambientLight.dispose();
    }
    const ambientLightColor = new Color().setRGB(
      envValues.ambientLight.ambientLightColor.r,
      envValues.ambientLight.ambientLightColor.g,
      envValues.ambientLight.ambientLightColor.b,
    );
    this.ambientLight = new AmbientLight(
      ambientLightColor,
      envValues.ambientLight.ambientLightIntensity,
    );
    this.scene.add(this.ambientLight);
  }

  private updateSunValues() {
    if (typeof this.environmentConfiguration?.sun?.intensity === "number") {
      sunValues.sunIntensity = this.environmentConfiguration.sun.intensity;
      this.sun?.setIntensity(this.environmentConfiguration.sun.intensity);
    }
    if (typeof this.environmentConfiguration?.sun?.azimuthalAngle === "number") {
      sunValues.sunPosition.sunAzimuthalAngle = this.environmentConfiguration.sun.azimuthalAngle;
      this.sun?.setAzimuthalAngle(
        this.environmentConfiguration.sun.azimuthalAngle * (Math.PI / 180),
      );
    }
    if (typeof this.environmentConfiguration?.sun?.polarAngle === "number") {
      sunValues.sunPosition.sunPolarAngle = this.environmentConfiguration.sun.polarAngle;
      this.sun?.setPolarAngle(this.environmentConfiguration.sun.polarAngle * (Math.PI / 180));
    }
  }

  private updateFogValues() {
    if (typeof this.environmentConfiguration?.fog?.fogNear === "number") {
      envValues.fog.fogNear = this.environmentConfiguration.fog.fogNear;
    }
    if (typeof this.environmentConfiguration?.fog?.fogFar === "number") {
      envValues.fog.fogFar = this.environmentConfiguration.fog.fogFar;
    }
    if (
      typeof this.environmentConfiguration?.fog?.fogColor?.r === "number" &&
      typeof this.environmentConfiguration?.fog?.fogColor?.g === "number" &&
      typeof this.environmentConfiguration?.fog?.fogColor?.b === "number"
    ) {
      envValues.fog.fogColor.r = this.environmentConfiguration.fog.fogColor.r;
      envValues.fog.fogColor.g = this.environmentConfiguration.fog.fogColor.g;
      envValues.fog.fogColor.b = this.environmentConfiguration.fog.fogColor.b;
    }
    this.setFog();
  }

  private updateSkyboxAndEnvValues() {
    if (typeof this.environmentConfiguration?.envMap?.intensity === "number") {
      envValues.envMapIntensity = this.environmentConfiguration?.envMap.intensity;
    }
    this.scene.environmentIntensity = envValues.envMapIntensity;

    if (typeof this.environmentConfiguration?.skybox?.intensity === "number") {
      envValues.skyboxIntensity = this.environmentConfiguration?.skybox.intensity;
    }
    this.scene.backgroundIntensity = envValues.skyboxIntensity;

    if (typeof this.environmentConfiguration?.skybox?.blurriness === "number") {
      envValues.skyboxBlurriness = this.environmentConfiguration?.skybox.blurriness;
    }
    this.scene.backgroundBlurriness = envValues.skyboxBlurriness;

    if (typeof this.environmentConfiguration?.skybox?.azimuthalAngle === "number") {
      envValues.skyboxAzimuthalAngle = this.environmentConfiguration?.skybox.azimuthalAngle;
      this.updateSkyboxRotation();
    }

    if (typeof this.environmentConfiguration?.skybox?.polarAngle === "number") {
      envValues.skyboxPolarAngle = this.environmentConfiguration?.skybox.polarAngle;
      this.updateSkyboxRotation();
    }
  }

  private updateBloomValues() {
    // if (typeof this.environmentConfiguration?.postProcessing?.bloomIntensity === "number") {
    //   extrasValues.bloom = this.environmentConfiguration.postProcessing.bloomIntensity;
    // }
    // this.bloomEffect.intensity = extrasValues.bloom;
  }

  private updateAmbientLightValues() {
    if (typeof this.environmentConfiguration?.ambientLight?.intensity === "number") {
      envValues.ambientLight.ambientLightIntensity =
        this.environmentConfiguration.ambientLight.intensity;
    }
    this.setAmbientLight();
  }

  private applyEnvMap(envMap: Texture) {
    this.scene.environment = envMap;
    this.scene.environmentIntensity = envValues.envMapIntensity;
    this.scene.environmentRotation = new Euler(
      MathUtils.degToRad(envValues.skyboxPolarAngle),
      MathUtils.degToRad(envValues.skyboxAzimuthalAngle),
      0,
    );
    this.scene.background = envMap;
    this.scene.backgroundIntensity = envValues.skyboxIntensity;
    this.scene.backgroundBlurriness = envValues.skyboxBlurriness;
    this.scene.backgroundRotation = new Euler(
      MathUtils.degToRad(envValues.skyboxPolarAngle),
      MathUtils.degToRad(envValues.skyboxAzimuthalAngle),
      0,
    );
  }
}
