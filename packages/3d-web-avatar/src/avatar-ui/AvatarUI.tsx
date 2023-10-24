import { flushSync } from "react-dom";
import { createRoot, Root } from "react-dom/client";

import { AvatarUIComponent } from "./components/AvatarUIComponent";

export type CharacterComposition = {
  head: any;
  upperBody: any;
  lowerBody: any;
  feet: any;
};

export type BodyPartTypes = "head" | "upperBody" | "lowerBody" | "feet";

export class AvatarUI {
  private root: Root;
  private container = document.getElementById("avatar-ui");
  private collectionURL: string;
  public composedCharacterPartsCB: (characterParts: CharacterComposition) => void;

  constructor(composedCharacterPartsCB: (characterParts: CharacterComposition) => void) {
    this.root = createRoot(this.container!);
    this.collectionURL = "/assets/avatar/collection.json";
    this.composedCharacterPartsCB = composedCharacterPartsCB;
  }

  public render(): void {
    flushSync(() =>
      this.root.render(
        <AvatarUIComponent
          collectionURL={this.collectionURL}
          composedCharacterPartsCB={this.composedCharacterPartsCB}
        />,
      ),
    );
  }
}
