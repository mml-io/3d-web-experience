import { BladeController, View } from "@tweakpane/core";
import { BladeApi, FolderApi, TpChangeEvent } from "tweakpane";

import { BrightnessContrastSaturation } from "../../../post-effects/bright-contrast-sat";

export type BCSValues = {
  brightness: number;
  contrast: number;
  saturation: number;
};

export function createDefaultBCSValues(): BCSValues {
  return {
    brightness: 0.06,
    contrast: 1.2,
    saturation: 1,
  };
}

const bcsOptions = {
  brightness: {
    amount: { min: -1.0, max: 1.0, step: 0.01 },
  },
  contrast: {
    amount: { min: 0.0, max: 2.0, step: 0.01 },
  },
  saturation: {
    amount: { min: 0.0, max: 2.0, step: 0.01 },
  },
};

export class BrightnessContrastSaturationFolder {
  private folder: FolderApi;
  constructor(
    parentFolder: FolderApi,
    private bcsValues: BCSValues,
    expand: boolean = false,
  ) {
    this.folder = parentFolder.addFolder({
      title: "brightness / contrast / sat",
      expanded: expand,
    });
    this.folder.addBinding(this.bcsValues, "brightness", bcsOptions.brightness.amount);
    this.folder.addBinding(this.bcsValues, "contrast", bcsOptions.contrast.amount);
    this.folder.addBinding(this.bcsValues, "saturation", bcsOptions.saturation.amount);
  }

  public setupChangeEvent(
    brightnessContrastSaturation: typeof BrightnessContrastSaturation | any,
  ): void {
    this.folder.on("change", (e: TpChangeEvent<unknown, BladeApi<BladeController<View>>>) => {
      const target = (e.target as any).key;
      if (!target) return;
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
      }
    });
  }
}
