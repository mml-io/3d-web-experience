import {
  BlendFunction,
  BloomEffect,
  EffectComposer,
  EffectPass,
  SSAOEffect,
  ToneMappingEffect,
} from "postprocessing";
import { Color, Scene, WebGLRenderer } from "three";
import { ButtonApi, FolderApi, Pane, TpChangeEvent } from "tweakpane";

import { GaussGrainEffect } from "../rendering/post-effects/gauss-grain";
import { Sun } from "../sun/Sun";
import { TimeManager } from "../time/TimeManager";

import { BrightnessContrastSaturation } from "./../rendering/post-effects/bright-contrast-sat";
import { characterOptions, characterValues } from "./characterSettings";
import {
  ssaoMaterialParams,
  statsData,
  composerOptions,
  composerValues,
  rendererBlades,
  setShadowMapType,
  setToneMappingType,
  customToneMappingBlade,
  setCustomToneMappingType,
} from "./composerSettings";
import { envOptions, envValues } from "./envSettings";
import { sunOptions, sunValues } from "./sunSettings";
import { setTweakpaneActive } from "./tweakPaneActivity";

export class TweakPane {
  private renderer: WebGLRenderer;
  private scene: Scene;
  private composer: EffectComposer;

  private gui: Pane = new Pane();

  private render: FolderApi;
  private stats: FolderApi;
  private renderOptions: FolderApi;
  private ssao: FolderApi;
  private toneMapping: FolderApi;
  private post: FolderApi;

  private export: FolderApi;

  private characterMaterial: FolderApi;

  private environment: FolderApi;

  private sun: FolderApi;
  private sunButton: ButtonApi;
  private ambient: FolderApi;

  private saveVisibilityInLocalStorage: boolean = true;
  public guiVisible: boolean = false;

  constructor(renderer: WebGLRenderer, scene: Scene, composer: EffectComposer) {
    if (this.saveVisibilityInLocalStorage) {
      const localStorageGuiVisible = localStorage.getItem("guiVisible");
      if (localStorageGuiVisible !== null) {
        if (localStorageGuiVisible === "true") {
          this.guiVisible = true;
        } else if (localStorageGuiVisible === "false") {
          this.guiVisible = false;
        }
      }
    }

    this.renderer = renderer;
    this.scene = scene;
    this.composer = composer;

    this.render = this.gui.addFolder({ title: "rendering", expanded: true });

    this.stats = this.render.addFolder({ title: "stats", expanded: true });
    this.renderOptions = this.render.addFolder({ title: "renderOptions", expanded: false });
    this.toneMapping = this.render.addFolder({ title: "customToneMapping", expanded: false });
    this.ssao = this.render.addFolder({ title: "ambientOcclusion", expanded: false });
    this.post = this.render.addFolder({ title: "post", expanded: false });

    this.toneMapping.hidden = composerValues.renderer.toneMapping === 5 ? false : true;

    // Character
    {
      this.characterMaterial = this.gui.addFolder({ title: "characterMaterial", expanded: false });
      this.characterMaterial.addInput(
        characterValues.material,
        "transmission",
        characterOptions.material.transmission,
      );
      this.characterMaterial.addInput(
        characterValues.material,
        "metalness",
        characterOptions.material.metalness,
      );
      this.characterMaterial.addInput(
        characterValues.material,
        "roughness",
        characterOptions.material.roughness,
      );
      this.characterMaterial.addInput(
        characterValues.material,
        "ior",
        characterOptions.material.ior,
      );
      this.characterMaterial.addInput(
        characterValues.material,
        "thickness",
        characterOptions.material.thickness,
      );
      this.characterMaterial.addInput(characterValues.material, "specularColor", {
        color: { type: "float" },
      });
      this.characterMaterial.addInput(
        characterValues.material,
        "specularIntensity",
        characterOptions.material.specularIntensity,
      );
      this.characterMaterial.addInput(characterValues.material, "emissive", {
        color: { type: "float" },
      });
      this.characterMaterial.addInput(
        characterValues.material,
        "emissiveIntensity",
        characterOptions.material.emissiveIntensity,
      );
      this.characterMaterial.addInput(
        characterValues.material,
        "envMapIntensity",
        characterOptions.material.envMapIntensity,
      );
      this.characterMaterial.addInput(characterValues.material, "sheenColor", {
        color: { type: "float" },
      });
      this.characterMaterial.addInput(
        characterValues.material,
        "sheen",
        characterOptions.material.sheen,
      );
      this.characterMaterial.addInput(
        characterValues.material,
        "clearcoat",
        characterOptions.material.clearcoat,
      );
      this.characterMaterial.addInput(
        characterValues.material,
        "clearcoatRoughness",
        characterOptions.material.clearcoatRoughness,
      );

      this.characterMaterial.on("change", (e: TpChangeEvent<any>) => {
        if (!e.presetKey) {
          return;
        }
        if (e.presetKey === "specularColor") {
          characterValues.material.specularColor = {
            r: e.value.r,
            g: e.value.g,
            b: e.value.b,
          };
          return;
        }
        if (e.presetKey === "emissive") {
          characterValues.material.emissive = {
            r: e.value.r,
            g: e.value.g,
            b: e.value.b,
          };
          return;
        }
        if (e.presetKey === "sheenColor") {
          characterValues.material.sheenColor = {
            r: e.value.r,
            g: e.value.g,
            b: e.value.b,
          };
          return;
        }
      });
    }

    this.environment = this.gui.addFolder({ title: "environment", expanded: false });
    this.sun = this.environment.addFolder({ title: "sun", expanded: true });
    this.ambient = this.environment.addFolder({ title: "ambient", expanded: true });

    this.export = this.gui.addFolder({ title: "import/export", expanded: false });

    window.addEventListener("keydown", this.processKey.bind(this));

    this.setupGUIListeners.bind(this)();
    this.setupRenderPane = this.setupRenderPane.bind(this);
  }

