import { BladeController, View } from "@tweakpane/core";
import { Scene } from "three";
import { BladeApi, ButtonApi, FolderApi, TpChangeEvent } from "tweakpane";

import { Sun } from "../../sun/Sun";

export const sunValues = {
  sunPosition: {
    sunAzimuthalAngle: 325,
    sunPolarAngle: -45,
  },
  sunIntensity: 5.5,
  sunColor: { r: 0.91, g: 0.82, b: 0.7 },
  shadowRadius: 2.1,
};

const sunOptions = {
  sunPosition: {
    sunAzimuthalAngle: { min: 0, max: 360, step: 1 },
    sunPolarAngle: { min: -90, max: 90, step: 1 },
  },
  sunIntensity: { min: 0, max: 20, step: 0.01 },
  shadowRadius: { min: 0, max: 5, step: 0.01 },
};

export const envValues = {
  skyboxAzimuthalAngle: 79,
  skyboxPolarAngle: 0,
  envMapIntensity: 0.17,
  skyboxIntensity: 0.8,
  skyboxBlurriness: 0.0,
  ambientLight: {
    ambientLightIntensity: 0.45,
    ambientLightColor: { r: 0.99, g: 0.82, b: 0.72 },
  },
  fog: {
    fogNear: 21,
    fogFar: 180,
    fogColor: { r: 0.06, g: 0.07, b: 0.09 },
  },
};

const envOptions = {
  skyboxAzimuthalAngle: { min: 0, max: 360, step: 1 },
  skyboxPolarAngle: { min: 0, max: 360, step: 1 },
  skyboxIntensity: { min: 0, max: 1.3, step: 0.01 },
  skyboxBlurriness: { min: 0, max: 0.1, step: 0.001 },
  ambientLight: {
    ambientLightIntensity: { min: 0, max: 1, step: 0.01 },
  },
  fog: {
    fogNear: { min: 0, max: 80, step: 1 },
    fogFar: { min: 81, max: 300, step: 1 },
  },
};

export class EnvironmentFolder {
  public folder: FolderApi;
  private sun: FolderApi;
  private envMap: FolderApi;
  private hdrButton: ButtonApi;
  private skybox: FolderApi;
  private ambient: FolderApi;
  private fog: FolderApi;

  constructor(parentFolder: FolderApi, expand: boolean = false) {
    this.folder = parentFolder.addFolder({ title: "environment", expanded: expand });
    this.sun = this.folder.addFolder({ title: "sun", expanded: true });
    this.envMap = this.folder.addFolder({ title: "envMap", expanded: true });
    this.fog = this.folder.addFolder({ title: "fog", expanded: true });
    this.skybox = this.folder.addFolder({ title: "skybox", expanded: true });
    this.ambient = this.folder.addFolder({ title: "ambient", expanded: true });

    this.sun.addBinding(
      sunValues.sunPosition,
      "sunAzimuthalAngle",
      sunOptions.sunPosition.sunAzimuthalAngle,
    );
    this.sun.addBinding(
      sunValues.sunPosition,
      "sunPolarAngle",
      sunOptions.sunPosition.sunPolarAngle,
    );
    this.sun.addBinding(sunValues, "sunIntensity", sunOptions.sunIntensity);
    this.sun.addBinding(sunValues, "sunColor", {
      color: { type: "float" },
    });
    this.sun.addBinding(sunValues, "shadowRadius", sunOptions.shadowRadius);

    this.hdrButton = this.skybox.addButton({ title: "Set HDRI" });
    this.skybox.addBinding(envValues, "skyboxIntensity", envOptions.skyboxIntensity);
    this.skybox.addBinding(envValues, "skyboxBlurriness", envOptions.skyboxBlurriness);
    this.skybox.addBinding(envValues, "skyboxAzimuthalAngle", envOptions.skyboxAzimuthalAngle);
    this.skybox.addBinding(envValues, "skyboxPolarAngle", envOptions.skyboxPolarAngle);

    this.envMap.addBinding(envValues, "envMapIntensity", envOptions.skyboxIntensity);

    this.ambient.addBinding(
      envValues.ambientLight,
      "ambientLightIntensity",
      envOptions.ambientLight.ambientLightIntensity,
    );
    this.ambient.addBinding(envValues.ambientLight, "ambientLightColor", {
      color: { type: "float" },
    });

    this.fog.addBinding(envValues.fog, "fogNear", envOptions.fog.fogNear);
    this.fog.addBinding(envValues.fog, "fogFar", envOptions.fog.fogFar);
    this.fog.addBinding(envValues.fog, "fogColor", {
      color: { type: "float" },
    });
  }

