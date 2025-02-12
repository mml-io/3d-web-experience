import { CollisionsManager } from "@mml-io/3d-web-client-core";
import {
  ChatProbe,
  GraphicsAdapter,
  IMMLScene,
  Interaction,
  LinkProps,
  MElement,
  MMLGraphicsInterface,
  PromptProps,
  radToDeg,
  RemoteDocumentWrapper,
} from "@mml-io/mml-web";
import { ThreeJSGraphicsAdapter } from "@mml-io/mml-web-threejs";
import { Euler, Group, Object3D, PerspectiveCamera, Scene, Vector3 } from "three";

import { MMLDocumentConfiguration } from "./Networked3dWebExperienceClient";
import { ThreeJSMMLPlacer } from "./ThreeJSMMLPlacer";

type MMLEditingModeConfig = {
  scene: Scene;
  targetElement: HTMLElement;
  iframeBody: HTMLElement;
  iframeWindow: Window;
  graphicsAdapter: ThreeJSGraphicsAdapter;
  onCreate: (mmlDoc: MMLDocumentConfiguration) => void;
  camera: PerspectiveCamera;
  collisionsManager: CollisionsManager;
};

export class MMLEditingMode {
  public group: Group;
  private ghostMMLScene: IMMLScene;
  private placer: ThreeJSMMLPlacer;
  private controlsPanel: HTMLDivElement;
  private placeButton: HTMLButtonElement;

  private currentGhost: null | {
    src: string;
    remoteDocumentWrapper: RemoteDocumentWrapper;
  } = null;

  constructor(private config: MMLEditingModeConfig) {
    this.group = new Group();

    this.controlsPanel = document.createElement("div");
    this.controlsPanel.style.position = "fixed";
    this.controlsPanel.style.display = "flex";
    this.controlsPanel.style.flexDirection = "column";
    this.controlsPanel.style.top = "0";
    this.controlsPanel.style.left = "0";
    this.controlsPanel.style.padding = "20px";
    this.placeButton = document.createElement("button");
    this.placeButton.textContent = "Start placing";
    this.controlsPanel.appendChild(this.placeButton);

    const urls: Array<string> = [
      "http://localhost:8080/assets/static-mml.html",
      "http://localhost:8080/assets/static-mml-2.html",
      "http://localhost:8080/assets/static-mml-3.html",
    ];
    for (const url of urls) {
      const docUrl = url;
      const documentButton = document.createElement("button");
      documentButton.addEventListener("click", () => {
        this.setGhostUrl(docUrl);
      });
      documentButton.textContent = url;
      this.controlsPanel.appendChild(documentButton);
    }

    document.body.appendChild(this.controlsPanel);

    const cube = new Group();
    this.group.add(cube);

    const graphicsAdapterProxy: GraphicsAdapter = {
      getGraphicsAdapterFactory: (): MMLGraphicsInterface<ThreeJSGraphicsAdapter> => {
        return this.config.graphicsAdapter.getGraphicsAdapterFactory();
      },
      getRootContainer: () => {
        return cube;
      },
      getUserPositionAndRotation: () => {
        throw new Error("Should not be called");
      },
      interactionShouldShowDistance: () => {
        return null;
      },
      dispose: () => {
        console.log("graphics adapter .dispose called");
      },
    };

    this.ghostMMLScene = {
      getGraphicsAdapter: () => {
        return graphicsAdapterProxy;
      },
      hasGraphicsAdapter(): boolean {
        return true;
      },
      addCollider: (object: Object3D, mElement: MElement<ThreeJSGraphicsAdapter>) => {
        // no-op
      },
      updateCollider: (object: Object3D) => {
        // no-op
      },
      removeCollider: (object: Object3D) => {
        // no-op
      },
      getUserPositionAndRotation: () => {
        throw new Error("Should not be called");
      },
      addInteraction: (interaction: Interaction<ThreeJSGraphicsAdapter>) => {
        // no-op
      },
      updateInteraction: (interaction: Interaction<ThreeJSGraphicsAdapter>) => {
        // no-op
      },
      removeInteraction: (interaction: Interaction<ThreeJSGraphicsAdapter>) => {
        // no-op
      },
      addChatProbe: (chatProbe: ChatProbe<ThreeJSGraphicsAdapter>) => {
        // no-op
      },
      updateChatProbe: () => {
        // no-op
      },
      removeChatProbe: (chatProbe: ChatProbe<ThreeJSGraphicsAdapter>) => {
        // no-op
      },
      prompt: (
        promptProps: PromptProps,
        abortSignal: AbortSignal,
        callback: (message: string | null) => void,
      ) => {
        // no-op
      },
      link: (
        linkProps: LinkProps,
        abortSignal: AbortSignal,
        windowCallback: (openedWindow: Window | null) => void,
      ) => {
        // no-op
      },
      getLoadingProgressManager: () => {
        return null;
      },
    };

    this.placer = ThreeJSMMLPlacer.init({
      clickTarget: this.config.targetElement,
      rootContainer: this.config.scene,
      camera: this.config.camera,
      placementGhostRoot: cube,
      updatePosition: (position: Vector3, isClick: boolean) => {
        cube.position.copy(position);

        const eulerYXZ = new Euler();
        eulerYXZ.copy(this.config.camera.rotation);
        eulerYXZ.reorder("YZX");
        cube.rotation.y = eulerYXZ.y;

        if (isClick && this.currentGhost) {
          this.config.onCreate({
            url: this.currentGhost.src,
            position: {
              x: position.x,
              y: position.y,
              z: position.z,
            },
            rotation: {
              x: 0,
              y: radToDeg(eulerYXZ.y),
              z: 0,
            },
          });
          this.clearGhost();
        }
      },
    });
  }

  clearGhost() {
    if (this.currentGhost !== null) {
      this.currentGhost.remoteDocumentWrapper.remoteDocument.remove();
      this.currentGhost = null;
    }
  }

  setGhostUrl(url: string) {
    console.log("setGhostUrl", url, this.currentGhost);
    if (this.currentGhost !== null && this.currentGhost.src === url) {
      return;
    }
    this.clearGhost();

    const remoteDocumentWrapper = new RemoteDocumentWrapper(
      url,
      this.config.iframeWindow,
      this.ghostMMLScene,
      () => {
        // no-op
      },
    );
    this.config.iframeBody.appendChild(remoteDocumentWrapper.remoteDocument);

    const ghostFrame = document.createElement("m-frame");
    ghostFrame.setAttribute("src", url);
    remoteDocumentWrapper.remoteDocument.appendChild(ghostFrame);
    this.currentGhost = {
      src: url,
      remoteDocumentWrapper,
    };
  }

  dispose() {
    this.placer.dispose();
  }
}
