import { BlendFunction, ToneMappingMode } from "postprocessing";
import { Color } from "three";

export const composerValues = {
  renderer: {
    shadowMap: 2,
    toneMapping: 5,
    exposure: 0.95,
    bgIntensity: 0.5,
    bgBlurriness: 0.0,
  },
  ssao: {
    blendFunction: BlendFunction.MULTIPLY,
    distanceScaling: true,
    depthAwareUpsampling: true,
    samples: 17,
    rings: 7,
    luminanceInfluence: 0.7,
    radius: 0.03,
    intensity: 2.1,
    bias: 0.05,
    fade: 0.03,
    resolutionScale: 0.5,
    color: new Color(0x000000),
    worldDistanceThreshold: 30,
    worldDistanceFalloff: 7,
    worldProximityThreshold: 0.5,
    worldProximityFalloff: 0.3,
  },
  toneMapping: {
    mode: 2 as ToneMappingMode,
    resolution: 512,
    whitePoint: 32.0,
    middleGrey: 21.0,
    minLuminance: 0.01,
    averageLuminance: 0.01,
    adaptationRate: 2.0,
  },
  brightness: 0.0,
  contrast: 0.0,
  hue: 0.0,
  saturation: -0.05,
  grain: 0.05,
  bloom: 0.5,
};

export const composerOptions = {
  renderer: {
    shadowMap: { min: 0, max: 2, step: 1 },
    toneMapping: { min: 0, max: 5, step: 1 },
    exposure: { min: 0, max: 1, step: 0.01 },
    bgIntensity: { min: 0, max: 1, step: 0.01 },
    bgBlurriness: { min: 0, max: 0.1, step: 0.001 },
  },
  ssao: {
    samples: { min: 1, max: 50, step: 1 },
    rings: { min: 1, max: 50, step: 1 },
    luminanceInfluence: { min: 0, max: 1, step: 0.01 },
    radius: { min: 0, max: 0.1, step: 0.001 },
    intensity: { min: 0, max: 5, step: 0.1 },
    bias: { min: 0, max: 0.1, step: 0.001 },
    fade: { min: 0, max: 0.1, step: 0.001 },
    resolutionScale: { min: 0.25, max: 2, step: 0.25 },
    worldDistanceThreshold: { min: 0, max: 200, step: 1 },
    worldDistanceFalloff: { min: 0, max: 200, step: 1 },
    worldProximityThreshold: { min: 0, max: 2, step: 0.01 },
    worldProximityFalloff: { min: 0, max: 2, step: 0.01 },
  },
  toneMapping: {
    mode: { min: 0, max: 4, step: 1 },
    resolution: { min: 64, max: 512, step: 64 },
    whitePoint: { min: 0, max: 32, step: 0.01 },
    middleGrey: { min: 0, max: 32, step: 0.01 },
    minLuminance: { min: 0, max: 32, step: 0.001 },
    averageLuminance: { min: 0.001, max: 0.2, step: 0.001 },
    adaptationRate: { min: 0.1, max: 2.0, step: 0.1 },
  },
  brightness: {
    amount: { min: -1.0, max: 1.0, step: 0.01 },
  },
  contrast: {
    amount: { min: -1.0, max: 1.0, step: 0.01 },
  },
  hue: {
    amount: { min: 0.0, max: Math.PI * 2.0, step: 0.001 },
  },
  saturation: {
    amount: { min: -1.0, max: 1.0, step: 0.01 },
  },
  grain: {
    amount: { min: 0, max: 0.2, step: 0.002 },
  },
  bloom: {
    amount: { min: 0, max: 4, step: 0.1 },
  },
};

export const shadowMapTypes: Record<number, string> = {
  0: "BasicShadowMap",
  1: "PCFShadowMap",
  2: "PCFSoftShadowMap",
};

export const rendererToneMappingTypes: Record<number, string> = {
  0: "NoToneMapping",
  1: "LinearToneMapping",
  2: "ReinhardToneMapping",
  3: "CineonToneMapping",
  4: "ACESFilmicToneMapping",
  5: "CustomToneMapping",
};

export const customToneMappingTypes: Record<number, string> = {
  0: "REINHARD",
  1: "REINHARD2",
  2: "REINHARD2_ADAPTIVE",
  3: "OPTIMIZED_CINEON",
  4: "ACES_FILMIC",
};

export const rendererBlades = {
  shadowMapType: shadowMapTypes[composerValues.renderer.shadowMap],
  toneMappingType: rendererToneMappingTypes[composerValues.renderer.toneMapping],
};

export const setShadowMapType = (value: number): void => {
  rendererBlades.shadowMapType = shadowMapTypes[value];
};

export const setToneMappingType = (value: number): void => {
  rendererBlades.toneMappingType = rendererToneMappingTypes[value];
};

export const customToneMappingBlade = {
  customToneMappingType: customToneMappingTypes[composerValues.toneMapping.mode],
};

export const setCustomToneMappingType = (value: number): void => {
  customToneMappingBlade.customToneMappingType = customToneMappingTypes[value];
};

export const ssaoMaterialParams = [
  "fade",
  "bias",
  "minRadiusScale",
  "worldDistanceThreshold",
  "worldDistanceFalloff",
  "worldProximityThreshold",
  "worldProximityFalloff",
];

export const statsData = {
  triangles: "0",
  geometries: "0",
  textures: "0",
  shaders: "0",
  postPasses: "0",
  drawCalls: "0",
  rawDeltaTime: "0",
  deltaTime: "0",
  FPS: "0",
};