  public setupChangeEvent(
    scene: Scene,
    setHDR: () => void,
    setSkyboxAzimuthalAngle: (azimuthalAngle: number) => void,
    setSkyboxPolarAngle: (polarAngle: number) => void,
    setAmbientLight: () => void,
    setFog: () => void,
    sun: Sun | null,
  ): void {
    this.sun.on("change", (e: TpChangeEvent<unknown, BladeApi<BladeController<View>>>) => {
      const target = (e.target as any).key;
      if (!target) return;
      switch (target) {
        case "sunAzimuthalAngle": {
          const value = e.value as number;
          sun?.setAzimuthalAngle(value * (Math.PI / 180));
          break;
        }
        case "sunPolarAngle": {
          const value = e.value as number;
          sun?.setPolarAngle(value * (Math.PI / 180));
          break;
        }
        case "sunIntensity": {
          const value = e.value as number;
          sun?.setIntensity(value);
          break;
        }
        case "sunColor": {
          const value = e.value as { r: number; g: number; b: number };
          sunValues.sunColor = {
            r: value.r,
            g: value.g,
            b: value.b,
          };
          sun?.setColor();
          break;
        }
        case "shadowRadius": {
          const value = e.value as number;
          sun?.setShadowRadius(value);
        }
        default:
          break;
      }
    });

    this.hdrButton.on("click", () => {
      setHDR();
    });

    this.envMap.on("change", (e: TpChangeEvent<unknown, BladeApi<BladeController<View>>>) => {
      const target = (e.target as any).key;
      if (!target) return;
      switch (target) {
        case "envMapIntensity":
          scene.environmentIntensity = e.value as number;
          break;
      }
    });

    this.skybox.on("change", (e: TpChangeEvent<unknown, BladeApi<BladeController<View>>>) => {
      const target = (e.target as any).key;
      if (!target) return;
      switch (target) {
        case "skyboxAzimuthalAngle": {
          const value = e.value as number;
          setSkyboxAzimuthalAngle(value);
          break;
        }
        case "skyboxPolarAngle": {
          const value = e.value as number;
          envValues.skyboxPolarAngle = value;
          setSkyboxPolarAngle(value);
          break;
        }
        case "skyboxIntensity":
          scene.backgroundIntensity = e.value as number;
          break;
        case "skyboxBlurriness":
          scene.backgroundBlurriness = e.value as number;
          break;
      }
    });

    this.ambient.on("change", (e: TpChangeEvent<unknown, BladeApi<BladeController<View>>>) => {
      const target = (e.target as any).key;
      if (!target) return;
      switch (target) {
        case "ambientLightIntensity": {
          envValues.ambientLight.ambientLightIntensity = e.value as number;
          setAmbientLight();
          break;
        }
        case "ambientLightColor": {
          const value = e.value as { r: number; g: number; b: number };
          envValues.ambientLight.ambientLightColor = {
            r: value.r,
            g: value.g,
            b: value.b,
          };
          setAmbientLight();
          break;
        }
      }
    });

    this.fog.on("change", (e: TpChangeEvent<unknown, BladeApi<BladeController<View>>>) => {
      const target = (e.target as any).key;
      if (!target) return;
      switch (target) {
        case "fogNear": {
          envValues.fog.fogNear = e.value as number;
          setFog();
          break;
        }
        case "fogFar": {
          envValues.fog.fogFar = e.value as number;
          setFog();
          break;
        }
        case "fogColor": {
          const value = e.value as { r: number; g: number; b: number };
          envValues.fog.fogColor = {
            r: value.r,
            g: value.g,
            b: value.b,
          };
          setFog();
          break;
        }
      }
    });
  }
}
