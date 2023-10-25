import { TimeManager } from "@mml-io/3d-web-client-core";
import {
  AnimationState,
  AvatarVisualizer,
  Character,
  CharacterComposition,
  CollectionDataType,
  ModelLoader,
} from "@mml-io/3d-web-standalone-avatar-editor";
import { Object3D } from "three";

import { AvatarUI } from "./avatar-ui/AvatarUI";
import collectionData from "./collection.json";

export class App {
  private readonly avatarVisualizer: AvatarVisualizer;
  private character: Character;
  private avatarUI: AvatarUI | null = null;
  private currentCharacter: Object3D | null = null;
  private timeManager = new TimeManager();
  private modelLoader = new ModelLoader();

  constructor() {
    this.avatarVisualizer = new AvatarVisualizer(this.timeManager);
    this.character = new Character(
      this.avatarVisualizer.avatarScene,
      this.modelLoader,
      this.timeManager,
    );
  }

  public updateComposedCharacter(character: CharacterComposition) {
    const { head, upperBody, lowerBody, feet } = character;
    if (this.currentCharacter !== null) {
      this.avatarVisualizer.avatarScene.remove(this.currentCharacter);
    }

    this.character.mergeBodyParts(
      head.asset,
      upperBody.asset,
      lowerBody.asset,
      feet.asset,
      (mesh: Object3D) => {
        this.currentCharacter = mesh;
        this.character.animationManager?.setAnimationFromURL(
          "/assets/avatar/AS_Andor_Stand_Idle.glb",
          AnimationState.idle,
          this.currentCharacter,
        );
        this.avatarVisualizer.avatarScene.add(this.currentCharacter);
      },
    );
  }

  async init(): Promise<void> {
    this.avatarUI = new AvatarUI(
      collectionData as CollectionDataType,
      (character: CharacterComposition) => this.updateComposedCharacter(character),
    );
    console.log("this.avatarUI", this.avatarUI);
    this.avatarUI.render();
    this.update();
  }

  update(): void {
    if (this.timeManager) {
      this.avatarVisualizer.update();
    }
    this.character.update();
    requestAnimationFrame(() => this.update());
  }

  dispose(): void {
    this.avatarVisualizer.dispose();
  }
}

const app = new App();
app.init();
