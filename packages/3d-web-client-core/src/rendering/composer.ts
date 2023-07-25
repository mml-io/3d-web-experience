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
} from "postprocessing";
import {
  Color,
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
import { Pane, TpChangeEvent } from "tweakpane";

import { TimeManager } from "../time/TimeManager";

import {
  ssaoMaterialParams,
  statsData,
  composerOptions as opts,
  composerValues as vals,
  rendererBlades,
  setShadowMapType,
  setToneMappingType,
} from "./composerSettings";
import { GaussGrainEffect } from "./post-effects/gauss-grain";
import { setTweakpaneActive } from "./tweakPaneActivity";

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

  private readonly normalPass: NormalPass;
  private readonly normalTextureEffect: TextureEffect;
  private readonly ssaoEffect: SSAOEffect;
  private readonly ssaoPass: EffectPass;

  private readonly gaussGrainEffect = GaussGrainEffect;
  private readonly gaussGrainPass: ShaderPass;

  private gui: Pane = new Pane();
  private guiVisible: boolean = false;
  private stats = this.gui.addFolder({ title: "stats", expanded: true });
  private renderOptions = this.gui.addFolder({ title: "renderOptions", expanded: false });
  private ssao = this.gui.addFolder({ title: "ambientOcclusion", expanded: false });
  private post = this.gui.addFolder({ title: "post", expanded: false });
  private export = this.gui.addFolder({ title: "import/export", expanded: false });

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
    this.renderer.toneMappingExposure = 0.7;

    document.body.appendChild(this.renderer.domElement);

    this.composer = new EffectComposer(this.renderer);
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
    this.gaussGrainPass = new ShaderPass(this.gaussGrainEffect, "tDiffuse");

    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.normalPass);
    this.composer.addPass(this.ssaoPass);
    this.composer.addPass(this.fxaaPass);
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(this.gaussGrainPass);

    window.addEventListener("resize", () => this.updateProjection());
    window.addEventListener("keydown", this.processKey.bind(this));
    this.setupGUIListeners.bind(this)();

    this.updateProjection();
    this.setupTweakPane();
  }

  private setupGUIListeners(): void {
    const gui = this.gui as any;
    const paneElement: HTMLElement = gui.containerElem_;
    paneElement.style.display = this.guiVisible ? "unset" : "none";
    this.gui.element.addEventListener("mousedown", () => setTweakpaneActive(true));
    this.gui.element.addEventListener("mouseup", () => setTweakpaneActive(false));
    this.gui.element.addEventListener("mouseleave", () => setTweakpaneActive(false));
  }

  private setupTweakPane(): void {
    this.stats.addMonitor(statsData, "triangles");
    this.stats.addMonitor(statsData, "geometries");
    this.stats.addMonitor(statsData, "textures");
    this.stats.addMonitor(statsData, "shaders");
    this.stats.addMonitor(statsData, "postPasses");
    this.stats.addMonitor(statsData, "drawCalls");
    this.stats.addMonitor(statsData, "FPS");

    this.renderOptions.addInput(vals.renderer, "shadowMap", opts.renderer.shadowMap);
    this.renderOptions.addMonitor(rendererBlades, "shadowMapType");

    this.renderOptions.addInput(vals.renderer, "toneMapping", opts.renderer.toneMapping);
    this.renderOptions.addMonitor(rendererBlades, "toneMappingType");

    this.renderOptions.addInput(vals.renderer, "exposure", opts.renderer.exposure);
    this.renderOptions.addInput(vals.renderer, "bgIntensity", opts.renderer.bgIntensity);
    this.renderOptions.addInput(vals.renderer, "bgBlurriness", opts.renderer.bgBlurriness);
    this.renderOptions.on("change", (e: TpChangeEvent<any>) => {
      const target = e.target as any;
      switch (target.label) {
        case "shadowMap":
          this.renderer.shadowMap.type = e.value;
          setShadowMapType(e.value);
          break;
        case "toneMapping":
          this.renderer.toneMapping = e.value;
          setToneMappingType(e.value);
          break;
        case "exposure":
          this.renderer.toneMappingExposure = e.value;
          break;
        case "bgIntensity":
          this.scene.backgroundIntensity = e.value;
          break;
        case "bgBlurriness":
          this.scene.backgroundBlurriness = e.value;
          break;
        default:
          break;
      }
    });

    this.ssao.addInput({ showEffectOnly: false }, "showEffectOnly");
    this.ssao.addInput(vals.ssao, "samples", opts.ssao.samples);
    this.ssao.addInput(vals.ssao, "rings", opts.ssao.rings);
    this.ssao.addInput(vals.ssao, "luminanceInfluence", opts.ssao.luminanceInfluence);
    this.ssao.addInput(vals.ssao, "radius", opts.ssao.radius);
    this.ssao.addInput(vals.ssao, "intensity", opts.ssao.intensity);
    this.ssao.addInput(vals.ssao, "bias", opts.ssao.bias);
    this.ssao.addInput(vals.ssao, "fade", opts.ssao.fade);
    this.ssao.addInput(vals.ssao, "resolutionScale", opts.ssao.resolutionScale);
    this.ssao.addInput(vals.ssao, "worldDistanceThreshold", opts.ssao.worldDistanceThreshold);
    this.ssao.addInput(vals.ssao, "worldDistanceFalloff", opts.ssao.worldDistanceFalloff);
    this.ssao.addInput(vals.ssao, "worldProximityThreshold", opts.ssao.worldProximityThreshold);
    this.ssao.addInput(vals.ssao, "worldProximityFalloff", opts.ssao.worldProximityFalloff);
    this.ssao.addInput(vals.ssao, "color");
    this.ssao.on("change", (e: TpChangeEvent<any>) => {
      if (!e.presetKey) {
        return;
      }
      const preset = e.presetKey;
      if (preset === "showEffectOnly") {
        this.ssaoEffect.blendMode.blendFunction =
          e.value === true ? BlendFunction.NORMAL : BlendFunction.MULTIPLY;
        return;
      }
      if (preset === "resolutionScale") {
        this.ssaoEffect.resolution.scale = e.value;
        return;
      }
      if (ssaoMaterialParams.includes(e.presetKey!)) {
        (this.ssaoEffect.ssaoMaterial as any)[preset] = e.value;
        return;
      }
      if (e.presetKey === "color") {
        this.ssaoEffect.color = new Color().setRGB(
          e.value.r / 255,
          e.value.g / 255,
          e.value.b / 255,
        );
        return;
      }
      (this.ssaoEffect as any)[preset] = e.value;
    });

    this.post.addInput(vals, "bloom", opts.bloom.amount);
    this.post.addInput(vals, "grain", opts.grain.amount);

    this.post.on("change", (e: TpChangeEvent<any>) => {
      const target = e.presetKey;
      console.log(target);
      switch (target) {
        case "bloom":
          this.bloomEffect.intensity = e.value;
          break;
        case "grain":
          this.gaussGrainEffect.uniforms.amount.value = e.value;
          break;
        default:
          break;
      }
    });

    const button = this.export.addButton({ title: "export" });
    button.on("click", () => {
      console.log(this.gui.exportPreset());
    });
  }

  private toggleGUI(): void {
    const gui = this.gui as any;
    const paneElement: HTMLElement = gui.containerElem_;
    paneElement.style.display = this.guiVisible ? "none" : "unset";
    this.guiVisible = !this.guiVisible;
  }

  private processKey(e: KeyboardEvent): void {
    if (e.key === "p") this.toggleGUI();
  }

  private updateProjection(): void {
    this.width = window.innerWidth;
    this.height = innerHeight;
    this.resolution = new Vector2(this.width, this.height);
    if (this.composer) this.composer.setSize(this.width, this.height);
    if (this.fxaaPass) this.fxaaPass.setSize(this.width, this.height);
    if (this.renderPass) this.renderPass.setSize(this.width, this.height);
    if (this.bloomPass) this.bloomPass.setSize(this.width, this.height);
    if (this.ssaoPass) this.ssaoPass.setSize(this.width, this.height);
    if (this.normalPass) this.normalPass.setSize(this.width, this.height);
    this.renderer.setSize(this.width, this.height);
  }

  private updateStats(timeManager: TimeManager): void {
    const { geometries, textures } = this.renderer.info.memory;
    const { triangles, calls } = this.renderer.info.render;
    statsData.triangles = triangles.toString();
    statsData.geometries = geometries.toString();
    statsData.textures = textures.toString();
    statsData.shaders = this.renderer.info.programs!.length.toString();
    statsData.postPasses = this.composer.passes.length.toString();
    statsData.drawCalls = calls.toString();
    statsData.FPS = Math.round(timeManager.averageFPS).toString();
  }

  public render(timeManager: TimeManager): void {
    this.renderer.info.reset();
    this.normalPass.texture.needsUpdate = true;
    this.gaussGrainEffect.uniforms.resolution.value = this.resolution;
    this.gaussGrainEffect.uniforms.time.value = timeManager.time;
    this.gaussGrainEffect.uniforms.alpha.value = 1.0;
    this.composer.render();
    this.updateStats(timeManager);
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
          this.scene.backgroundIntensity = 0.5;
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
