import { CharacterNetworkClient } from "@mml-playground/character-network";

  CameraManager,


  CollisionsManager,

  CoreMMLScene,
  KeyInputManager,
  RunTimeManager,

import { AudioListener, Fog, Group, PerspectiveCamera, Scene } from "three";

import { Environment } from "./Environment";
import { Lights } from "./Lights";
import { Room } from "./Room";


  private readonly group: Group;
  private readonly scene: Scene;
  private readonly audioListener: AudioListener;
  private readonly composer: Composer;

  private readonly camera: PerspectiveCamera;
  private readonly runTimeManager: RunTimeManager;
  private readonly keyInputManager: KeyInputManager;
  private readonly characterManager: CharacterManager;
  private readonly cameraManager: CameraManager;
  private readonly collisionsManager: CollisionsManager;
  private readonly networkClient: CharacterNetworkClient;

  private readonly modelsPath: string = "/web-client/assets/models";
  private readonly characterDescription: CharacterDescription | null = null;



    this.scene.fog = new Fog(0xdcdcdc, 0.1, 100);
    this.audioListener = new AudioListener();
    this.group = new Group();
    this.scene.add(this.group);

    this.runTimeManager = new RunTimeManager();
    this.keyInputManager = new KeyInputManager();


    this.camera.add(this.audioListener);

    this.networkClient = new CharacterNetworkClient();
    this.collisionsManager = new CollisionsManager(this.scene);
    this.characterManager = new CharacterManager(
      this.collisionsManager,
      this.cameraManager,
      this.runTimeManager,
      this.keyInputManager,
      this.networkClient,
    );
    this.group.add(this.characterManager.group);

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host;

    const mmlScene = new CoreMMLScene(
      this.composer.renderer,
      this.scene,
      this.camera,
      this.audioListener,
      this.collisionsManager,
      () => {
        return this.characterManager.getLocalCharacterPositionAndRotation();
      },
      `${protocol}//${host}/document`,
    );
    this.group.add(mmlScene.group);
    this.group.add(new Environment(this.scene, this.composer.renderer));
    this.group.add(new Lights());

    const room = new Room();
    this.collisionsManager.addMeshesGroup(room);
    this.group.add(room);






      modelScale: 1.0,






    document.addEventListener("mousedown", () => {
      if (this.audioListener.context.state === "suspended") {
        this.audioListener.context.resume();
      }
    });



    this.networkClient.connection




          this.networkClient.connection.clientId!,









  public update(): void {
    this.runTimeManager.update();
    this.characterManager.update();

    this.composer.render(this.runTimeManager.time);
    requestAnimationFrame(() => {
      this.update();
    });






