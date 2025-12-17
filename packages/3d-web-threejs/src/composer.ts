import { HDRJPGLoader } from "@monogrid/gainmap-js";
import {
  AmbientLight,
  Color,
  CubeCamera,
  EquirectangularReflectionMapping,
  Euler,
  Fog,
  HalfFloatType,
  LinearMipmapLinearFilter,
  LinearSRGBColorSpace,
  LoadingManager,
  MathUtils,
  PerspectiveCamera,
  PMREMGenerator,
  Scene,
  ShadowMapType,
  SRGBColorSpace,
  Texture,
  ToneMapping,
  Vector3,
  WebGLCubeRenderTarget,
  WebGLRenderer,
} from "three";
import { RGBELoader } from "three/examples/jsm/loaders/RGBELoader.js";
import { Sky } from "three/examples/jsm/objects/Sky.js";

import { ThreeJSCameraManager } from "./camera/ThreeJSCameraManager";
import { PostProcessingManager } from "./post-effects/PostProcessingManager";
import { Sun } from "./sun/Sun";
import {
  createDefaultEnvValues,
  createDefaultSunValues,
  EnvValues,
  SunValues,
} from "./tweakpane/blades/environmentFolder";
import { createDefaultRendererValues, RendererValues } from "./tweakpane/blades/rendererFolder";

