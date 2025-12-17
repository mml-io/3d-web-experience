import { PositionAndRotation } from "@mml-io/mml-web";

import { EulXYZ, IVect3, Matr4, Quat, Vect3 } from "../math";

const tempContainerMatrix = new Matr4();
const tempTargetMatrix = new Matr4();
const tempPositionVector = new Vect3();
const tempRotationEuler = new EulXYZ();
const tempRotationQuaternion = new Quat();
const tempScaleVector = new Vect3();

export function getRelativePositionAndRotationRelativeToObject(
  positionAndRotation: PositionAndRotation,
  matrix: Matr4,
  localScale: IVect3,
): PositionAndRotation {
  const { x, y, z } = positionAndRotation.position;
  const { x: rx, y: ry, z: rz } = positionAndRotation.rotation;

  tempContainerMatrix.copy(matrix).invert();

  tempPositionVector.set(x, y, z);
  tempRotationEuler.set(rx, ry, rz);
  tempRotationQuaternion.setFromEulerXYZ(tempRotationEuler);
  tempScaleVector.set(1, 1, 1);

  tempTargetMatrix.compose(tempPositionVector, tempRotationQuaternion, tempScaleVector);
  tempTargetMatrix.premultiply(tempContainerMatrix);
  tempTargetMatrix.decompose(tempPositionVector, tempRotationQuaternion, tempScaleVector);

  tempRotationEuler.setFromQuaternion(tempRotationQuaternion);

  tempPositionVector.multiply(localScale);

  return {
    position: {
      x: tempPositionVector.x,
      y: tempPositionVector.y,
      z: tempPositionVector.z,
    },
    rotation: {
      x: tempRotationEuler.x,
      y: tempRotationEuler.y,
      z: tempRotationEuler.z,
    },
  };
}
