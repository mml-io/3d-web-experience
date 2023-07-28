import {
  EffectComposer,
  RenderPass,
  EffectPass,
  FXAAEffect,
  ShaderPass,
  BloomEffect,
  SSAOEffect,
  NormalPass,
  BlendFunction,
  TextureEffect,
  ToneMappingEffect,
  SMAAEffect,
  SMAAPreset,
  EdgeDetectionMode,
  PredicationMode,
  BrightnessContrastEffect,
  HueSaturationEffect,
} from "postprocessing";
import {
  LinearSRGBColorSpace,
  LoadingManager,
  PMREMGenerator,
  PerspectiveCamera,
  Scene,
  ShadowMapType,
  ToneMapping,
  Vector2,
  WebGLRenderer,
} from "three";
import { RGBELoader } from "three/examples/jsm/loaders/RGBELoader.js";

import { TimeManager } from "../time/TimeManager";
import { composerValues as vals } from "../tweakpane/composerSettings";
import { TweakPane } from "../tweakpane/TweakPane";

import { GaussGrainEffect } from "./post-effects/gauss-grain";

export class Composer {
  private width: number = window.innerWidth;
  private height: number = window.innerHeight;

  public resolution: Vector2 = new Vector2(this.width, this.height);

  private isEnvHDRI: boolean = false;

  private readonly scene: Scene;
  private readonly camera: PerspectiveCamera;
  public readonly renderer: WebGLRenderer;

  private readonly composer: EffectComposer;
  private readonly renderPass: RenderPass;
  private readonly fxaaEffect: FXAAEffect;
  private readonly fxaaPass: EffectPass;
  private readonly bloomEffect: BloomEffect;
  private readonly bloomPass: EffectPass;
  private readonly toneMappingEffect: ToneMappingEffect;
  private readonly smaaEffect: SMAAEffect;
  private readonly brightnessContrastEffect: BrightnessContrastEffect;
  private readonly hueSaturationEffect: HueSaturationEffect;

  private readonly normalPass: NormalPass;
  private readonly normalTextureEffect: TextureEffect;
  private readonly ssaoEffect: SSAOEffect;
  private readonly ssaoPass: EffectPass;
  private readonly toneMappingPass: EffectPass;
  private readonly smaaPass: EffectPass;
  private readonly bchsPass: EffectPass;

  private readonly gaussGrainEffect = GaussGrainEffect;
  private readonly gaussGrainPass: ShaderPass;

  private tweakPane: TweakPane;

