import {
  CameraManager,
  CharacterDescription,
  CharacterManager,
  CharacterModelLoader,
  CharacterState,
  CollisionsManager,
  Composer,
  KeyInputManager,
  MMLCompositionScene,
  TimeManager,
} from "@mml-io/3d-web-client-core";
import { EditableNetworkedDOM, NetworkedDOM } from "@mml-io/networked-dom-document";
import { MMLWebRunnerClient } from "mml-web-runner";
import { AudioListener, Euler, Scene, Vector3 } from "three";

import hdrUrl from "../../assets/hdr/industrial_sunset_2k.hdr";
import airAnimationFileUrl from "../../assets/models/unreal-air.glb";
import idleAnimationFileUrl from "../../assets/models/unreal-idle.glb";
import jogAnimationFileUrl from "../../assets/models/unreal-jog.glb";
import meshFileUrl from "../../assets/models/unreal-mesh.glb";
import sprintAnimationFileUrl from "../../assets/models/unreal-run.glb";

import { LocalAvatarServer } from "./LocalAvatarServer";
import { Room } from "./Room";

const characterDescription: CharacterDescription = {
  airAnimationFileUrl,
  idleAnimationFileUrl,
  jogAnimationFileUrl,
  meshFileUrl,
  sprintAnimationFileUrl,
  modelScale: 1,
};

export class LocalAvatarClient {
  public element: HTMLDivElement;

  private readonly scene = new Scene();
  private readonly audioListener = new AudioListener();
  private readonly characterModelLoader = new CharacterModelLoader();
  public readonly composer: Composer;
  private readonly timeManager = new TimeManager();
  private readonly keyInputManager = new KeyInputManager(() => {
    return this.cameraManager.dragging;
  });
  private readonly characterManager: CharacterManager;
  private readonly cameraManager: CameraManager;

  private readonly collisionsManager = new CollisionsManager(this.scene);
  private readonly remoteUserStates = new Map<number, CharacterState>();

  private mmlComposition: MMLCompositionScene;
  private resizeObserver: ResizeObserver;
  private documentRunnerClients = new Set<MMLWebRunnerClient>();
  private animationFrameRequest: number | null = null;

  constructor(
    private localAvatarServer: LocalAvatarServer,
    private localClientId: number,
    spawnPosition: Vector3,
    spawnRotation: Euler,
  ) {
    this.element = document.createElement("div");
    this.element.style.position = "absolute";
    this.element.style.width = "100%";
    this.element.style.height = "100%";

    document.addEventListener("mousedown", () => {
      if (this.audioListener.context.state === "suspended") {
        this.audioListener.context.resume();
      }
    });

    this.cameraManager = new CameraManager(
      this.element,
      this.collisionsManager,
      Math.PI / 2,
      Math.PI / 2,
    );
    this.cameraManager.camera.add(this.audioListener);

    this.composer = new Composer(this.scene, this.cameraManager.camera, true);
    this.composer.useHDRI(hdrUrl);
    this.element.appendChild(this.composer.renderer.domElement);

    this.resizeObserver = new ResizeObserver(() => {
      this.composer.fitContainer();
    });
    this.resizeObserver.observe(this.element);

    this.localAvatarServer.addClient(
      localClientId,
      (clientId: number, userNetworkingClientUpdate: null | CharacterState) => {
        if (userNetworkingClientUpdate === null) {
          this.remoteUserStates.delete(clientId);
        } else {
          this.remoteUserStates.set(clientId, userNetworkingClientUpdate);
        }
      },
    );

    this.characterManager = new CharacterManager(
      this.composer,
      this.characterModelLoader,
      this.collisionsManager,
      this.cameraManager,
      this.timeManager,
      this.keyInputManager,
      this.remoteUserStates,
      (characterState: CharacterState) => {
        localAvatarServer.send(localClientId, characterState);
      },
    );
    this.scene.add(this.characterManager.group);

    this.mmlComposition = new MMLCompositionScene(
      this.element,
      this.composer.renderer,
      this.scene,
      this.cameraManager.camera,
      this.audioListener,
      this.collisionsManager,
      () => {
        return this.characterManager.getLocalCharacterPositionAndRotation();
      },
    );
    this.scene.add(this.mmlComposition.group);

    const room = new Room();
    this.collisionsManager.addMeshesGroup(room);
    this.scene.add(room);

    this.characterManager.spawnLocalCharacter(
      characterDescription!,
      localClientId,
      spawnPosition,
      spawnRotation,
    );
  }

  public dispose() {
    if (this.animationFrameRequest !== null) {
      cancelAnimationFrame(this.animationFrameRequest);
    }
    for (const documentRunnerClient of this.documentRunnerClients) {
      documentRunnerClient.dispose();
    }
    this.localAvatarServer.removeClient(this.localClientId);
    this.documentRunnerClients.clear();
    this.resizeObserver.disconnect();
    this.mmlComposition.dispose();
    this.characterManager.clear();
    this.cameraManager.dispose();
    this.composer.dispose();
    this.element.remove();
  }

  public update(): void {
    this.timeManager.update();
    this.characterManager.update();
    this.cameraManager.update();
    this.composer.sun?.updateCharacterPosition(this.characterManager.localCharacter?.position);
    this.composer.render(this.timeManager);
    this.animationFrameRequest = requestAnimationFrame(() => {
      this.update();
    });
  }

  public addDocument(
    mmlDocument: NetworkedDOM | EditableNetworkedDOM,
    windowTarget: Window,
    remoteHolderElement: HTMLElement,
  ) {
    const mmlWebRunnerClient = new MMLWebRunnerClient(
      windowTarget,
      remoteHolderElement,
      this.mmlComposition.mmlScene,
    );
    mmlWebRunnerClient.connect(mmlDocument);
    this.documentRunnerClients.add(mmlWebRunnerClient);
  }
}
