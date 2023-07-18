

  Interaction,
  InteractionListener,
  InteractionManager,
  MMLClickTrigger,
  PromptManager,
  PromptProps,


  PositionAndRotation,

import { AudioListener, Group, Object3D, PerspectiveCamera, Scene, WebGLRenderer } from "three";

import { CollisionsManager } from "../collisions/CollisionsManager";

export class CoreMMLScene {
  public group: Group;
  private debug: boolean = false;

  private readonly mmlScene: Partial<IMMLScene>;
  private readonly promptManager: PromptManager;
  private readonly interactionListener: InteractionListener;
  private readonly clickTrigger: MMLClickTrigger;

  constructor(
    private renderer: WebGLRenderer,
    private scene: Scene,
    private camera: PerspectiveCamera,
    private audioListener: AudioListener,
    private collisionsManager: CollisionsManager,
    private getUserPositionAndRotation: () => PositionAndRotation,
    documentAddress: string,
  ) {
    this.group = new Group();
    this.promptManager = PromptManager.init(document.body);

    const { interactionListener } = InteractionManager.init(document.body, this.camera, this.scene);
    this.interactionListener = interactionListener;



      getRenderer: () => this.renderer,
      getThreeScene: () => this.scene,
      getRootContainer: () => this.group,
      getCamera: () => this.camera,
      addCollider: (object: Object3D) => {
        this.collisionsManager.addMeshesGroup(object as Group);
      },
      updateCollider: (object: Object3D) => {
        this.collisionsManager.updateMeshesGroup(object as Group);
      },
      removeCollider: (object: Object3D) => {
        this.collisionsManager.removeMeshesGroup(object as Group);
      },
      getUserPositionAndRotation: this.getUserPositionAndRotation,
      addInteraction: (interaction: Interaction) => {

      },
      updateInteraction: (interaction: Interaction) => {

      },
      removeInteraction: (interaction: Interaction) => {

      },
      prompt: (promptProps: PromptProps, callback: (message: string | null) => void) => {
        this.promptManager.prompt(promptProps, callback);
      },

    setGlobalMScene(this.mmlScene as IMMLScene);
    registerCustomElementsToWindow(window);
    this.clickTrigger = MMLClickTrigger.init(document, this.mmlScene as IMMLScene);
    if (this.debug) {
      console.log(this.clickTrigger);

    const frameElement = document.createElement("m-frame");
    frameElement.setAttribute("src", documentAddress);
    document.body.appendChild(frameElement);


