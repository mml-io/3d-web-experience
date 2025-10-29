import { EulXYZ } from "../math/EulXYZ";
import { Vect3 } from "../math/Vect3";

import { CharacterManager, SpawnConfigurationState } from "./CharacterManager";
import { decodeCharacterAndCamera } from "./url-position";

function randomWithVariance(value: number, variance: number): number {
  const min = value - variance;
  const max = value + variance;
  return Math.random() * (max - min) + min;
}

export function getSpawnData(
  config: SpawnConfigurationState,
  useLocationHash = false,
): {
  spawnPosition: Vect3;
  spawnRotation: EulXYZ;
  cameraPosition: Vect3;
} {
  const spawnPosition = new Vect3();
  spawnPosition.set(
    randomWithVariance(config.spawnPosition.x, config.spawnPositionVariance.x),
    randomWithVariance(config.spawnPosition.y, config.spawnPositionVariance.y),
    randomWithVariance(config.spawnPosition!.z, config.spawnPositionVariance.z),
  );
  const spawnRotation = new EulXYZ(0, -config.spawnYRotation! * (Math.PI / 180), 0);

  let cameraPosition: Vect3 | null = null;
  const offset = new Vect3(0, 0, 3.3);
  offset.applyEulerXYZ(new EulXYZ(0, spawnRotation.y, 0));
  cameraPosition = spawnPosition.clone().sub(offset).add(CharacterManager.headTargetOffset);

  if (useLocationHash && window.location.hash && window.location.hash.length > 1) {
    const urlParams = decodeCharacterAndCamera(window.location.hash.substring(1));
    spawnPosition.copy(urlParams.character.position);
    spawnRotation.setFromQuaternion(urlParams.character.quaternion);
    cameraPosition = new Vect3().copy(urlParams.camera.position);
  }

  return {
    spawnPosition,
    spawnRotation,
    cameraPosition,
  };
}
