import React from "react";
import { flushSync } from "react-dom";
import { createRoot, Root } from "react-dom/client";

import { AvatarEditor, MMLCharacterDescription } from "./AvatarEditor";
import collectionData from "./collection.json";
import { mmlCharacterDescription } from "./mmlCharacterDescription";
import { LoadingErrors, parseMMLDescription } from "./parseMMLDescription";

class App {
  root: Root;
  private currentCharacter: MMLCharacterDescription | null = null;
  private loadingErrors: LoadingErrors | null = null;

  constructor() {
    // this is where we'll retrieve the current character's MML description
    if (typeof mmlCharacterDescription === "string") {
      [this.currentCharacter, this.loadingErrors] = parseMMLDescription(mmlCharacterDescription);
    }
    this.init();
  }

  init() {
    const container = document.getElementById("root");
    this.root = createRoot(container!);
    this.renderComponents();
  }

  renderComponents() {
    flushSync(() => {
      this.root.render(
        <AvatarEditor
          collectionData={collectionData}
          currentCharacter={this.currentCharacter}
          loadingErrors={this.loadingErrors}
        />,
      );
    });
  }
}

new App();
