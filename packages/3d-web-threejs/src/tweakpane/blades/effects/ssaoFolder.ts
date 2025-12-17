import { BindingApi, BladeApi, BladeController, TpChangeEvent, View } from "@tweakpane/core";
import { EffectComposer } from "postprocessing";
import { Color } from "three";
import { FolderApi } from "tweakpane";

export type N8SSAOValues = {
  enabled: boolean;
  halfRes: boolean;
  intensity: number;
  aoRadius: number;
  distanceFalloff: number;
  color: { r: number; g: number; b: number };
  aoSamples: number;
  denoiseSamples: number;
  denoiseRadius: number;
  viewMode: string;
};

export function createDefaultN8SSAOValues(): N8SSAOValues {
  return {
    enabled: true,
    halfRes: false,
    intensity: 0.7,
    aoRadius: 3.0,
    distanceFalloff: 3.0,
    color: { r: 0, g: 0, b: 0 },
    aoSamples: 8,
    denoiseSamples: 8,
    denoiseRadius: 12,
    viewMode: "Combined",
  };
}

export const n8ssaoOptions = {
  intensity: { min: 0.1, max: 5, step: 0.1 },
  radius: { min: 0.1, max: 6, step: 0.1 },
  distanceFalloff: { min: 1, max: 6, step: 0.1 },
  aoSamples: [2, 4, 8, 16, 32, 64],
  denoiseSamples: [2, 4, 8, 16, 32, 64],
  denoiseRadius: [3, 6, 12],
  viewMode: ["Combined", "AO", "No AO", "Split", "Split AO", "No AO"],
};

export class SSAOFolder {
  private folder: FolderApi;

  private aoSamples: BindingApi;
  private denoiseSamples: BindingApi;
  private denoiseRadius: BindingApi;
  private aoDisplay: BindingApi;

  private postProcessingSSAOIndex: number = 1;

  constructor(
    parentFolder: FolderApi,
    private n8ssaoValues: N8SSAOValues,
    expand: boolean = false,
  ) {
    this.folder = parentFolder.addFolder({ title: "ambientOcclusion", expanded: expand });
    {
      this.folder.addBinding({ enabled: this.n8ssaoValues.enabled }, "enabled");
      this.folder.addBinding({ halfRes: this.n8ssaoValues.halfRes }, "halfRes");
      this.folder.addBinding(this.n8ssaoValues, "intensity", n8ssaoOptions.intensity);
      this.folder.addBinding(this.n8ssaoValues, "aoRadius", n8ssaoOptions.radius);
      this.folder.addBinding(this.n8ssaoValues, "distanceFalloff", n8ssaoOptions.distanceFalloff);
      this.folder.addBinding(this.n8ssaoValues, "color", {
        color: { alpha: false, type: "float" },
      });

      this.aoSamples = this.folder.addBinding(this.n8ssaoValues, "aoSamples", {
        view: "radiogrid",
        groupName: "aoSamples",
        size: [3, 2],
        cells: (x: number, y: number) => ({
          title: `${n8ssaoOptions.aoSamples[y * 3 + x]}`,
          value: n8ssaoOptions.aoSamples[y * 3 + x],
        }),
        label: "aoSamples",
      });

      this.denoiseSamples = this.folder.addBinding(this.n8ssaoValues, "denoiseSamples", {
        view: "radiogrid",
        groupName: "denoiseSamples",
        size: [3, 2],
        cells: (x: number, y: number) => ({
          title: `${n8ssaoOptions.denoiseSamples[y * 3 + x]}`,
          value: n8ssaoOptions.denoiseSamples[y * 3 + x],
        }),
        label: "denoiseSamples",
      });

      this.denoiseRadius = this.folder.addBinding(this.n8ssaoValues, "denoiseRadius", {
        view: "radiogrid",
        groupName: "denoiseRadius",
        size: [3, 1],
        cells: (x: number, y: number) => ({
          title: `${n8ssaoOptions.denoiseRadius[y * 3 + x]}`,
          value: n8ssaoOptions.denoiseRadius[y * 3 + x],
        }),
        label: "denoiseRadius",
      });

      this.aoDisplay = this.folder.addBinding(this.n8ssaoValues, "viewMode", {
        view: "radiogrid",
        groupName: "viewMode",
        size: [3, 2],
        cells: (x: number, y: number) => ({
          title: `${n8ssaoOptions.viewMode[y * 3 + x]}`,
          value: `${n8ssaoOptions.viewMode[y * 3 + x]}`,
        }),
        label: "viewMode",
      });
    }

    this.folder.addBlade({ view: "separator" });
  }

  public setupChangeEvent(composer: EffectComposer | any, n8aopass: any): void {
    this.folder.on("change", (e: TpChangeEvent<unknown, BladeApi<BladeController<View>>>) => {
      const target = (e.target as any).key;
      if (!target) return;
      switch (target) {
        case "enabled":
          if (e.value === true) {
            composer.addPass(n8aopass, this.postProcessingSSAOIndex + 2);
            composer.passes[this.postProcessingSSAOIndex + 2].setSize(
              window.innerWidth,
              window.innerHeight,
            );
          } else {
            composer.removePass(n8aopass);
          }
          n8aopass.enabled = e.value;
          break;
        case "halfRes":
          n8aopass.configuration.halfRes = e.value;
          break;
        case "aoRadius":
          n8aopass.configuration.aoRadius = e.value;
          break;
        case "distanceFalloff":
          n8aopass.configuration.distanceFalloff = e.value;
          break;
        case "intensity":
          n8aopass.configuration.intensity = e.value;
          break;
        case "color":
          const value = (e as any).value;
          n8aopass.configuration.color = new Color().setRGB(value.r, value.g, value.b);
          break;
        default:
          break;
      }
    });

    this.aoSamples.on("change", (e: any) => {
      n8aopass.configuration.aoSamples = e.value;
    });

    this.denoiseSamples.on("change", (e: any) => {
      n8aopass.configuration.denoiseSamples = e.value;
    });

    this.denoiseRadius.on("change", (e: any) => {
      n8aopass.configuration.denoiseRadius = e.value;
    });

    this.aoDisplay.on("change", (e: any) => {
      n8aopass.setDisplayMode(e.value);
    });
  }
}