  constructor(scene: Scene, camera: PerspectiveCamera) {
    this.scene = scene;
    this.camera = camera;
    this.renderer = new WebGLRenderer({
      powerPreference: "high-performance",
      antialias: false,
      stencil: false,
      depth: false,
    });
    this.renderer.info.autoReset = false;
    this.renderer.setSize(this.width, this.height);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = vals.renderer.shadowMap as ShadowMapType;
    this.renderer.toneMapping = vals.renderer.toneMapping as ToneMapping;
    this.renderer.toneMappingExposure = vals.renderer.exposure;

    document.body.appendChild(this.renderer.domElement);

    this.composer = new EffectComposer(this.renderer);

    this.tweakPane = new TweakPane(this.renderer, this.scene, this.composer);

    this.renderPass = new RenderPass(this.scene, this.camera);
    this.normalPass = new NormalPass(this.scene, this.camera);
    this.normalTextureEffect = new TextureEffect({
      blendFunction: BlendFunction.SKIP,
      texture: this.normalPass.texture,
    });

    this.fxaaEffect = new FXAAEffect();
    this.bloomEffect = new BloomEffect({
      intensity: vals.bloom,
    });
    this.ssaoEffect = new SSAOEffect(this.camera, this.normalPass.texture, {
      ...vals.ssao,
    });

    this.fxaaPass = new EffectPass(this.camera, this.fxaaEffect);
    this.bloomPass = new EffectPass(this.camera, this.bloomEffect);
    this.ssaoPass = new EffectPass(this.camera, this.ssaoEffect, this.normalTextureEffect);
    this.toneMappingEffect = new ToneMappingEffect({
      mode: vals.toneMapping.mode,
      resolution: vals.toneMapping.resolution,
      whitePoint: vals.toneMapping.whitePoint,
      middleGrey: vals.toneMapping.middleGrey,
      minLuminance: vals.toneMapping.minLuminance,
      averageLuminance: vals.toneMapping.averageLuminance,
      adaptationRate: vals.toneMapping.adaptationRate,
    });
    this.smaaEffect = new SMAAEffect({
      preset: SMAAPreset.ULTRA,
      edgeDetectionMode: EdgeDetectionMode.COLOR,
      predicationMode: PredicationMode.DEPTH,
    });

    this.toneMappingPass = new EffectPass(this.camera, this.toneMappingEffect);
    this.toneMappingPass.enabled = vals.renderer.toneMapping === 5 ? true : false;

    this.gaussGrainPass = new ShaderPass(this.gaussGrainEffect, "tDiffuse");
    this.smaaPass = new EffectPass(this.camera, this.smaaEffect);

    this.brightnessContrastEffect = new BrightnessContrastEffect({
      brightness: vals.brightness,
      contrast: vals.contrast,
    });
    this.hueSaturationEffect = new HueSaturationEffect({
      hue: vals.hue,
      saturation: vals.saturation,
    });
    this.bchsPass = new EffectPass(
      this.camera,
      this.brightnessContrastEffect,
      this.hueSaturationEffect,
    );

    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.normalPass);
    this.composer.addPass(this.ssaoPass);
    this.composer.addPass(this.fxaaPass);
    this.composer.addPass(this.smaaPass);
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(this.toneMappingPass);
    this.composer.addPass(this.bchsPass);
    this.composer.addPass(this.gaussGrainPass);

    this.tweakPane.setupRenderPane(
      this.ssaoEffect,
      this.toneMappingEffect,
      this.toneMappingPass,
      this.brightnessContrastEffect,
      this.hueSaturationEffect,
      this.bloomEffect,
      this.gaussGrainEffect,
    );
    window.addEventListener("resize", () => this.updateProjection());
    this.updateProjection();
  }

  private updateProjection(): void {
    this.width = window.innerWidth;
    this.height = innerHeight;
    this.resolution = new Vector2(this.width, this.height);
    this.composer.setSize(this.width, this.height);
    this.renderPass.setSize(this.width, this.height);
    this.normalPass.setSize(this.width, this.height);
    this.ssaoPass.setSize(this.width, this.height);
    this.fxaaPass.setSize(this.width, this.height);
    this.smaaPass.setSize(this.width, this.height);
    this.bloomPass.setSize(this.width, this.height);
    this.toneMappingPass.setSize(this.width, this.height);
    this.bchsPass.setSize(this.width, this.height);
    this.gaussGrainPass.setSize(this.width, this.height);
    this.renderer.setSize(this.width, this.height);
  }

  public isTweakPaneVisible(): boolean {
    return this.tweakPane.guiVisible;
  }

  public render(timeManager: TimeManager): void {
    this.renderer.info.reset();
    this.normalPass.texture.needsUpdate = true;
    this.gaussGrainEffect.uniforms.resolution.value = this.resolution;
    this.gaussGrainEffect.uniforms.time.value = timeManager.time;
    this.gaussGrainEffect.uniforms.alpha.value = 1.0;
    this.composer.render();

    if (this.tweakPane.guiVisible) {
      this.tweakPane.updateStats(timeManager);
    }
  }

  public useHDRI(url: string): void {
    if (this.isEnvHDRI || !this.renderer) return;
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
          this.scene.backgroundIntensity = vals.renderer.bgIntensity;
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
}
