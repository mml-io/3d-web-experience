export const sunValues = {
  sunPosition: {
    sunAzimuthalAngle: 39,
    sunPolarAngle: 50,
  },
  sunIntensity: 0.5,
  sunColor: { r: 1.0, g: 1.0, b: 1.0 },
};

export const sunOptions = {
  sunPosition: {
    sunAzimuthalAngle: { min: 0, max: 360, step: 1 },
    sunPolarAngle: { min: -90, max: 90, step: 1 },
  },
  sunIntensity: { min: 0, max: 1, step: 0.05 },
};
