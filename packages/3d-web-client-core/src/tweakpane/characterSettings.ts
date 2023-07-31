export const characterValues = {
  material: {
    transmission: 1,
    metalness: 0.8,
    roughness: 0.12,
    ior: 1.5,
    thickness: 0.1,
    specularColor: { r: 1.0, g: 1.0, b: 1.0 },
    specularIntensity: 0.1,
    emissive: { r: 1.0, g: 1.0, b: 1.0 },
    emissiveIntensity: 0.1,
    envMapIntensity: 1.0,
    sheenColor: { r: 1.0, g: 1.0, b: 1.0 },
    sheen: 0.5,
    clearcoat: 0.0,
    clearcoatRoughness: 0.0,
  },
};

export const characterOptions = {
  material: {
    transmission: { min: 0.01, max: 3, step: 0.01 },
    metalness: { min: 0, max: 1, step: 0.01 },
    roughness: { min: 0, max: 1, step: 0.01 },
    ior: { min: 0, max: 5, step: 0.01 },
    thickness: { min: 0, max: 1, step: 0.01 },
    specularIntensity: { min: 0, max: 1, step: 0.01 },
    emissiveIntensity: { min: 0, max: 1, step: 0.01 },
    envMapIntensity: { min: 0, max: 1, step: 0.01 },
    sheen: { min: 0, max: 1, step: 0.01 },
    clearcoat: { min: 0, max: 1, step: 0.01 },
    clearcoatRoughness: { min: 0, max: 1, step: 0.01 },
  },
};
