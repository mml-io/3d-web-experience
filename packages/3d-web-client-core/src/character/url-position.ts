import { toArray } from "../helpers/math-helpers";
import { IEulXYZ } from "../math/EulXYZ";
import { Quat } from "../math/Quat";
import { IVect3, Vect3 } from "../math/Vect3";

const tempQuat = new Quat();

type PositionAndRotation = {
  position: IVect3;
  rotation: IEulXYZ;
};

export function encodeCharacterAndCamera(
  character: PositionAndRotation,
  camera: PositionAndRotation,
): string {
  return [
    ...toArray(character.position),
    ...toArray(tempQuat.setFromEulerXYZ(character.rotation)),
    ...toArray(camera.position),
    ...toArray(tempQuat.setFromEulerXYZ(camera.rotation)),
  ].join(",");
}

export function decodeCharacterAndCamera(hash: string): {
  character: { position: Vect3; quaternion: Quat };
  camera: { position: Vect3; quaternion: Quat };
} {
  const values = hash.split(",").map(Number);
  return {
    character: {
      position: new Vect3(values[0], values[1], values[2]),
      quaternion: new Quat(values[3], values[4], values[5], values[6]),
    },
    camera: {
      position: new Vect3(values[7], values[8], values[9]),
      quaternion: new Quat(values[10], values[11], values[12], values[13]),
    },
  };
}
