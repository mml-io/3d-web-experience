import { CollisionsManager, Key, KeyInputManager } from "@mml-io/3d-web-client-core";
import {
  ChatProbe,
  GraphicsAdapter,
  IMMLScene,
  Interaction,
  LinkProps,
  MElement,
  MMLGraphicsInterface,
  PositionAndRotation,
  PromptProps,
  radToDeg,
  RemoteDocumentWrapper,
} from "@mml-io/mml-web";
import { ThreeJSGraphicsAdapter } from "@mml-io/mml-web-threejs";
import { Euler, Group, Material, Mesh, Object3D, PerspectiveCamera, Scene, Vector3 } from "three";

import { MMLDocumentConfiguration } from "./Networked3dWebExperienceClient";
import { ThreeJSMMLPlacer } from "./ThreeJSMMLPlacer";

type MMLEditingModeConfig = {
  scene: Scene;
  targetElement: HTMLElement;
  iframeBody: HTMLElement;
  keyInputManager: KeyInputManager;
  iframeWindow: Window;
  graphicsAdapter: ThreeJSGraphicsAdapter;
  onMove: (existingFrame: MElement, mmlDoc: PositionAndRotation) => Promise<void>;
  onCreate: (mmlDoc: MMLDocumentConfiguration) => Promise<void>;
  camera: PerspectiveCamera;
  collisionsManager: CollisionsManager;
};

export class MMLEditingMode {
  public group: Group;
  private ghostMMLScene: IMMLScene;
  private placer: ThreeJSMMLPlacer;
  private controlsPanel: HTMLDivElement;
  private continuousCheckbox: HTMLInputElement;

  private editButton: HTMLButtonElement;
  private currentGhost: null | {
    src: string;
    remoteDocumentWrapper: RemoteDocumentWrapper;
  } = null;
  private waitingForPlacement: boolean = false;

  constructor(private config: MMLEditingModeConfig) {
    this.group = new Group();

    this.controlsPanel = document.createElement("div");
    this.controlsPanel.style.position = "fixed";
    this.controlsPanel.style.display = "flex";
    this.controlsPanel.style.flexDirection = "column";
    this.controlsPanel.style.top = "0";
    this.controlsPanel.style.left = "0";
    this.controlsPanel.style.padding = "20px";
    this.editButton = document.createElement("button");
    this.editButton.textContent = "Edit existing";
    this.editButton.addEventListener("click", () => {
      this.placer.toggleEditMode();
    });
    this.controlsPanel.appendChild(this.editButton);

    this.continuousCheckbox = document.createElement("input");
    this.continuousCheckbox.setAttribute("type", "checkbox");
    this.controlsPanel.appendChild(this.continuousCheckbox);

    const urls: Array<string> = [
      "http://localhost:8080/assets/static-mml.html",
      "http://localhost:8080/assets/static-mml-2.html",
      "http://localhost:8080/assets/static-mml-3.html",
      "https://mmlstorage.com/l4sPd6/1738665435978.html",
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
      keyInputManager: this.config.keyInputManager,
      placementGhostRoot: cube,
      selectedEditFrame: (mElement: MElement) => {
        const src = mElement.getAttribute("src");
        if (src) {
          this.setGhostUrl(src);
        }
      },
      updatePosition: (
        positionAndRotation: PositionAndRotation | null,
        isClick: boolean,
        existingFrame: MElement | null,
      ) => {
        if (this.waitingForPlacement) {
          return;
        }
        if (positionAndRotation === null) {
          return;
        }
        cube.position.copy(positionAndRotation.position);
        cube.rotation.set(
          positionAndRotation.rotation.x,
          positionAndRotation.rotation.y,
          positionAndRotation.rotation.z,
        );

        if (isClick && this.currentGhost) {
          if (existingFrame) {
            console.log("onMove", existingFrame, positionAndRotation);
            this.config.onMove(existingFrame, {
              position: {
                x: positionAndRotation.position.x,
                y: positionAndRotation.position.y,
                z: positionAndRotation.position.z,
              },
              rotation: {
                x: radToDeg(positionAndRotation.rotation.x),
                y: radToDeg(positionAndRotation.rotation.y),
                z: radToDeg(positionAndRotation.rotation.z),
              },
            });
            this.clearGhost();
          } else {
            this.waitingForPlacement = true;
            this.config
              .onCreate({
                url: this.currentGhost.src,
                position: {
                  x: positionAndRotation.position.x,
                  y: positionAndRotation.position.y,
                  z: positionAndRotation.position.z,
                },
                rotation: {
                  x: radToDeg(positionAndRotation.rotation.x),
                  y: radToDeg(positionAndRotation.rotation.y),
                  z: radToDeg(positionAndRotation.rotation.z),
                },
              })
              .then(() => {
                this.waitingForPlacement = false;
                if (!this.continuousCheckbox.checked) {
                  this.clearGhost();
                }
              });
          }
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

  update() {
    this.placer.update();
    this.group.traverse((obj: Object3D) => {
      const asMesh = obj as Mesh;
      if (asMesh.isMesh) {
        const asMaterial = asMesh.material as Material;
        if (asMaterial.isMaterial) {
          asMaterial.opacity = 0.5;
          asMaterial.transparent = true;
          asMaterial.needsUpdate = true;
        }
      }
    });
  }
}
