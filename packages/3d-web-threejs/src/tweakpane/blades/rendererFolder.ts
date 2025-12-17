import { BladeController, View } from "@tweakpane/core";
import { EffectPass } from "postprocessing";
import { NoToneMapping, ShadowMapType, ToneMapping, WebGLRenderer } from "three";
import { BladeApi, FolderApi, TpChangeEvent } from "tweakpane";

export type RendererValues = {
  shadowMap: number;
  toneMapping: number;
  exposure: number;
};

export function createDefaultRendererValues(): RendererValues {
  return {
    shadowMap: 2,
    toneMapping: 4,
    exposure: 0.75,
  };
}

const rendererOptions = {
  shadowMap: { min: 0, max: 2, step: 1 },
  toneMapping: { min: 0, max: 5, step: 1 },
  exposure: { min: 0, max: 3, step: 0.01 },
};

const shadowMapTypes: Record<number, string> = {
  0: "BasicShadowMap",
  1: "PCFShadowMap",
  2: "PCFSoftShadowMap",
};

const toneMappingTypes: Record<number, string> = {
  0: "NoToneMapping",
  1: "LinearToneMapping",
  2: "ReinhardToneMapping",
  3: "CineonToneMapping",
  4: "ACESFilmicToneMapping",
  5: "CustomToneMapping",
};

export class RendererFolder {
  private folder: FolderApi;
  private monitoredValues: {
    shadowMapType: string;
    toneMappingType: string;
  };

  constructor(
    parentFolder: FolderApi,
    private rendererValues: RendererValues,
    expand: boolean = false,
  ) {
    this.folder = parentFolder.addFolder({
      title: "rendererOptions",
      expanded: expand,
    });

    this.monitoredValues = {
      shadowMapType: shadowMapTypes[this.rendererValues.shadowMap],
      toneMappingType: toneMappingTypes[this.rendererValues.toneMapping],
    };

    this.folder.addBinding(this.rendererValues, "shadowMap", rendererOptions.shadowMap);
    this.folder.addBinding(this.monitoredValues, "shadowMapType", { readonly: true });
    this.folder.addBinding(this.rendererValues, "toneMapping", rendererOptions.toneMapping);
    this.folder.addBinding(this.monitoredValues, "toneMappingType", { readonly: true });
    this.folder.addBinding(this.rendererValues, "exposure", rendererOptions.exposure);
  }

  public setupChangeEvent(
    renderer: WebGLRenderer,
    toneMappingFolder: FolderApi,
    toneMappingPass: EffectPass | any,
  ): void {
    this.folder.on("change", (e: TpChangeEvent<unknown, BladeApi<BladeController<View>>>) => {
      const target = (e.target as any).key;
      if (!target) return;
      switch (target) {
        case "shadowMap": {
          const value = e.value as ShadowMapType;
          renderer.shadowMap.type = value;
          this.monitoredValues.shadowMapType = shadowMapTypes[value];
          break;
        }
        case "toneMapping":
          const value = e.value as ToneMapping;
          toneMappingFolder.hidden = e.value !== 5;
          toneMappingPass.enabled = e.value === 5 ? true : false;
          renderer.toneMapping = e.value === 5 ? NoToneMapping : (e.value as ToneMapping);
          this.monitoredValues.toneMappingType = toneMappingTypes[e.value as number];
          this.rendererValues.toneMapping = value;
          break;
        case "exposure":
          renderer.toneMappingExposure = e.value as number;
          break;
        default:
          break;
      }
    });
  }
}
