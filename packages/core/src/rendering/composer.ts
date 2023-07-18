import {
  EffectComposer,
  RenderPass,
  EffectPass,
  FXAAEffect,
  ShaderPass,
  BloomEffect,
} from "postprocessing";
import {
  ACESFilmicToneMapping,
  PCFSoftShadowMap,
  PerspectiveCamera,
  Scene,
  Vector2,
  WebGLRenderer,
} from "three";

import { GaussGrainEffect } from "./post-effects/gauss-grain";






  private readonly scene: Scene;
  private readonly camera: PerspectiveCamera;
  public readonly renderer: WebGLRenderer;

  private readonly composer: EffectComposer;
  private readonly renderPass: RenderPass;
  private readonly fxaaEffect: FXAAEffect;
  private readonly fxaaPass: EffectPass;
  private readonly bloomEffect: BloomEffect;
  private readonly bloomPass: EffectPass;

  private readonly gaussGrainEffect = GaussGrainEffect;
  private readonly gaussGrainPass: ShaderPass;




    this.renderer = new WebGLRenderer({
      powerPreference: "high-performance",
      antialias: false,
      stencil: false,
      depth: false,
    });









    this.fxaaEffect = new FXAAEffect();
    this.fxaaPass = new EffectPass(this.camera, this.fxaaEffect);
    this.bloomEffect = new BloomEffect();
    this.bloomPass = new EffectPass(this.camera, this.bloomEffect);
    this.gaussGrainPass = new ShaderPass(this.gaussGrainEffect, "tDiffuse");




    this.composer.addPass(this.gaussGrainPass);

    window.addEventListener("resize", () => {
      this.updateProjection();
    });
    this.updateProjection();


  private updateProjection(): void {
    this.width = window.innerWidth;
    this.height = innerHeight;


    if (this.fxaaPass) this.fxaaPass.setSize(this.width, this.height);




  public render(time: number): void {

    this.gaussGrainEffect.uniforms.resolution.value = this.resolution;
    this.gaussGrainEffect.uniforms.time.value = time;
    this.gaussGrainEffect.uniforms.alpha.value = 1.0;
    this.gaussGrainEffect.uniforms.amount.value = 0.035;
    this.bloomEffect.intensity = 1.0;


