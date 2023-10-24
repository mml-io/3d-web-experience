import {
  Character,
  AvatarUI,
  CharacterComposition,
  AvatarVisualizer,
  AnimationState,
} from "@mml-io/3d-web-avatar";
import { Object3D } from "three";

export class App {
  private readonly avatarVisualizer: AvatarVisualizer;
  private character: Character;
  private avatarUI: AvatarUI | null = null;
  private currentCharacter: Object3D | null = null;

  constructor() {
    this.avatarVisualizer = new AvatarVisualizer();
    this.character = new Character(this.avatarVisualizer.avatarScene);
    this.updateComposedCharacter = this.updateComposedCharacter.bind(this);
  }

  public updateComposedCharacter(character: CharacterComposition) {
    const { head, upperBody, lowerBody, feet } = character;
    if (this.currentCharacter !== null) {
      this.avatarVisualizer.avatarScene.remove(this.currentCharacter);
    }
    this.character = new Character(this.avatarVisualizer.avatarScene);

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
    this.avatarUI = new AvatarUI(this.updateComposedCharacter);
    this.avatarUI.render();
    this.update();
  }

  update(): void {
    if (this.character.timeManager) {
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
