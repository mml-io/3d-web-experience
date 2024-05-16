import { HDRJPGLoader } from "@monogrid/gainmap-js";
import {
  EffectComposer,
  RenderPass,
  EffectPass,
  FXAAEffect,
  ShaderPass,
  BloomEffect,
  SSAOEffect,
  BlendFunction,
  TextureEffect,
  ToneMappingEffect,
  SMAAEffect,
  SMAAPreset,
  EdgeDetectionMode,
  PredicationMode,
  NormalPass,
} from "postprocessing";
import {
  AmbientLight,
  Color,
  Fog,
  HalfFloatType,
  LinearSRGBColorSpace,
  LoadingManager,
  PMREMGenerator,
  PerspectiveCamera,
  SRGBColorSpace,
  Scene,
  ShadowMapType,
  ToneMapping,
  Vector2,
  WebGLRenderer,
  EquirectangularReflectionMapping,
  MathUtils,
  Euler,
} from "three";
import { RGBELoader } from "three/examples/jsm/loaders/RGBELoader.js";

import { Sun } from "../sun/Sun";
import { TimeManager } from "../time/TimeManager";
import { bcsValues } from "../tweakpane/blades/bcsFolder";
import { envValues } from "../tweakpane/blades/environmentFolder";
import { extrasValues } from "../tweakpane/blades/postExtrasFolder";
import { rendererValues } from "../tweakpane/blades/rendererFolder";
import { n8ssaoValues, ppssaoValues } from "../tweakpane/blades/ssaoFolder";
import { toneMappingValues } from "../tweakpane/blades/toneMappingFolder";
import { TweakPane } from "../tweakpane/TweakPane";

import { BrightnessContrastSaturation } from "./post-effects/bright-contrast-sat";
import { GaussGrainEffect } from "./post-effects/gauss-grain";
import { N8SSAOPass } from "./post-effects/n8-ssao/N8SSAOPass";

export class Composer {
  private width: number = 1;
  private height: number = 1;
  private resizeListener: () => void;

  public resolution: Vector2 = new Vector2(this.width, this.height);

  private isEnvHDRI: boolean = false;

  private readonly scene: Scene;
  public postPostScene: Scene;
  private readonly camera: PerspectiveCamera;
  public readonly renderer: WebGLRenderer;

  public readonly effectComposer: EffectComposer;
  private readonly renderPass: RenderPass;

  private readonly normalPass: NormalPass;
  private readonly normalTextureEffect: TextureEffect;
  private readonly ppssaoEffect: SSAOEffect;
  private readonly ppssaoPass: EffectPass;
  private readonly n8aopass: N8SSAOPass;

  private readonly fxaaEffect: FXAAEffect;
  private readonly fxaaPass: EffectPass;
  private readonly bloomEffect: BloomEffect;
  private readonly bloomPass: EffectPass;
  private readonly toneMappingEffect: ToneMappingEffect;
  private readonly smaaEffect: SMAAEffect;

  private readonly toneMappingPass: EffectPass;
  private readonly smaaPass: EffectPass;

  private readonly bcs = BrightnessContrastSaturation;
  private readonly bcsPass: ShaderPass;

  private readonly gaussGrainEffect = GaussGrainEffect;
  private readonly gaussGrainPass: ShaderPass;

  private ambientLight: AmbientLight | null = null;

  public sun: Sun | null = null;
  public spawnSun: boolean;