type ComposerContructorArgs = {
  scene: Scene;
  cameraManager: ThreeJSCameraManager;
  spawnSun: boolean;
  environmentConfiguration?: EnvironmentConfiguration;
  postProcessingEnabled?: boolean;
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
  public postPostScene: Scene;
  private threeJSCameraManager: ThreeJSCameraManager;
  public readonly renderer: WebGLRenderer;

  private postProcessingManager: PostProcessingManager;
  private currentCamera: PerspectiveCamera;

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
  private sky: Sky | null = null;
  private skyDirty = true;
  private skyCubeCamera: CubeCamera | null = null;
  private skyRenderTarget: WebGLCubeRenderTarget | null = null;

  private currentAzimuthalAngle: number = 0;
  private currentPolarAngle: number = 0;
  private targetAzimuthalAngle: number = 0;
  private targetPolarAngle: number = 0;
  private currentIntensity: number = 0;
  private targetIntensity: number = 0;
  private readonly lerpSpeed: number = 0.05;

  private postProcessingEnabled: boolean | undefined;

  public readonly sunValues: SunValues;
  public readonly envValues: EnvValues;
  public readonly rendererValues: RendererValues;

  constructor({
    scene,
    cameraManager,
    spawnSun = false,
    environmentConfiguration,
    postProcessingEnabled,
  }: ComposerContructorArgs) {
    this.scene = scene;
    this.threeJSCameraManager = cameraManager;
    this.postPostScene = new Scene();
    this.spawnSun = spawnSun;
    this.postProcessingEnabled = postProcessingEnabled;

    this.sunValues = createDefaultSunValues();
    this.envValues = createDefaultEnvValues();
    this.rendererValues = createDefaultRendererValues();

    this.renderer = new WebGLRenderer({
      powerPreference: "high-performance",
      antialias: true,
    });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.info.autoReset = false;
    this.renderer.setSize(this.width, this.height);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = this.rendererValues.shadowMap as ShadowMapType;
    this.renderer.toneMapping = this.rendererValues.toneMapping as ToneMapping;
    this.renderer.toneMappingExposure = this.rendererValues.exposure;

    this.environmentConfiguration = environmentConfiguration;

    this.currentAzimuthalAngle = MathUtils.degToRad(this.sunValues.sunPosition.sunAzimuthalAngle);
    this.currentPolarAngle = MathUtils.degToRad(this.sunValues.sunPosition.sunPolarAngle);
    this.targetAzimuthalAngle = this.currentAzimuthalAngle;
    this.targetPolarAngle = this.currentPolarAngle;
    this.currentIntensity = this.sunValues.sunIntensity;
    this.targetIntensity = this.currentIntensity;

    this.currentCamera = this.threeJSCameraManager.getActiveCamera();
    this.postProcessingManager = new PostProcessingManager(
      this.renderer,
      this.scene,
      this.currentCamera,
      this.width,
      this.height,
      {
        enabled: this.postProcessingEnabled,
        bloom: { intensity: environmentConfiguration?.postProcessing?.bloomIntensity },
      },
    );

    this.updateSkyboxAndEnvValues();
    this.updateAmbientLightValues();
    this.updateFogValues();

    if (this.spawnSun === true) {
      this.sun = new Sun(this.sunValues);
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
    this.setupSkyShader();

    this.resizeListener = () => {
      this.fitContainer();
    };

    window.addEventListener("resize", this.resizeListener, false);

    this.fitContainer();
  }

  private setupSkyShader() {
    if (this.hasHDR()) {
      return;
    }
    this.sky = new Sky();
    this.sky.scale.setScalar(50000);

    this.sky.material.uniforms.sunPosition.value = new Vector3().setFromSphericalCoords(
      1,
      MathUtils.degToRad(this.sunValues.sunPosition.sunPolarAngle),
      MathUtils.degToRad(this.sunValues.sunPosition.sunAzimuthalAngle),
    );

    this.sky.material.uniforms.turbidity.value = this.sunValues.skyTurbidity;
    this.sky.material.uniforms.rayleigh.value = this.sunValues.skyRayleigh;
    this.sky.material.uniforms.mieCoefficient.value = this.sunValues.skyMieCoefficient;
    this.sky.material.uniforms.mieDirectionalG.value = this.sunValues.skyMieDirectionalG;

    this.skyRenderTarget = new WebGLCubeRenderTarget(512, {
      type: HalfFloatType,
      generateMipmaps: true,
      minFilter: LinearMipmapLinearFilter,
    });

    this.skyCubeCamera = new CubeCamera(1, 1.1, this.skyRenderTarget);
    this.skyCubeCamera.update(this.renderer, this.sky);
    this.scene.environment = this.skyRenderTarget.texture;
    this.scene.add(this.sky);
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
    this.updateBloomValues();
    this.updateSunValues();
    this.updateFogValues();
  }

  public dispose() {
    window.removeEventListener("resize", this.resizeListener);
    this.renderer.dispose();
    this.postProcessingManager.dispose();
  }

  public fitContainer() {
    const parentElement = this.renderer.domElement.parentNode as HTMLElement;
    if (!parentElement) {
      return;
    }
    this.width = parentElement.clientWidth;
    this.height = parentElement.clientHeight;
    this.threeJSCameraManager.updateAspect(this.width / this.height);
    this.renderer.setPixelRatio(window.devicePixelRatio);

    // delegate post-processing resize to manager
    this.postProcessingManager.resizeActiveEffects(this.width, this.height);
    this.renderer.setSize(this.width, this.height);
  }

  public render(): void {
    // check if camera has changed and update PostProcessingManager
    if (this.currentCamera !== this.threeJSCameraManager.getActiveCamera()) {
      this.currentCamera = this.threeJSCameraManager.getActiveCamera();
      this.postProcessingManager.updateCamera(this.currentCamera);
    }

    this.updateSun();

    this.renderer.info.reset();
    if (this.sky && this.skyCubeCamera && this.skyRenderTarget) {
      if (this.skyDirty) {
        this.skyDirty = false;
        this.skyCubeCamera?.update(this.renderer, this.sky);
      }
      this.scene.environment = this.skyRenderTarget.texture;
    }
    if (this.postProcessingManager.isGloballyEnabled) {
      this.postProcessingManager.render();
    } else {
      this.renderer.render(this.scene, this.threeJSCameraManager.getActiveCamera());
    }
    this.renderer.clearDepth();
    this.renderer.render(this.postPostScene, this.threeJSCameraManager.getActiveCamera());
  }

  private hasHDR(): boolean {
    if (!this.environmentConfiguration?.skybox) {
      return false;
    } else {
      const hasHDRJPG = "hdrJpgUrl" in this.environmentConfiguration.skybox;
      const hasHDRi = "hdrUrl" in this.environmentConfiguration.skybox;
      return hasHDRJPG || hasHDRi;
    }
  }

  public updateSkyboxRotation() {
    if (this.sky) {
      return;
    }
    this.scene.backgroundRotation = new Euler(
      MathUtils.degToRad(this.envValues.skyboxPolarAngle),
      MathUtils.degToRad(this.envValues.skyboxAzimuthalAngle),
      0,
    );
    this.scene.environmentRotation = new Euler(
      MathUtils.degToRad(this.envValues.skyboxPolarAngle),
      MathUtils.degToRad(this.envValues.skyboxAzimuthalAngle),
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

  public useHDRJPG(url: string): void {
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
    if (this.envValues.fog.fogFar === 0) {
      this.scene.fog = null;
      return;
    }
    const fogColor = new Color().setRGB(
      this.envValues.fog.fogColor.r,
      this.envValues.fog.fogColor.g,
      this.envValues.fog.fogColor.b,
    );
    this.scene.fog = new Fog(fogColor, this.envValues.fog.fogNear, this.envValues.fog.fogFar);
  }

  public setAmbientLight(): void {
    if (this.ambientLight) {
      this.scene.remove(this.ambientLight);
      this.ambientLight.dispose();
    }
    const ambientLightColor = new Color().setRGB(
      this.envValues.ambientLight.ambientLightColor.r,
      this.envValues.ambientLight.ambientLightColor.g,
      this.envValues.ambientLight.ambientLightColor.b,
    );
    this.ambientLight = new AmbientLight(
      ambientLightColor,
      this.envValues.ambientLight.ambientLightIntensity,
    );
    this.scene.add(this.ambientLight);
  }

  public updateSkyShaderValues() {
    if (!this.sky) {
      return;
    }
    const polarAngle = MathUtils.degToRad(this.sunValues.sunPosition.sunPolarAngle);
    const azimuthalAngle = MathUtils.degToRad(this.sunValues.sunPosition.sunAzimuthalAngle);
    const sunPosition = new Vector3().setFromSphericalCoords(1, polarAngle, azimuthalAngle);

    this.sky.material.uniforms.sunPosition.value = sunPosition;
    this.sky.material.uniforms.turbidity.value = this.sunValues.skyTurbidity;
    this.sky.material.uniforms.rayleigh.value = this.sunValues.skyRayleigh;
    this.sky.material.uniforms.mieCoefficient.value = this.sunValues.skyMieCoefficient;
    this.sky.material.uniforms.mieDirectionalG.value = this.sunValues.skyMieDirectionalG;
    this.skyDirty = true;
  }

  public updateSunValues() {
    if (typeof this.environmentConfiguration?.sun?.intensity === "number") {
      this.sunValues.sunIntensity = this.environmentConfiguration.sun.intensity;
    }
    if (typeof this.environmentConfiguration?.sun?.azimuthalAngle === "number") {
      this.sunValues.sunPosition.sunAzimuthalAngle =
        this.environmentConfiguration.sun.azimuthalAngle;
    }
    if (typeof this.environmentConfiguration?.sun?.polarAngle === "number") {
      this.sunValues.sunPosition.sunPolarAngle = this.environmentConfiguration.sun.polarAngle;
    }
    const { sunAzimuthalAngle, sunPolarAngle } = this.sunValues.sunPosition;
    this.targetAzimuthalAngle = MathUtils.degToRad(sunAzimuthalAngle);
    this.targetPolarAngle = MathUtils.degToRad(sunPolarAngle);
    this.targetIntensity = this.sunValues.sunIntensity;
  }

  public updateSun() {
    if (!this.sun) {
      return;
    }

    this.targetAzimuthalAngle = MathUtils.degToRad(this.sunValues.sunPosition.sunAzimuthalAngle);
    this.targetPolarAngle = MathUtils.degToRad(this.sunValues.sunPosition.sunPolarAngle);
    this.targetIntensity = this.sunValues.sunIntensity;

    let hasDiff = false;

    // Lerp towards target angles and intensity
    if (this.currentAzimuthalAngle !== this.targetAzimuthalAngle) {
      hasDiff = true;
    }
    this.currentAzimuthalAngle = this.lerpAngle(
      this.currentAzimuthalAngle,
      this.targetAzimuthalAngle,
      this.lerpSpeed,
    );
    if (Math.abs(this.currentAzimuthalAngle - this.targetAzimuthalAngle) < 0.001) {
      this.currentAzimuthalAngle = this.targetAzimuthalAngle;
    }

    if (this.currentPolarAngle !== this.targetPolarAngle) {
      hasDiff = true;
    }
    this.currentPolarAngle = this.lerpAngle(
      this.currentPolarAngle,
      this.targetPolarAngle,
      this.lerpSpeed,
    );
    if (Math.abs(this.currentPolarAngle - this.targetPolarAngle) < 0.001) {
      this.currentPolarAngle = this.targetPolarAngle;
    }

    if (this.currentIntensity !== this.targetIntensity) {
      hasDiff = true;
    }
    this.currentIntensity = this.lerp(this.currentIntensity, this.targetIntensity, this.lerpSpeed);
    if (Math.abs(this.currentIntensity - this.targetIntensity) < 0.001) {
      this.currentIntensity = this.targetIntensity;
    }

    this.sun.setColor();

    if (!hasDiff) {
      return; // No changes, skip update
    }
    // Update sun with lerped values
    this.sun.setAzimuthalAngle(this.currentAzimuthalAngle);
    this.sun.setPolarAngle(this.currentPolarAngle);
    this.sun.setIntensity(this.currentIntensity);

    // Update sky shader with lerped angles
    if (this.sky) {
      this.updateSkyShaderValuesWithLerpedAngles();
    }
  }

  private lerp(current: number, target: number, speed: number): number {
    return current + (target - current) * speed;
  }

  private lerpAngle(current: number, target: number, speed: number): number {
    // Calculate the shortest angular distance
    let diff = target - current;

    // Normalize the difference to [-π, π]
    while (diff > Math.PI) {
      diff -= 2 * Math.PI;
    }
    while (diff < -Math.PI) {
      diff += 2 * Math.PI;
    }

    // Lerp using the shortest path
    return current + diff * speed;
  }

  private updateSkyShaderValuesWithLerpedAngles() {
    if (!this.sky) {
      return;
    }
    const sunPosition = new Vector3().setFromSphericalCoords(
      1,
      this.currentPolarAngle,
      this.currentAzimuthalAngle,
    );

    this.sky.material.uniforms.sunPosition.value = sunPosition;
    this.sky.material.uniforms.turbidity.value = this.sunValues.skyTurbidity;
    this.sky.material.uniforms.rayleigh.value = this.sunValues.skyRayleigh;
    this.sky.material.uniforms.mieCoefficient.value = this.sunValues.skyMieCoefficient;
    this.sky.material.uniforms.mieDirectionalG.value = this.sunValues.skyMieDirectionalG;
    this.skyDirty = true;
  }

  private updateFogValues() {
    if (typeof this.environmentConfiguration?.fog?.fogNear === "number") {
      this.envValues.fog.fogNear = this.environmentConfiguration.fog.fogNear;
    }
    if (typeof this.environmentConfiguration?.fog?.fogFar === "number") {
      this.envValues.fog.fogFar = this.environmentConfiguration.fog.fogFar;
    }
    if (
      typeof this.environmentConfiguration?.fog?.fogColor?.r === "number" &&
      typeof this.environmentConfiguration?.fog?.fogColor?.g === "number" &&
      typeof this.environmentConfiguration?.fog?.fogColor?.b === "number"
    ) {
      this.envValues.fog.fogColor.r = this.environmentConfiguration.fog.fogColor.r;
      this.envValues.fog.fogColor.g = this.environmentConfiguration.fog.fogColor.g;
      this.envValues.fog.fogColor.b = this.environmentConfiguration.fog.fogColor.b;
    }
    this.setFog();
  }

  private updateSkyboxAndEnvValues() {
    if (typeof this.environmentConfiguration?.envMap?.intensity === "number") {
      this.envValues.envMapIntensity = this.environmentConfiguration?.envMap.intensity;
    }
    this.scene.environmentIntensity = this.envValues.envMapIntensity;

    if (typeof this.environmentConfiguration?.skybox?.intensity === "number") {
      this.envValues.skyboxIntensity = this.environmentConfiguration?.skybox.intensity;
    }
    this.scene.backgroundIntensity = this.envValues.skyboxIntensity;

    if (typeof this.environmentConfiguration?.skybox?.blurriness === "number") {
      this.envValues.skyboxBlurriness = this.environmentConfiguration?.skybox.blurriness;
    }
    this.scene.backgroundBlurriness = this.envValues.skyboxBlurriness;

    if (typeof this.environmentConfiguration?.skybox?.azimuthalAngle === "number") {
      this.envValues.skyboxAzimuthalAngle = this.environmentConfiguration?.skybox.azimuthalAngle;
      this.updateSkyboxRotation();
    }

    if (typeof this.environmentConfiguration?.skybox?.polarAngle === "number") {
      this.envValues.skyboxPolarAngle = this.environmentConfiguration?.skybox.polarAngle;
      this.updateSkyboxRotation();
    }
  }

  private updateBloomValues() {
    if (typeof this.environmentConfiguration?.postProcessing?.bloomIntensity === "number") {
      this.postProcessingManager.updateEffectConfiguration({
        bloom: { intensity: this.environmentConfiguration.postProcessing.bloomIntensity },
      });
    }
  }

  private updateAmbientLightValues() {
    if (typeof this.environmentConfiguration?.ambientLight?.intensity === "number") {
      this.envValues.ambientLight.ambientLightIntensity =
        this.environmentConfiguration.ambientLight.intensity;
    }
    this.setAmbientLight();
  }

  public togglePostProcessing(enabled: boolean) {
    this.postProcessingManager.toggleGlobalPostProcessing(enabled);
  }

  private applyEnvMap(envMap: Texture) {
    if (this.sky) {
      return;
    }
    this.scene.environment = envMap;
    this.scene.environmentIntensity = this.envValues.envMapIntensity;
    this.scene.environmentRotation = new Euler(
      MathUtils.degToRad(this.envValues.skyboxPolarAngle),
      MathUtils.degToRad(this.envValues.skyboxAzimuthalAngle),
      0,
    );
    this.scene.background = envMap;
    this.scene.backgroundIntensity = this.envValues.skyboxIntensity;
    this.scene.backgroundBlurriness = this.envValues.skyboxBlurriness;
    this.scene.backgroundRotation = new Euler(
      MathUtils.degToRad(this.envValues.skyboxPolarAngle),
      MathUtils.degToRad(this.envValues.skyboxAzimuthalAngle),
      0,
    );
  }
}
