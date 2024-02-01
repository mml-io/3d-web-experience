import {
  ModelLoader,
  type MMLCharacterDescription,
  type MMLCharacterDescriptionPart,
} from "@mml-io/3d-web-avatar";
import { Bone, Euler, Object3D, Vector3, MathUtils } from "three";

export class CharacterSockets {
  private modelLoader: ModelLoader = new ModelLoader();
  private attachments: Map<string, Object3D> = new Map();
  private availableBones: Map<string, Bone> = new Map();

  constructor(
    private mesh: Object3D,
    private characterDescription: Partial<MMLCharacterDescription> | null,
  ) {
    this.mesh.traverse((child) => {
      const asBone = child as Bone;
      if (asBone.isBone) {
        this.availableBones.set(child.name, asBone);
      }
    });

    if (this.characterDescription?.parts) {
      this.setAttachments(this.characterDescription.parts);
    }
  }

  private async setAttachments(parts: MMLCharacterDescriptionPart[]): Promise<void> {
    parts.forEach(async (part) => {
      if (part.socket?.socket && this.availableBones.has(part.socket.socket)) {
        const partGLTF = await this.modelLoader.load(part.url);
        if (partGLTF && partGLTF.scene) {
          const model = partGLTF.scene as Object3D;
          const bone = this.availableBones.get(part.socket.socket);
          if (bone) {
            model.position.set(0, 0, 0);
            model.rotation.set(0, 0, 0);
            model.scale.set(1, 1, 1);

            bone.add(model);

            model.rotateZ(-Math.PI / 2);

            const offsetPosition = new Vector3(
              part.socket.position.x,
              part.socket.position.y,
              part.socket.position.z,
            );
            model.position.copy(offsetPosition);

            const offsetRotation = new Euler(
              MathUtils.degToRad(part.socket.rotation.x),
              MathUtils.degToRad(part.socket.rotation.y),
              MathUtils.degToRad(part.socket.rotation.z),
            );
            model.setRotationFromEuler(offsetRotation);

            model.scale.set(part.socket.scale.x, part.socket.scale.y, part.socket.scale.z);
            this.attachments.set(part.socket.socket, model);
          }
        }
      }
    });
  }
}