  constructor(scene: Scene, camera: PerspectiveCamera, spawnSun: boolean = false) {
    this.scene = scene;
    this.postPostScene = new Scene();
    this.camera = camera;
    this.spawnSun = spawnSun;
    this.renderer = new WebGLRenderer({
      powerPreference: "high-performance",
      antialias: false,
    });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.info.autoReset = false;
    this.renderer.setSize(this.width, this.height);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = rendererValues.shadowMap as ShadowMapType;
    this.renderer.toneMapping = rendererValues.toneMapping as ToneMapping;
    this.renderer.toneMappingExposure = rendererValues.exposure;

    this.scene.backgroundIntensity = envValues.hdrIntensity;
    this.scene.backgroundBlurriness = envValues.hdrBlurriness;

    this.setAmbientLight();
    this.setFog();

    this.effectComposer = new EffectComposer(this.renderer, {
      frameBufferType: HalfFloatType,
    });

    this.renderPass = new RenderPass(this.scene, this.camera);

    this.normalPass = new NormalPass(this.scene, this.camera);
    this.normalPass.enabled = ppssaoValues.enabled;
    this.normalTextureEffect = new TextureEffect({
      blendFunction: BlendFunction.SKIP,
      texture: this.normalPass.texture,
    });

    this.ppssaoEffect = new SSAOEffect(this.camera, this.normalPass.texture, {
      blendFunction: ppssaoValues.blendFunction,
      distanceScaling: ppssaoValues.distanceScaling,
      depthAwareUpsampling: ppssaoValues.depthAwareUpsampling,
      samples: ppssaoValues.samples,
      rings: ppssaoValues.rings,
      luminanceInfluence: ppssaoValues.luminanceInfluence,
      radius: ppssaoValues.radius,
      intensity: ppssaoValues.intensity,
      bias: ppssaoValues.bias,
      fade: ppssaoValues.fade,
      resolutionScale: ppssaoValues.resolutionScale,
      color: new Color().setRGB(ppssaoValues.color.r, ppssaoValues.color.g, ppssaoValues.color.b),
      worldDistanceThreshold: ppssaoValues.worldDistanceThreshold,
      worldDistanceFalloff: ppssaoValues.worldDistanceFalloff,
      worldProximityThreshold: ppssaoValues.worldProximityThreshold,
      worldProximityFalloff: ppssaoValues.worldProximityFalloff,
    });
    this.ppssaoPass = new EffectPass(this.camera, this.ppssaoEffect, this.normalTextureEffect);
    this.ppssaoPass.enabled = ppssaoValues.enabled;

    this.fxaaEffect = new FXAAEffect();
    this.bloomEffect = new BloomEffect({
      intensity: extrasValues.bloom,
    });

    this.n8aopass = new N8SSAOPass(this.scene, this.camera, this.width, this.height);
    this.n8aopass.configuration.aoRadius = n8ssaoValues.aoRadius;
    this.n8aopass.configuration.distanceFalloff = n8ssaoValues.distanceFalloff;
    this.n8aopass.configuration.intensity = n8ssaoValues.intensity;
    this.n8aopass.configuration.color = new Color().setRGB(
      n8ssaoValues.color.r,
      n8ssaoValues.color.g,
      n8ssaoValues.color.b,
    );
    this.n8aopass.configuration.aoSamples = n8ssaoValues.aoSamples;
    this.n8aopass.configuration.denoiseSamples = n8ssaoValues.denoiseSamples;
    this.n8aopass.configuration.denoiseRadius = n8ssaoValues.denoiseRadius;
    this.n8aopass.enabled = n8ssaoValues.enabled;

    this.fxaaPass = new EffectPass(this.camera, this.fxaaEffect);
    this.bloomPass = new EffectPass(this.camera, this.bloomEffect);

    this.toneMappingEffect = new ToneMappingEffect({
      mode: toneMappingValues.mode,
      resolution: toneMappingValues.resolution,
      whitePoint: toneMappingValues.whitePoint,
      middleGrey: toneMappingValues.middleGrey,
      minLuminance: toneMappingValues.minLuminance,
      averageLuminance: toneMappingValues.averageLuminance,
      adaptationRate: toneMappingValues.adaptationRate,
    });
    this.smaaEffect = new SMAAEffect({
      preset: SMAAPreset.ULTRA,
      edgeDetectionMode: EdgeDetectionMode.COLOR,
      predicationMode: PredicationMode.DEPTH,
    });

    this.toneMappingPass = new EffectPass(this.camera, this.toneMappingEffect);
    this.toneMappingPass.enabled =
      rendererValues.toneMapping === 5 || rendererValues.toneMapping === 0 ? true : false;

    this.bcsPass = new ShaderPass(this.bcs, "tDiffuse");
    this.bcs.uniforms.brightness.value = bcsValues.brightness;
    this.bcs.uniforms.contrast.value = bcsValues.contrast;
    this.bcs.uniforms.saturation.value = bcsValues.saturation;

    this.gaussGrainPass = new ShaderPass(this.gaussGrainEffect, "tDiffuse");
    this.gaussGrainEffect.uniforms.amount.value = extrasValues.grain;
    this.gaussGrainEffect.uniforms.alpha.value = 1.0;

    this.smaaPass = new EffectPass(this.camera, this.smaaEffect);

    this.effectComposer.addPass(this.renderPass);
    if (ppssaoValues.enabled) {
      this.effectComposer.addPass(this.normalPass);
      this.effectComposer.addPass(this.ppssaoPass);
    }
    if (n8ssaoValues.enabled) {
      this.effectComposer.addPass(this.n8aopass);
    }
    this.effectComposer.addPass(this.fxaaPass);
    this.effectComposer.addPass(this.bloomPass);
    this.effectComposer.addPass(this.toneMappingPass);
    this.effectComposer.addPass(this.bcsPass);
    this.effectComposer.addPass(this.gaussGrainPass);

    if (this.spawnSun === true) {
      this.sun = new Sun();
      this.scene.add(this.sun);
    }

    this.resizeListener = () => {
      this.fitContainer();
    };
    window.addEventListener("resize", this.resizeListener, false);
    this.fitContainer();
  }