  private processKey(e: KeyboardEvent): void {
    if (e.key === "p") this.toggleGUI();
  }

  private setupGUIListeners(): void {
    const gui = this.gui as any;
    const paneElement: HTMLElement = gui.containerElem_;
    paneElement.style.display = this.guiVisible ? "unset" : "none";
    this.gui.element.addEventListener("mousedown", () => setTweakpaneActive(true));
    this.gui.element.addEventListener("mouseup", () => setTweakpaneActive(false));
    this.gui.element.addEventListener("mouseleave", () => setTweakpaneActive(false));
  }

  public setupRenderPane(
    ssaoEffect: SSAOEffect,
    toneMappingEffect: ToneMappingEffect,
    toneMappingPass: EffectPass,
    brightnessContrastSaturation: typeof BrightnessContrastSaturation,
    bloomEffect: BloomEffect,
    gaussGrainEffect: typeof GaussGrainEffect,
    hasLighting: boolean,
    sun: Sun | null,
    setHDR: () => void,
    setAmbientLight: () => void,
    setFog: () => void,
  ): void {
    // Stats
    {
      this.stats.addMonitor(statsData, "triangles");
      this.stats.addMonitor(statsData, "geometries");
      this.stats.addMonitor(statsData, "textures");
      this.stats.addMonitor(statsData, "shaders");
      this.stats.addMonitor(statsData, "postPasses");
      this.stats.addMonitor(statsData, "drawCalls");
      this.stats.addMonitor(statsData, "rawDeltaTime");
      this.stats.addMonitor(statsData, "deltaTime");
      this.stats.addMonitor(statsData, "FPS");
    }

    // RenderOptions
    {
      this.renderOptions.addInput(
        composerValues.renderer,
        "shadowMap",
        composerOptions.renderer.shadowMap,
      );
      this.renderOptions.addMonitor(rendererBlades, "shadowMapType");

      this.renderOptions.addInput(
        composerValues.renderer,
        "toneMapping",
        composerOptions.renderer.toneMapping,
      );

      this.renderOptions.addMonitor(rendererBlades, "toneMappingType");

      this.renderOptions.addInput(
        composerValues.renderer,
        "exposure",
        composerOptions.renderer.exposure,
      );

      this.renderOptions.addInput(
        composerValues.renderer,
        "bgIntensity",
        composerOptions.renderer.bgIntensity,
      );

      this.renderOptions.addInput(
        composerValues.renderer,
        "bgBlurriness",
        composerOptions.renderer.bgBlurriness,
      );

      this.renderOptions.on("change", (e: TpChangeEvent<any>) => {
        const target = e.target as any;
        switch (target.label) {
          case "shadowMap":
            this.renderer.shadowMap.type = e.value;
            setShadowMapType(e.value);
            break;
          case "toneMapping":
            this.renderer.toneMapping = e.value;
            this.toneMapping.hidden = e.value !== 5;
            toneMappingPass.enabled = e.value === 5 ? true : false;
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
    }

    // SSAO
    {
      this.ssao.addInput({ showEffectOnly: false }, "showEffectOnly");
      this.ssao.addInput(composerValues.ssao, "samples", composerOptions.ssao.samples);
      this.ssao.addInput(composerValues.ssao, "rings", composerOptions.ssao.rings);
      this.ssao.addInput(
        composerValues.ssao,
        "luminanceInfluence",
        composerOptions.ssao.luminanceInfluence,
      );
      this.ssao.addInput(composerValues.ssao, "radius", composerOptions.ssao.radius);
      this.ssao.addInput(composerValues.ssao, "intensity", composerOptions.ssao.intensity);
      this.ssao.addInput(composerValues.ssao, "bias", composerOptions.ssao.bias);
      this.ssao.addInput(composerValues.ssao, "fade", composerOptions.ssao.fade);
      this.ssao.addInput(
        composerValues.ssao,
        "resolutionScale",
        composerOptions.ssao.resolutionScale,
      );
      this.ssao.addInput(
        composerValues.ssao,
        "worldDistanceThreshold",
        composerOptions.ssao.worldDistanceThreshold,
      );
      this.ssao.addInput(
        composerValues.ssao,
        "worldDistanceFalloff",
        composerOptions.ssao.worldDistanceFalloff,
      );
      this.ssao.addInput(
        composerValues.ssao,
        "worldProximityThreshold",
        composerOptions.ssao.worldProximityThreshold,
      );
      this.ssao.addInput(
        composerValues.ssao,
        "worldProximityFalloff",
        composerOptions.ssao.worldProximityFalloff,
      );
      this.ssao.addInput(composerValues.ssao, "color", {
        color: { alpha: false, type: "float" },
      });
      this.ssao.on("change", (e: TpChangeEvent<any>) => {
        if (!e.presetKey) {
          return;
        }
        const preset = e.presetKey;
        if (preset === "showEffectOnly") {
          ssaoEffect.blendMode.blendFunction =
            e.value === true ? BlendFunction.NORMAL : BlendFunction.MULTIPLY;
          return;
        }
        if (preset === "resolutionScale") {
          ssaoEffect.resolution.scale = e.value;
          return;
        }
        if (ssaoMaterialParams.includes(e.presetKey!)) {
          (ssaoEffect.ssaoMaterial as any)[preset] = e.value;
          return;
        }
        if (e.presetKey === "color") {
          ssaoEffect.color = new Color().setRGB(e.value.r, e.value.g, e.value.b);
          return;
        }
        (ssaoEffect as any)[preset] = e.value;
      });
    }

    // ToneMapping
    {
      this.toneMapping.addInput(
        composerValues.toneMapping,
        "mode",
        composerOptions.toneMapping.mode,
      );
      this.toneMapping.addMonitor(customToneMappingBlade, "customToneMappingType");
      this.toneMapping.addInput(
        composerValues.toneMapping,
        "whitePoint",
        composerOptions.toneMapping.whitePoint,
      );
      this.toneMapping.addInput(
        composerValues.toneMapping,
        "middleGrey",
        composerOptions.toneMapping.middleGrey,
      );
      const minLuminance = this.toneMapping.addInput(
        composerValues.toneMapping,
        "minLuminance",
        composerOptions.toneMapping.minLuminance,
      );
      minLuminance.hidden = composerValues.toneMapping.mode === 2 ? true : false;
      const averageLuminance = this.toneMapping.addInput(
        composerValues.toneMapping,
        "averageLuminance",
        composerOptions.toneMapping.averageLuminance,
      );
      averageLuminance.hidden = composerValues.toneMapping.mode === 2 ? true : false;
      this.toneMapping.addInput(
        composerValues.toneMapping,
        "adaptationRate",
        composerOptions.toneMapping.adaptationRate,
      );
      this.toneMapping.on("change", (e: TpChangeEvent<any>) => {
        if (!e.presetKey) {
          return;
        }
        const preset = e.presetKey;
        if (preset === "mode") {
          minLuminance.hidden = composerValues.toneMapping.mode === 2 ? true : false;
          averageLuminance.hidden = composerValues.toneMapping.mode === 2 ? true : false;
          setCustomToneMappingType(e.value);
        }
        (toneMappingEffect as any)[preset] = e.value;
        return;
      });
    }

    // Post
    {
      this.post.addInput(composerValues, "brightness", composerOptions.brightness.amount);
      this.post.addInput(composerValues, "contrast", composerOptions.contrast.amount);
      this.post.addInput(composerValues, "saturation", composerOptions.saturation.amount);

      this.post.addInput(composerValues, "bloom", composerOptions.bloom.amount);
      this.post.addInput(composerValues, "grain", composerOptions.grain.amount);

      this.post.on("change", (e: TpChangeEvent<any>) => {
        const target = e.presetKey;
        switch (target) {
          case "brightness":
            brightnessContrastSaturation.uniforms.brightness.value = e.value;
            break;
          case "contrast":
            brightnessContrastSaturation.uniforms.contrast.value = e.value;
            break;
          case "saturation":
            brightnessContrastSaturation.uniforms.saturation.value = e.value;
            break;
          case "bloom":
            bloomEffect.intensity = e.value;
            break;
          case "grain":
            gaussGrainEffect.uniforms.amount.value = e.value;
            break;
          default:
            break;
        }
      });
    }

    // Environment
    {
      this.environment.hidden = hasLighting === false || sun === null;
      this.sun.addInput(
        sunValues.sunPosition,
        "sunAzimuthalAngle",
        sunOptions.sunPosition.sunAzimuthalAngle,
      );
      this.sun.addInput(
        sunValues.sunPosition,
        "sunPolarAngle",
        sunOptions.sunPosition.sunPolarAngle,
      );
      this.sun.addInput(sunValues, "sunIntensity", sunOptions.sunIntensity);
      this.sun.addInput(sunValues, "sunColor", {
        color: { type: "float" },
      });
      this.sunButton = this.sun.addButton({ title: "Set HDRI" });
      this.sunButton.on("click", () => {
        setHDR();
      });

      this.sun.on("change", (e: TpChangeEvent<any>) => {
        const target = e.presetKey;
        switch (target) {
          case "sunAzimuthalAngle":
            sun?.setAzimuthalAngle(e.value * (Math.PI / 180));
            break;
          case "sunPolarAngle":
            sun?.setPolarAngle(e.value * (Math.PI / 180));
            break;
          case "sunIntensity":
            sun?.setIntensity(e.value);
            break;
          case "sunColor":
            sunValues.sunColor = {
              r: e.value.r,
              g: e.value.g,
              b: e.value.b,
            };
            sun?.setColor();
            break;
          default:
            break;
        }
      });

      this.ambient.addInput(
        envValues.ambientLight,
        "ambientLightIntensity",
        envOptions.ambientLight.ambientLightIntensity,
      );
      this.ambient.addInput(envValues.ambientLight, "ambientLightColor", {
        color: { type: "float" },
      });
      this.ambient.addInput(envValues.fog, "fogNear", envOptions.fog.fogNear);
      this.ambient.addInput(envValues.fog, "fogFar", envOptions.fog.fogFar);
      this.ambient.addInput(envValues.fog, "fogColor", {
        color: { type: "float" },
      });

      this.ambient.on("change", (e: TpChangeEvent<any>) => {
        const target = e.presetKey;
        switch (target) {
          case "ambientLightIntensity":
            envValues.ambientLight.ambientLightIntensity = e.value;
            setAmbientLight();
            break;
          case "ambientLightColor":
            envValues.ambientLight.ambientLightColor = {
              r: e.value.r,
              g: e.value.g,
              b: e.value.b,
            };
            setAmbientLight();
            break;
          case "fogNear":
            envValues.fog.fogNear = e.value;
            setFog();
            break;
          case "fogFar":
            envValues.fog.fogFar = e.value;
            setFog();
            break;
          case "fogColor":
            envValues.fog.fogColor = {
              r: e.value.r,
              g: e.value.g,
              b: e.value.b,
            };
            setFog();
            break;
          default:
            break;
        }
      });
    }

    const exportButton = this.export.addButton({ title: "export" });
    exportButton.on("click", () => {
      this.downloadSettingsAsJSON(this.gui.exportPreset());
    });
    const importButton = this.export.addButton({ title: "import" });
    importButton.on("click", () => {
      this.importSettingsFromJSON((settings) => {
        this.gui.importPreset(settings);
      });
    });
  }

  private formatDateForFilename(): string {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0"); // Months are 0-11
    const day = String(date.getDate()).padStart(2, "0");
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    const seconds = String(date.getSeconds()).padStart(2, "0");
    return `${year}-${month}-${day} ${hours}-${minutes}-${seconds}`;
  }

  private downloadSettingsAsJSON(settings: any) {
    const jsonString = JSON.stringify(settings, null, 2);
    const blob = new Blob([jsonString], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.download = `settings ${this.formatDateForFilename()}.json`;
    a.href = url;
    a.click();
    URL.revokeObjectURL(url);
  }

  private importSettingsFromJSON(callback: (settings: any) => void) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.addEventListener("change", (event) => {
      const file = (event.target as HTMLInputElement).files?.[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (loadEvent) => {
          try {
            const settings = JSON.parse(loadEvent.target?.result as string);
            callback(settings);
          } catch (err) {
            console.error("Error parsing JSON:", err);
          }
        };
        reader.readAsText(file);
      }
    });
    input.click();
  }

  public updateStats(timeManager: TimeManager): void {
    const { geometries, textures } = this.renderer.info.memory;
    const { triangles, calls } = this.renderer.info.render;
    statsData.triangles = triangles.toString();
    statsData.geometries = geometries.toString();
    statsData.textures = textures.toString();
    statsData.shaders = this.renderer.info.programs!.length.toString();
    statsData.postPasses = this.composer.passes.length.toString();
    statsData.drawCalls = calls.toString();
    statsData.rawDeltaTime = (Math.round(timeManager.rawDeltaTime * 100000) / 100000).toString();
    statsData.deltaTime = (Math.round(timeManager.deltaTime * 100000) / 100000).toString();
    statsData.FPS = timeManager.fps.toString();
  }

  private toggleGUI(): void {
    const gui = this.gui as any;
    const paneElement: HTMLElement = gui.containerElem_;
    paneElement.style.display = this.guiVisible ? "none" : "unset";
    this.guiVisible = !this.guiVisible;
    if (this.saveVisibilityInLocalStorage) {
      localStorage.setItem("guiVisible", this.guiVisible === true ? "true" : "false");
    }
  }
}
