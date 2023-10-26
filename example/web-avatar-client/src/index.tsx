import {
  Character,
  CharacterComposition,
  CollectionDataType,
  ModelLoader,
} from "@mml-io/3d-web-standalone-avatar-editor";
import React from "react";
import { flushSync } from "react-dom";
import { createRoot, Root } from "react-dom/client";
import { Object3D } from "three";

import collectionData from "./collection.json";
import { AvatarVisualizerWrapper } from "./components/AvatarVisualizerWrapper";
import { PartPickingWrapper } from "./components/PartsPickingWrapper";

class App {
  character: Character;
  currentCharacter: Object3D | null = null;
  modelLoader = new ModelLoader();
  root: Root;

  constructor() {
    this.character = new Character(this.modelLoader);
    this.init();
  }

  updateComposedCharacter = (character: CharacterComposition) => {
    const { head, upperBody, lowerBody, feet } = character;
    this.character.mergeBodyParts(
      head.asset,
      upperBody.asset,
      lowerBody.asset,
      feet.asset,
      (mesh: Object3D) => {
        this.currentCharacter = mesh;
        this.renderComponents();
      },
    );
  };

  init() {
    const container = document.getElementById("root");
    this.root = createRoot(container!);
    this.renderComponents();
  }

  renderComponents() {
    flushSync(() => {
      this.root.render(
        <>
          <PartPickingWrapper
            composedCharacterPartsCB={this.updateComposedCharacter}
            collectionData={collectionData as CollectionDataType}
          />
          <AvatarVisualizerWrapper character={this.currentCharacter!} />
        </>,
      );
    });
  }
}

new App();