  public setupTweakPane(tweakPane: TweakPane) {
    tweakPane.setupRenderPane(
      this.effectComposer,
      this.normalPass,
      this.ppssaoEffect,
      this.ppssaoPass,
      this.n8aopass,
      this.toneMappingEffect,
      this.toneMappingPass,
      this.bcs,
      this.bloomEffect,
      this.gaussGrainEffect,
      this.spawnSun,
      this.sun,
      this.setHDRIFromFile.bind(this),
      this.setHDRAzimuthalAngle.bind(this),
      this.setHDRPolarAngle.bind(this),
      this.setAmbientLight.bind(this),
      this.setFog.bind(this),
    );
  }

  public dispose() {
    window.removeEventListener("resize", this.resizeListener);
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
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.resolution.set(
      this.width * window.devicePixelRatio,
      this.height * window.devicePixelRatio,
    );
    this.effectComposer.setSize(
      this.width / window.devicePixelRatio,
      this.height / window.devicePixelRatio,
    );
    this.renderPass.setSize(this.width, this.height);
    if (ppssaoValues.enabled) {
      this.normalPass.setSize(this.width, this.height);
      this.normalTextureEffect.setSize(this.width, this.height);
      this.ppssaoPass.setSize(this.width, this.height);
    }
    if (n8ssaoValues.enabled) {
      this.n8aopass.setSize(this.width, this.height);
    }
    this.fxaaPass.setSize(this.width, this.height);
    this.smaaPass.setSize(this.width, this.height);
    this.bloomPass.setSize(this.width, this.height);
    this.toneMappingPass.setSize(this.width, this.height);
    this.gaussGrainPass.setSize(this.width, this.height);
    this.gaussGrainEffect.uniforms.resolution.value = new Vector2(this.width, this.height);
    this.renderer.setSize(this.width, this.height);
  }

  public render(timeManager: TimeManager): void {
    this.renderer.info.reset();
    this.normalPass.texture.needsUpdate = true;
    this.gaussGrainEffect.uniforms.time.value = timeManager.time;
    this.effectComposer.render();
    this.renderer.clearDepth();
    this.renderer.render(this.postPostScene, this.camera);
  }

  public setHDRAzimuthalAngle(azimuthalAngle: number) {
    this.scene.backgroundRotation = new Euler(
      MathUtils.degToRad(envValues.hdrPolarAngle),
      MathUtils.degToRad(azimuthalAngle),
      0,
    );
  }

  public setHDRPolarAngle(polarAngle: number) {
    this.scene.backgroundRotation = new Euler(
      MathUtils.degToRad(polarAngle),
      MathUtils.degToRad(envValues.hdrAzimuthalAngle),
      0,
    );
  }

  public useHDRJPG(url: string, fromFile: boolean = false): void {
    const pmremGenerator = new PMREMGenerator(this.renderer);
    const hdrJpg = new HDRJPGLoader(this.renderer).load(url, () => {
      const hdrJpgEquirectangularMap = hdrJpg.renderTarget.texture;

      hdrJpgEquirectangularMap.mapping = EquirectangularReflectionMapping;
      hdrJpgEquirectangularMap.needsUpdate = true;

      const envMap = pmremGenerator!.fromEquirectangular(hdrJpgEquirectangularMap).texture;
      if (envMap) {
        envMap.colorSpace = LinearSRGBColorSpace;
        envMap.needsUpdate = true;
        this.scene.background = envMap;
        this.scene.backgroundIntensity = envValues.hdrIntensity;
        this.scene.backgroundBlurriness = envValues.hdrBlurriness;
        this.scene.backgroundRotation = new Euler(
          MathUtils.degToRad(envValues.hdrPolarAngle),
          MathUtils.degToRad(envValues.hdrAzimuthalAngle),
          0,
        );
        this.isEnvHDRI = true;
        hdrJpgEquirectangularMap.dispose();
        pmremGenerator!.dispose();
      }

      hdrJpg.dispose();
    });
  }

  public useHDRI(url: string, fromFile: boolean = false): void {
    if ((this.isEnvHDRI && fromFile === false) || !this.renderer) return;
    const pmremGenerator = new PMREMGenerator(this.renderer);
    new RGBELoader(new LoadingManager()).load(
      url,
      (texture) => {
        const envMap = pmremGenerator!.fromEquirectangular(texture).texture;
        if (envMap) {
          envMap.colorSpace = LinearSRGBColorSpace;
          envMap.needsUpdate = true;
          this.scene.background = envMap;
          this.scene.backgroundIntensity = envValues.hdrIntensity;
          this.scene.backgroundBlurriness = envValues.hdrBlurriness;
          this.isEnvHDRI = true;
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
          this.useHDRI(fileURL, true);
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
}
