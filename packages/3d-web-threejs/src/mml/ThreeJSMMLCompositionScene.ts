import { CollisionsManager, Matr4 } from "@mml-io/3d-web-client-core";
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
  ThreeJSClickTrigger,
  ThreeJSGraphicsAdapter,
  ThreeJSGraphicsInterface,
  ThreeJSInteractionAdapter,
  ThreeJSResourceManager,
} from "@mml-io/mml-web-threejs";
import { PerspectiveCamera, Scene, AudioListener, Group, Object3D } from "three";

import { ThreeJSCollisionManager } from "../collisions/ThreeJSCollisionManager";

type ThreeJSMMLCompositionSceneConfig = {
  targetElement: HTMLElement;
  scene: Scene;
  camera: PerspectiveCamera;
  audioListener: AudioListener;
  collisionsManager: CollisionsManager;
  threeJSCollisionManager: ThreeJSCollisionManager;
  loadingProgressManager: LoadingProgressManager | null;
  getUserPositionAndRotation: () => PositionAndRotation;
};

export class ThreeJSMMLCompositionScene {
  public group: Group;

  public readonly mmlScene: IMMLScene<ThreeJSGraphicsAdapter>;
  public readonly documentTimeManager: MMLDocumentTimeManager;
  private readonly promptManager: PromptManager;
  private readonly interactionManager: InteractionManager;
  private readonly interactionListener: InteractionListener<ThreeJSGraphicsAdapter>;
  private readonly chatProbes = new Set<ChatProbe<ThreeJSGraphicsAdapter>>();
  private readonly clickTrigger: ThreeJSClickTrigger;
  private readonly resourceManager: ThreeJSResourceManager;

  constructor(private config: ThreeJSMMLCompositionSceneConfig) {
    this.group = new Group();
    this.promptManager = PromptManager.init(this.config.targetElement);
    this.resourceManager = new ThreeJSResourceManager();

    const graphicsAdapter: ThreeJSGraphicsAdapter = {
      collisionType: null as unknown as Object3D,
      containerType: null as unknown as Object3D,
      getGraphicsAdapterFactory: () => {
        return ThreeJSGraphicsInterface;
      },
      getRootContainer: () => {
        return this.group;
      },
      interactionShouldShowDistance(
        interaction: Interaction<ThreeJSGraphicsAdapter>,
      ): number | null {
        return ThreeJSInteractionAdapter.interactionShouldShowDistance(
          interaction,
          this.config.camera,
          this.config.scene,
        );
      },
      dispose(): void {},
      getAudioListener: () => {
        return this.config.audioListener;
      },
      getCamera: () => {
        return this.config.camera;
      },
      getThreeScene: () => {
        return this.config.scene;
      },
      getUserPositionAndRotation: () => {
        return this.config.getUserPositionAndRotation();
      },
      getResourceManager: () => {
        return this.resourceManager;
      },
    };

    const { interactionListener, interactionManager } = InteractionManager.init(
      this.config.targetElement,
      (interaction: Interaction<ThreeJSGraphicsAdapter>) => {
        return graphicsAdapter.interactionShouldShowDistance(interaction);
      },
    );
    this.interactionManager = interactionManager;
    this.interactionListener = interactionListener;
    this.documentTimeManager = new MMLDocumentTimeManager();

    const tempMatrix = new Matr4();

    this.mmlScene = {
      getGraphicsAdapter(): ThreeJSGraphicsAdapter {
        return graphicsAdapter;
      },
      hasGraphicsAdapter(): boolean {
        return true;
      },
      addCollider: (object: Object3D, mElement: MElement<ThreeJSGraphicsAdapter>) => {
        const group = object as Group;
        const creationResult = this.config.threeJSCollisionManager.createCollisionMesh(group);
        this.config.collisionsManager.addMeshesGroup(group, creationResult, mElement);
        this.config.threeJSCollisionManager.updateDebugVisualization(
          this.config.collisionsManager.isDebugEnabled(),
          group,
          creationResult.meshBVH,
        );
      },
      updateCollider: (object: Object3D) => {
        object.updateWorldMatrix(true, false);
        tempMatrix.fromArray(object.matrixWorld.elements);
        const group = object as Group;
        this.config.collisionsManager.updateMeshesGroup(group, tempMatrix, object.scale);
        if (this.config.collisionsManager.isDebugEnabled()) {
          this.config.threeJSCollisionManager.updateDebugPosition(group);
        }
      },
      removeCollider: (object: Object3D) => {
        const group = object as Group;
        this.config.collisionsManager.removeMeshesGroup(group);
        this.config.threeJSCollisionManager.removeDebugVisualization(group);
      },
      getUserPositionAndRotation: this.config.getUserPositionAndRotation,
      addInteraction: (interaction: Interaction<ThreeJSGraphicsAdapter>) => {
        this.interactionListener.addInteraction(interaction);
      },
      updateInteraction: (interaction: Interaction<ThreeJSGraphicsAdapter>) => {
        this.interactionListener.updateInteraction(interaction);
      },
      removeInteraction: (interaction: Interaction<ThreeJSGraphicsAdapter>) => {
        this.interactionListener.removeInteraction(interaction);
      },
      addChatProbe: (chatProbe: ChatProbe<ThreeJSGraphicsAdapter>) => {
        this.chatProbes.add(chatProbe);
      },
      updateChatProbe: () => {
        // no-op
      },
      removeChatProbe: (chatProbe: ChatProbe<ThreeJSGraphicsAdapter>) => {
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
        return this.config.loadingProgressManager ?? null;
      },
    };

    this.clickTrigger = ThreeJSClickTrigger.init(
      this.config.targetElement,
      this.group,
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
