import { CollisionsManager, MMLCompositionScene } from "@mml-io/3d-web-client-core";
import {
  BoxGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  Vector3,
} from "three";

import { MMLDocumentConfiguration } from "./Networked3dWebExperienceClient";
import { ThreeJSMMLPlacer } from "./ThreeJSMMLPlacer";

type MMLEditingModeConfig = {
  scene: Scene;
  targetElement: HTMLElement;
  onCreate: (mmlDoc: MMLDocumentConfiguration) => void;
  camera: PerspectiveCamera;
  collisionsManager: CollisionsManager;
};

export class MMLEditingMode {
  public group: Group;
  private placer: ThreeJSMMLPlacer;

  constructor(private config: MMLEditingModeConfig) {
    this.group = new Group();

    this.placer = ThreeJSMMLPlacer.init(
      this.config.targetElement,
      this.config.scene,
      this.config.camera,
      (position: Vector3, isClick: boolean) => {
        cube.position.copy(position);
        cube.position.add({ x: 2, y: 0, z: 0 });

        if (isClick) {
          this.config.onCreate({
            url: "/assets/static-mml.html",
            position: {
              x: position.x,
              y: position.y,
              z: position.z,
            },
          });
        }
      },
    );

    const boxGeometry = new BoxGeometry(1, 1, 1, 1, 1, 1);
    const material = new MeshStandardMaterial({
      color: "purple",
    });
    const cube = new Mesh(boxGeometry, material);
    cube.position.x = 10;
    this.group.add(cube);
  }

  dispose() {
    this.placer.dispose();
  }
}
