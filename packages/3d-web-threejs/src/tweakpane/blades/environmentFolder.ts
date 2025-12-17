import { BladeController, View } from "@tweakpane/core";
import { Scene } from "three";
import { BladeApi, ButtonApi, FolderApi, TpChangeEvent } from "tweakpane";

export type SunValues = {
  sunIntensity: number;
  sunPosition: {
    sunAzimuthalAngle: number;
    sunPolarAngle: number;
  };
  skyTurbidity: number;
  skyRayleigh: number;
  skyMieCoefficient: number;
  skyMieDirectionalG: number;
  sunColor: { r: number; g: number; b: number };
};

export type EnvValues = {
  skyboxAzimuthalAngle: number;
  skyboxPolarAngle: number;
  envMapIntensity: number;
  skyboxIntensity: number;
  skyboxBlurriness: number;
  ambientLight: {
    ambientLightIntensity: number;
    ambientLightColor: { r: number; g: number; b: number };
  };
  fog: {
    fogNear: number;
    fogFar: number;
    fogColor: { r: number; g: number; b: number };
  };
};

export function createDefaultSunValues(): SunValues {
  return {
    sunIntensity: 2.1,
    sunPosition: {
      sunAzimuthalAngle: 180,
      sunPolarAngle: -45,
    },
    skyTurbidity: 1.2,
    skyRayleigh: 0.7,
    skyMieCoefficient: 0.02,
    skyMieDirectionalG: 0.99,
    sunColor: { r: 1.0, g: 1.0, b: 1.0 },
  };
}

export function createDefaultEnvValues(): EnvValues {
  return {
    skyboxAzimuthalAngle: 0,
    skyboxPolarAngle: 0,
    envMapIntensity: 0.6,
    skyboxIntensity: 0.9,
    skyboxBlurriness: 0.0,
    ambientLight: {
      ambientLightIntensity: 0.17,
      ambientLightColor: { r: 1, g: 1, b: 1 },
    },
    fog: {
      fogNear: 30,
      fogFar: 210,
      fogColor: { r: 0.6, g: 0.6, b: 0.6 },
    },
  };
}

const sunOptions = {
  sunPosition: {
    sunAzimuthalAngle: { min: 0, max: 360, step: 1 },
    sunPolarAngle: { min: -95, max: 95, step: 1 },
  },
  sunIntensity: { min: 0, max: 10, step: 0.1 },
  skyTurbidity: { min: 1, max: 30, step: 0.1 },
  skyRayleigh: { min: 0, max: 4, step: 0.01 },
  skyMieCoefficient: { min: 0.001, max: 0.02, step: 0.001 },
  skyMieDirectionalG: { min: 0, max: 0.999, step: 0.001 },
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
    fogFar: { min: 0, max: 300, step: 1 },
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

  constructor(
    parentFolder: FolderApi,
    private sunValues: SunValues,
    private envValues: EnvValues,
    expand: boolean = false,
  ) {
    this.folder = parentFolder.addFolder({ title: "environment", expanded: expand });
    this.ambient = this.folder.addFolder({ title: "ambient", expanded: true });
    this.sun = this.folder.addFolder({ title: "sun", expanded: true });
    this.envMap = this.folder.addFolder({ title: "envMap", expanded: true });
    this.fog = this.folder.addFolder({ title: "fog", expanded: true });
    this.skybox = this.folder.addFolder({ title: "skybox", expanded: true });

    this.sun.addBinding(this.sunValues, "sunIntensity", sunOptions.sunIntensity);
    this.sun.addBinding(
      this.sunValues.sunPosition,
      "sunAzimuthalAngle",
      sunOptions.sunPosition.sunAzimuthalAngle,
    );
    this.sun.addBinding(
      this.sunValues.sunPosition,
      "sunPolarAngle",
      sunOptions.sunPosition.sunPolarAngle,
    );
    this.sun.addBinding(this.sunValues, "skyTurbidity", sunOptions.skyTurbidity);
    this.sun.addBinding(this.sunValues, "skyRayleigh", sunOptions.skyRayleigh);
    this.sun.addBinding(this.sunValues, "skyMieCoefficient", sunOptions.skyMieCoefficient);
    this.sun.addBinding(this.sunValues, "skyMieDirectionalG", sunOptions.skyMieDirectionalG);
    this.sun.addBinding(this.sunValues, "sunColor", {
      color: { type: "float" },
    });

    this.hdrButton = this.skybox.addButton({ title: "Set HDRI" });
    this.skybox.addBinding(this.envValues, "skyboxIntensity", envOptions.skyboxIntensity);
    this.skybox.addBinding(this.envValues, "skyboxBlurriness", envOptions.skyboxBlurriness);
    this.skybox.addBinding(this.envValues, "skyboxAzimuthalAngle", envOptions.skyboxAzimuthalAngle);
    this.skybox.addBinding(this.envValues, "skyboxPolarAngle", envOptions.skyboxPolarAngle);

    this.envMap.addBinding(this.envValues, "envMapIntensity", envOptions.skyboxIntensity);

    this.ambient.addBinding(
      this.envValues.ambientLight,
      "ambientLightIntensity",
      envOptions.ambientLight.ambientLightIntensity,
    );
    this.ambient.addBinding(this.envValues.ambientLight, "ambientLightColor", {
      color: { type: "float" },
    });

    this.fog.addBinding(this.envValues.fog, "fogNear", envOptions.fog.fogNear);
    this.fog.addBinding(this.envValues.fog, "fogFar", envOptions.fog.fogFar);
    this.fog.addBinding(this.envValues.fog, "fogColor", {
      color: { type: "float" },
    });
  }

  public setupChangeEvent(scene: Scene, onUpdate: () => void, setHDR: () => void): void {
    this.sun.on("change", () => {
      onUpdate();
    });

    this.hdrButton.on("click", () => {
      setHDR();
    });

    this.envMap.on("change", (e: TpChangeEvent<unknown, BladeApi<BladeController<View>>>) => {
      const target = (e.target as any).key;
      if (target === "envMapIntensity") {
        scene.environmentIntensity = e.value as number;
      }
    });

    this.skybox.on("change", (e: TpChangeEvent<unknown, BladeApi<BladeController<View>>>) => {
      const target = (e.target as any).key;
      if (!target) return;
      switch (target) {
        case "skyboxAzimuthalAngle":
        case "skyboxPolarAngle":
          onUpdate();
          break;
        case "skyboxIntensity":
          scene.backgroundIntensity = e.value as number;
          break;
        case "skyboxBlurriness":
          scene.backgroundBlurriness = e.value as number;
          break;
      }
    });

    this.ambient.on("change", () => {
      onUpdate();
    });

    this.fog.on("change", () => {
      onUpdate();
    });
  }
}
