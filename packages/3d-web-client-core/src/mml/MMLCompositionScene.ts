import {
  IMMLScene,
  Interaction,
  InteractionListener,
  InteractionManager,
  MElement,
  MMLClickTrigger,
  PositionAndRotation,
  PromptManager,
  PromptProps,
  ChatProbe,
} from "mml-web";
import { AudioListener, Group, Object3D, PerspectiveCamera, Scene, WebGLRenderer } from "three";

import { CollisionsManager } from "../collisions/CollisionsManager";

export class MMLCompositionScene {
  public group: Group;

  public readonly mmlScene: IMMLScene;
  private readonly promptManager: PromptManager;
  private readonly interactionManager: InteractionManager;
  private readonly interactionListener: InteractionListener;
  private readonly chatProbes = new Set<ChatProbe>();
  private readonly clickTrigger: MMLClickTrigger;

  constructor(
    targetElement: HTMLElement,
    private renderer: WebGLRenderer,
    private scene: Scene,
    private camera: PerspectiveCamera,
    private audioListener: AudioListener,
    private collisionsManager: CollisionsManager,
    private getUserPositionAndRotation: () => PositionAndRotation,
  ) {
    this.group = new Group();
    this.promptManager = PromptManager.init(targetElement);

    const { interactionListener, interactionManager } = InteractionManager.init(
      targetElement,
      this.camera,
      this.scene,
    );
    this.interactionManager = interactionManager;
    this.interactionListener = interactionListener;

    this.mmlScene = {
      getAudioListener: () => this.audioListener,
      getRenderer: () => this.renderer,
      getThreeScene: () => this.scene,
      getRootContainer: () => this.group,
      getCamera: () => this.camera,
      addCollider: (object: Object3D, mElement: MElement) => {
        this.collisionsManager.addMeshesGroup(object as Group, mElement);
      },
      updateCollider: (object: Object3D) => {
        this.collisionsManager.updateMeshesGroup(object as Group);
      },
      removeCollider: (object: Object3D) => {
        this.collisionsManager.removeMeshesGroup(object as Group);
      },
      getUserPositionAndRotation: this.getUserPositionAndRotation,
      addInteraction: (interaction: Interaction) => {
        this.interactionListener.addInteraction(interaction);
      },
      updateInteraction: (interaction: Interaction) => {
        this.interactionListener.updateInteraction(interaction);
      },
      removeInteraction: (interaction: Interaction) => {
        this.interactionListener.removeInteraction(interaction);
      },
      addChatProbe: (chatProbe: ChatProbe) => {
        this.chatProbes.add(chatProbe);
      },
      updateChatProbe: () => {
        // no-op
      },
      removeChatProbe: (chatProbe: ChatProbe) => {
        this.chatProbes.delete(chatProbe);
      },
      prompt: (promptProps: PromptProps, callback: (message: string | null) => void) => {
        this.promptManager.prompt(promptProps, callback);
      },
    };

    this.clickTrigger = MMLClickTrigger.init(targetElement, this.mmlScene as IMMLScene);
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
