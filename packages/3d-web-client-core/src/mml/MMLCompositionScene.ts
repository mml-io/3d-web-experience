import {
  ChatProbe,
  IMMLScene,
  Interaction,
  InteractionListener,
  InteractionManager,
  LinkProps,
  LoadingProgressManager,
  MElement,
  MMLDocumentTimeManager,
  PositionAndRotation,
  PromptManager,
  PromptProps,
} from "@mml-io/mml-web";
import {
  PlayCanvasGraphicsAdapter,
  PlayCanvasGraphicsInterface,
  PlayCanvasInteractionAdapter,
} from "@mml-io/mml-web-playcanvas";
import * as playcanvas from "playcanvas";
import { AppBase } from "playcanvas";

import { CollisionsManager } from "../collisions/CollisionsManager";

import { CustomPlayCanvasClickTrigger } from "./CustomPlayCanvasClickTrigger";

type MMLCompositionSceneConfig = {
  targetElement: HTMLElement;
  playcanvasScene: playcanvas.Scene;
  playcanvasApp: playcanvas.AppBase;
  camera: playcanvas.Entity;
  collisionsManager: CollisionsManager;
  getUserPositionAndRotation: () => PositionAndRotation;
};

export class MMLCompositionScene {
  public group: playcanvas.Entity;

  public readonly mmlScene: IMMLScene<PlayCanvasGraphicsAdapter>;
  public readonly documentTimeManager: MMLDocumentTimeManager;
  private readonly promptManager: PromptManager;
  private readonly interactionManager: InteractionManager;
  private readonly interactionListener: InteractionListener<PlayCanvasGraphicsAdapter>;
  private readonly chatProbes = new Set<ChatProbe<PlayCanvasGraphicsAdapter>>();
  private readonly clickTrigger: CustomPlayCanvasClickTrigger;
  private readonly loadingProgressManager: LoadingProgressManager;

  constructor(private config: MMLCompositionSceneConfig) {
    this.group = new playcanvas.Entity();
    this.promptManager = PromptManager.init(this.config.targetElement);

    const graphicsAdapter: PlayCanvasGraphicsAdapter = {
      collisionType: null as unknown as playcanvas.Entity,
      containerType: null as unknown as playcanvas.Entity,
      getGraphicsAdapterFactory: () => {
        return PlayCanvasGraphicsInterface;
      },
      getRootContainer: () => {
        return this.group;
      },
      interactionShouldShowDistance(
        interaction: Interaction<PlayCanvasGraphicsAdapter>,
      ): number | null {
        return PlayCanvasInteractionAdapter.interactionShouldShowDistance(
          interaction,
          this.config.camera,
          this.config.playcanvasScene,
          this.config.playcanvasApp,
        );
      },
      getPlayCanvasApp: (): AppBase => {
        return this.config.playcanvasApp;
      },
      dispose(): void {},
      getCamera: () => {
        return config.camera;
      },
      getUserPositionAndRotation: () => {
        return this.config.getUserPositionAndRotation();
      },
    };

    const { interactionListener, interactionManager } = InteractionManager.init(
      this.config.targetElement,
      (interaction: Interaction<PlayCanvasGraphicsAdapter>) => {
        return graphicsAdapter.interactionShouldShowDistance(interaction);
      },
    );
    this.interactionManager = interactionManager;
    this.interactionListener = interactionListener;
    this.loadingProgressManager = new LoadingProgressManager();
    this.documentTimeManager = new MMLDocumentTimeManager();

    this.mmlScene = {
      getGraphicsAdapter(): PlayCanvasGraphicsAdapter {
        return graphicsAdapter;
      },
      hasGraphicsAdapter(): boolean {
        return true;
      },
      addCollider: (object: playcanvas.Entity, mElement: MElement<PlayCanvasGraphicsAdapter>) => {
        this.config.collisionsManager.addMeshesGroup(object as playcanvas.Entity, mElement);
      },
      updateCollider: (object: playcanvas.Entity) => {
        this.config.collisionsManager.updateMeshesGroup(object as playcanvas.Entity);
      },
      removeCollider: (object: playcanvas.Entity) => {
        this.config.collisionsManager.removeMeshesGroup(object as playcanvas.Entity);
      },
      getUserPositionAndRotation: this.config.getUserPositionAndRotation,
      addInteraction: (interaction: Interaction<PlayCanvasGraphicsAdapter>) => {
        this.interactionListener.addInteraction(interaction);
      },
      updateInteraction: (interaction: Interaction<PlayCanvasGraphicsAdapter>) => {
        this.interactionListener.updateInteraction(interaction);
      },
      removeInteraction: (interaction: Interaction<PlayCanvasGraphicsAdapter>) => {
        this.interactionListener.removeInteraction(interaction);
      },
      addChatProbe: (chatProbe: ChatProbe<PlayCanvasGraphicsAdapter>) => {
        this.chatProbes.add(chatProbe);
      },
      updateChatProbe: () => {
        // no-op
      },
      removeChatProbe: (chatProbe: ChatProbe<PlayCanvasGraphicsAdapter>) => {
        this.chatProbes.delete(chatProbe);
      },
      prompt: (
        promptProps: PromptProps,
        abortSignal: AbortSignal,
        callback: (message: string | null) => void,
      ) => {
        this.promptManager.prompt(promptProps, abortSignal, callback);
      },
      link: (
        linkProps: LinkProps,
        abortSignal: AbortSignal,
        windowCallback: (openedWindow: Window | null) => void,
      ) => {
        this.promptManager.link(linkProps, abortSignal, windowCallback);
      },
      getLoadingProgressManager: () => {
        return this.loadingProgressManager;
      },
    };

    this.clickTrigger = CustomPlayCanvasClickTrigger.init(
      this.config.collisionsManager,
      this.config.targetElement,
      this.config.camera,
    );
  }

  onChatMessage(message: string) {
    for (const chatProbe of this.chatProbes) {
      chatProbe.trigger(message);
    }
  }

  dispose() {
    this.promptManager.dispose();
    this.clickTrigger.dispose();
    this.interactionManager.dispose();
  }
}
