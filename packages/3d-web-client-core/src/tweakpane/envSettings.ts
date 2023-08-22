export const envValues = {
  ambientLight: {
    ambientLightIntensity: 0.0,
    ambientLightColor: { r: 1, g: 1, b: 1 },
  },
  fog: {
    fogNear: 30,
    fogFar: 210,
    fogColor: { r: 0.42, g: 0.48, b: 0.59 },
  },
};

export const envOptions = {
  ambientLight: {
    ambientLightIntensity: { min: 0, max: 1, step: 0.01 },
  },
  fog: {
    fogNear: { min: 0, max: 80, step: 1 },
    fogFar: { min: 81, max: 300, step: 1 },
  },
};
