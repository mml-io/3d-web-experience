import React from "react";
import { flushSync } from "react-dom";
import { createRoot, Root } from "react-dom/client";

import { AvatarEditor } from "./AvatarEditor";
import collectionData from "./collection.json";

class App {
  root: Root;

  constructor() {
    this.init();
  }

  init() {
    const container = document.getElementById("root");
    this.root = createRoot(container!);
    this.renderComponents();
  }

  renderComponents() {
    flushSync(() => {
      this.root.render(<AvatarEditor collectionData={collectionData} />);
    });
  }
}

new App();
