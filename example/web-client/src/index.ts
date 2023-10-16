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
  TweakPane,
} from "@mml-io/3d-web-client-core";
import { ChatNetworkingClient, FromClientChatMessage, TextChatUI } from "@mml-io/3d-web-text-chat";
import {
  UserNetworkingClient,
  UserNetworkingClientUpdate,
  WebsocketStatus,
} from "@mml-io/3d-web-user-networking";
import { VoiceChatManager } from "@mml-io/3d-web-voice-chat";
import { IMMLScene, registerCustomElementsToWindow, setGlobalMMLScene } from "mml-web";
import { AudioListener, Scene } from "three";

import hdrUrl from "../../assets/hdr/industrial_sunset_2k.hdr";
import airAnimationFileUrl from "../../assets/models/unreal-air.glb";
import idleAnimationFileUrl from "../../assets/models/unreal-idle.glb";
import jogAnimationFileUrl from "../../assets/models/unreal-jog.glb";
import meshFileUrl from "../../assets/models/unreal-mesh.glb";
import sprintAnimationFileUrl from "../../assets/models/unreal-run.glb";

import { Room } from "./Room";

const characterDescription: CharacterDescription = {
  airAnimationFileUrl,
  idleAnimationFileUrl,
  jogAnimationFileUrl,
  meshFileUrl,
  sprintAnimationFileUrl,
  modelScale: 1,
};

const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
const host = window.location.host;
const userNetworkAddress = `${protocol}//${host}/network`;

export class App {
  private readonly composer: Composer;
  private readonly tweakPane: TweakPane;

  private readonly scene = new Scene();
  private readonly audioListener = new AudioListener();
  private readonly characterModelLoader = new CharacterModelLoader();
  private readonly timeManager = new TimeManager();
  private readonly keyInputManager = new KeyInputManager(() => {
    return this.cameraManager.dragging;
  });
  private readonly characterManager: CharacterManager;
  private readonly cameraManager: CameraManager;
  private readonly collisionsManager = new CollisionsManager(this.scene);
  private readonly networkClient: UserNetworkingClient;
  private readonly remoteUserStates = new Map<number, CharacterState>();

  private networkChat: ChatNetworkingClient | null = null;
  private textChatUI: TextChatUI | null = null;

  private readonly latestCharacterObject = {
    characterState: null as null | CharacterState,
  };

  private voiceChatManager: VoiceChatManager | null = null;

  private clientId: number | null = null;

  constructor() {
    registerCustomElementsToWindow(window);

    document.addEventListener("mousedown", () => {
      if (this.audioListener.context.state === "suspended") {
        this.audioListener.context.resume();
      }
    });

    const composerHolderElement = document.createElement("div");
    composerHolderElement.style.position = "absolute";
    composerHolderElement.style.width = "100%";
    composerHolderElement.style.height = "100%";
    document.body.appendChild(composerHolderElement);

    this.cameraManager = new CameraManager(composerHolderElement, this.collisionsManager);
    this.cameraManager.camera.add(this.audioListener);

    this.composer = new Composer(this.scene, this.cameraManager.camera, true);
    this.composer.useHDRI(hdrUrl);
    composerHolderElement.appendChild(this.composer.renderer.domElement);

    this.tweakPane = new TweakPane(
      this.composer.renderer,
      this.scene,
      this.composer.effectComposer,
    );
    this.composer.setupTweakPane(this.tweakPane);

    const resizeObserver = new ResizeObserver(() => {
      this.composer.fitContainer();
    });
    resizeObserver.observe(composerHolderElement);

    this.networkClient = new UserNetworkingClient(
      userNetworkAddress,
      (url: string) => new WebSocket(url),
      (status: WebsocketStatus) => {
        if (status === WebsocketStatus.Disconnected || status === WebsocketStatus.Reconnecting) {
          // The connection was lost after being established - the connection may be re-established with a different client ID
          this.characterManager.clear();
          this.remoteUserStates.clear();
        }
      },
      (clientId: number) => {
        this.clientId = clientId;
        this.connectToTextChat();
        if (this.voiceChatManager === null) {
          this.voiceChatManager = new VoiceChatManager(
            clientId,
            this.remoteUserStates,
            this.latestCharacterObject,
          );
        }
        this.characterManager.spawnCharacter(characterDescription, clientId, true);
      },
      (clientId: number, userNetworkingClientUpdate: null | UserNetworkingClientUpdate) => {
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
        this.latestCharacterObject.characterState = characterState;
        this.networkClient.sendUpdate(characterState);
      },
    );
    this.scene.add(this.characterManager.group);

    const mmlCompositionScene = new MMLCompositionScene(
      composerHolderElement,
      this.composer.renderer,
      this.scene,
      this.cameraManager.camera,
      this.audioListener,
      this.collisionsManager,
      () => {
        return this.characterManager.getLocalCharacterPositionAndRotation();
      },
    );
    this.scene.add(mmlCompositionScene.group);
    setGlobalMMLScene(mmlCompositionScene.mmlScene as IMMLScene);

    const documentAddresses = [`${protocol}//${host}/mml-documents/example-mml.html`];
    for (const address of documentAddresses) {
      const frameElement = document.createElement("m-frame");
      frameElement.setAttribute("src", address);
      document.body.appendChild(frameElement);
    }

    const room = new Room();
    this.collisionsManager.addMeshesGroup(room);
    this.scene.add(room);
  }

  private sendMessageToServer(message: string): void {
    if (this.clientId === null || this.networkChat === null) return;
    const chatMessage: FromClientChatMessage = {
      type: "chat",
      id: this.clientId,
      text: message,
    };
    this.networkChat.sendUpdate(chatMessage);
  }

  private connectToTextChat() {
    if (this.clientId === null) return;

    if (this.textChatUI === null) {
      this.textChatUI = new TextChatUI(
        this.clientId.toString(),
        this.sendMessageToServer.bind(this),
      );
      this.textChatUI.init();
    }

    if (this.networkChat === null) {
      this.networkChat = new ChatNetworkingClient(
        `${protocol}//${host}/chat-network?id=${this.clientId}`,
        (url: string) => new WebSocket(`${url}?id=${this.clientId}`),
        (status: WebsocketStatus) => {
          if (status === WebsocketStatus.Disconnected || status === WebsocketStatus.Reconnecting) {
            // The connection was lost after being established - the connection may be re-established with a different client ID
          }
        },
        (clientId: number, chatNetworkingUpdate: null | FromClientChatMessage) => {
          if (chatNetworkingUpdate !== null && this.textChatUI !== null) {
            this.textChatUI.addTextMessage(clientId.toString(), chatNetworkingUpdate.text);
          }
        },
      );
    }
  }

  public update(): void {
    this.timeManager.update();
    this.characterManager.update();
    this.voiceChatManager?.speakingParticipants.forEach((value: boolean, id: number) => {
      this.characterManager.setSpeakingCharacter(id, value);
    });
    this.cameraManager.update();
    this.composer.sun?.updateCharacterPosition(this.characterManager.character?.position);
    this.composer.render(this.timeManager);
    if (this.tweakPane.guiVisible) {
      this.tweakPane.updateStats(this.timeManager);
    }
    requestAnimationFrame(() => {
      this.update();
    });
  }
}

const app = new App();
app.update();
