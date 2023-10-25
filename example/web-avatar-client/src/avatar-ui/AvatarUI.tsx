import { PartsSelectorComponent } from "@mml-io/3d-web-avatar-editor-ui";
import type {
  CharacterComposition,
  CollectionDataType,
} from "@mml-io/3d-web-standalone-avatar-editor";
import React from "react";
import { flushSync } from "react-dom";
import { createRoot, Root } from "react-dom/client";

export class AvatarUI {
  private root: Root;
  private container = document.getElementById("avatar-ui");
  public composedCharacterPartsCB: (characterParts: CharacterComposition) => void;

  constructor(
    private collectionData: CollectionDataType,
    composedCharacterPartsCB: (characterParts: CharacterComposition) => void,
  ) {
    this.root = createRoot(this.container!);
    this.composedCharacterPartsCB = composedCharacterPartsCB;
  }

  public render(): void {
    flushSync(() =>
      this.root.render(
        <PartsSelectorComponent
          composedCharacterPartsCB={this.composedCharacterPartsCB}
          collectionData={this.collectionData}
        />,
      ),
    );
  }
}
