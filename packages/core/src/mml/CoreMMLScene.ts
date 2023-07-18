

  Interaction,

  InteractionManager,
  MMLClickTrigger,
  PromptManager,
  PromptProps,


  PositionAndRotation,



import { CollisionsManager } from "../collisions/CollisionsManager";

export class CoreMMLScene {
  public group: Group;


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







      getRenderer: () => this.renderer,
      getThreeScene: () => this.scene,
      getRootContainer: () => this.group,
      getCamera: () => this.camera,









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



    this.clickTrigger = MMLClickTrigger.init(document, this.mmlScene as IMMLScene);
    if (this.debug) {
      console.log(this.clickTrigger);

    const frameElement = document.createElement("m-frame");
    frameElement.setAttribute("src", documentAddress);
    document.body.appendChild(frameElement);


