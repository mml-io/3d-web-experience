import {
  AnimationConfig,
  CameraManager,
  CharacterDescription,
  CharacterManager,
  CharacterModelLoader,
  CharacterState,
  CollisionsManager,
  Composer,
  decodeCharacterAndCamera,
  getSpawnPositionInsideCircle,
  KeyInputManager,
  MMLCompositionScene,
  TimeManager,
  TweakPane,
} from "@mml-io/3d-web-client-core";
import { ChatNetworkingClient, FromClientChatMessage, TextChatUI } from "@mml-io/3d-web-text-chat";
import {
  UserData,
  UserNetworkingClient,
  UserNetworkingClientUpdate,
  WebsocketStatus,
} from "@mml-io/3d-web-user-networking";
import { VoiceChatManager } from "@mml-io/3d-web-voice-chat";
import {
  IMMLScene,
  LoadingProgressManager,
  registerCustomElementsToWindow,
  setGlobalMMLScene,
} from "mml-web";
import { AudioListener, Euler, Scene, Vector3 } from "three";

import hdrUrl from "../../assets/hdr/puresky_2k.hdr";
import airAnimationFileUrl from "../../assets/models/anim_air.glb";
import idleAnimationFileUrl from "../../assets/models/anim_idle.glb";
import jogAnimationFileUrl from "../../assets/models/anim_jog.glb";
import sprintAnimationFileUrl from "../../assets/models/anim_run.glb";

import { LoadingScreen } from "./LoadingScreen";
import { Room } from "./Room";

const animationConfig: AnimationConfig = {
  airAnimationFileUrl,
  idleAnimationFileUrl,
  jogAnimationFileUrl,
  sprintAnimationFileUrl,
};

const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
const host = window.location.host;
const userNetworkAddress = `${protocol}//${host}/network`;

export class App {
  private element: HTMLDivElement;
  private composer: Composer;
  private tweakPane: TweakPane;

  private scene = new Scene();
  private audioListener = new AudioListener();
  private characterModelLoader = new CharacterModelLoader();
  private timeManager = new TimeManager();
  private keyInputManager = new KeyInputManager();
  private characterManager: CharacterManager;
  private cameraManager: CameraManager;
  private collisionsManager = new CollisionsManager(this.scene);
  private mmlCompositionScene: MMLCompositionScene;
  private networkClient: UserNetworkingClient;
  private remoteUserStates = new Map<number, CharacterState>();
  // A dictionary holding information about my own user and all remote users
  private userProfiles = new Map<number, UserData>();

  private networkChat: ChatNetworkingClient | null = null;
  private textChatUI: TextChatUI | null = null;

  private voiceChatManager: VoiceChatManager | null = null;

  private readonly latestCharacterObject = {
    characterState: null as null | CharacterState,
  };
  private clientId: number | null = null;

  private initialLoadCompleted = false;
  private loadingProgressManager = new LoadingProgressManager();
  private loadingScreen: LoadingScreen;

  private appWrapper = document.getElementById("app");
  private initialNetworkLoadRef = {};

  constructor(private sessionToken: string) {
    document.addEventListener("mousedown", () => {
      if (this.audioListener.context.state === "suspended") {
        this.audioListener.context.resume();
      }
    });

    this.element = document.createElement("div");
    this.element.style.position = "absolute";
    this.element.style.width = "100%";
    this.element.style.height = "100%";
    if (this.appWrapper) {
      this.appWrapper.appendChild(this.element);
    } else {
      document.body.appendChild(this.element);
    }

    this.cameraManager = new CameraManager(this.element, this.collisionsManager);
    this.cameraManager.camera.add(this.audioListener);

    this.composer = new Composer(this.scene, this.cameraManager.camera, true);
    this.composer.useHDRI(hdrUrl);
    this.element.appendChild(this.composer.renderer.domElement);

    this.tweakPane = new TweakPane(
      this.composer.renderer,
      this.scene,
      this.composer.effectComposer,
    );
    this.composer.setupTweakPane(this.tweakPane);

    const resizeObserver = new ResizeObserver(() => {
      this.composer.fitContainer();
    });
    resizeObserver.observe(this.element);

    this.loadingProgressManager.addLoadingAsset(this.initialNetworkLoadRef, "network", "network");
    this.networkClient = new UserNetworkingClient({
      url: userNetworkAddress,
      sessionToken: this.sessionToken,
      websocketFactory: (url: string) => new WebSocket(url),
      statusUpdateCallback: (status: WebsocketStatus) => {
        if (status === WebsocketStatus.Disconnected || status === WebsocketStatus.Reconnecting) {
          // The connection was lost after being established - the connection may be re-established with a different client ID
          this.characterManager.clear();
          this.remoteUserStates.clear();
          this.clientId = null;
        }
      },
      assignedIdentity: (clientId: number) => {
        console.log(`Assigned ID: ${clientId}`);
        this.clientId = clientId;
        if (this.initialLoadCompleted) {
          // Already loaded - respawn the character
          this.spawnCharacter();
        } else {
          this.loadingProgressManager.completedLoadingAsset(this.initialNetworkLoadRef);
        }
      },
      clientUpdate: (
        remoteClientId: number,
        userNetworkingClientUpdate: null | UserNetworkingClientUpdate,
      ) => {
        if (userNetworkingClientUpdate === null) {
          this.remoteUserStates.delete(remoteClientId);
        } else {
          this.remoteUserStates.set(remoteClientId, userNetworkingClientUpdate);
        }
      },
      clientProfileUpdated: (
        clientId: number,
        username: string,
        characterDescription: CharacterDescription,
      ): void => {
        this.updateUserProfile(clientId, {
          username,
          characterDescription,
        });
      },
    });

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
      animationConfig,
      (characterId: number) => {
        return this.resolveCharacterData(characterId);
      },
    );
    this.scene.add(this.characterManager.group);

    const room = new Room();
    this.collisionsManager.addMeshesGroup(room);
    this.scene.add(room);

    this.setupMMLScene();

    this.loadingScreen = new LoadingScreen(this.loadingProgressManager);
    document.body.append(this.loadingScreen.element);

    this.loadingProgressManager.addProgressCallback(() => {
      const [, completed] = this.loadingProgressManager.toRatio();
      if (completed && !this.initialLoadCompleted) {
        this.initialLoadCompleted = true;
        /*
         When all content (in particular MML) has loaded, spawn the character (this is to avoid the character falling
         through as-yet-unloaded geometry)
        */
        this.connectToVoiceChat();
        this.connectToTextChat();
        this.spawnCharacter();
      }
    });
    this.loadingProgressManager.setInitialLoad(true);
  }

  private resolveCharacterData(clientId: number): {
    username: string;
    characterDescription: CharacterDescription;
  } {
    const user = this.userProfiles.get(clientId)!;
    if (!user) {
      throw new Error(`Failed to resolve user for clientId ${clientId}`);
    }

    return {
      username: user.username,
      characterDescription: user.characterDescription,
    };
  }

  private updateUserProfile(id: number, userData: UserData) {
    console.log(`Update user_profile for id=${id} (username=${userData.username})`);

    this.userProfiles.set(id, userData);

    this.characterManager.respawnIfPresent(id);
  }

  private sendChatMessageToServer(message: string): void {
    this.mmlCompositionScene.onChatMessage(message);
    if (this.clientId === null || this.networkChat === null) return;
    this.networkChat.sendChatMessage(message);
  }

  private connectToVoiceChat() {
    if (this.clientId === null) return;

    if (this.voiceChatManager === null) {
      this.voiceChatManager = new VoiceChatManager(
        this.clientId,
        this.remoteUserStates,
        this.latestCharacterObject,
      );
    }
  }

  private connectToTextChat() {
    if (this.clientId === null) {
      return;
    }
    const user = this.userProfiles.get(this.clientId);
    if (!user) {
      throw new Error("User not found");
    }

    if (this.textChatUI === null) {
      this.textChatUI = new TextChatUI(user.username, this.sendChatMessageToServer.bind(this));
      this.textChatUI.init();
    }

    if (this.networkChat === null) {
      this.networkChat = new ChatNetworkingClient({
        url: `${protocol}//${host}/chat-network`,
        sessionToken: this.sessionToken,
        websocketFactory: (url: string) => new WebSocket(`${url}?id=${this.clientId}`),
        statusUpdateCallback: (status: WebsocketStatus) => {
          if (status === WebsocketStatus.Disconnected || status === WebsocketStatus.Reconnecting) {
            // The connection was lost after being established - the connection may be re-established with a different client ID
          }
        },
        clientChatUpdate: (
          clientId: number,
          chatNetworkingUpdate: null | FromClientChatMessage,
        ) => {
          if (chatNetworkingUpdate !== null && this.textChatUI !== null) {
            const username = this.userProfiles.get(clientId)?.username || "Unknown";
            this.textChatUI.addTextMessage(username, chatNetworkingUpdate.text);
          }
        },
      });
    }
  }

  public update(): void {
    this.timeManager.update();
    this.characterManager.update();
    this.voiceChatManager?.speakingParticipants.forEach((value: boolean, id: number) => {
      this.characterManager.setSpeakingCharacter(id, value);
    });
    this.cameraManager.update();
    this.composer.sun?.updateCharacterPosition(this.characterManager.localCharacter?.position);
    this.composer.render(this.timeManager);
    if (this.tweakPane.guiVisible) {
      this.tweakPane.updateStats(this.timeManager);
    }
    requestAnimationFrame(() => {
      this.update();
    });
  }

  private spawnCharacter() {
    if (this.clientId === null) {
      throw new Error("Client ID not set");
    }
    const spawnPosition = getSpawnPositionInsideCircle(3, 30, this.clientId!, 0.4);
    const spawnRotation = new Euler(0, 0, 0);
    let cameraPosition: Vector3 | null = null;
    if (window.location.hash && window.location.hash.length > 1) {
      const urlParams = decodeCharacterAndCamera(window.location.hash.substring(1));
      spawnPosition.copy(urlParams.character.position);
      spawnRotation.setFromQuaternion(urlParams.character.quaternion);
      cameraPosition = urlParams.camera.position;
    }
    const ownIdentity = this.userProfiles.get(this.clientId);
    if (!ownIdentity) {
      throw new Error("Own identity not found");
    }

    this.characterManager.spawnLocalCharacter(
      this.clientId!,
      ownIdentity.username,
      ownIdentity.characterDescription,
      spawnPosition,
      spawnRotation,
    );
    if (cameraPosition !== null) {
      this.cameraManager.camera.position.copy(cameraPosition);
      this.cameraManager.setTarget(
        new Vector3().add(spawnPosition).add(this.characterManager.headTargetOffset),
      );
      this.cameraManager.reverseUpdateFromPositions();
    }
  }

  private setupMMLScene() {
    registerCustomElementsToWindow(window);
    this.mmlCompositionScene = new MMLCompositionScene(
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
    this.scene.add(this.mmlCompositionScene.group);
    setGlobalMMLScene(this.mmlCompositionScene.mmlScene as IMMLScene);

    const documentAddresses = [`${protocol}//${host}/mml-documents/example-mml.html`];
    for (const address of documentAddresses) {
      const frameElement = document.createElement("m-frame");
      frameElement.setAttribute("src", address);
      document.body.appendChild(frameElement);
    }

    const mmlProgressManager = this.mmlCompositionScene.mmlScene.getLoadingProgressManager!()!;
    this.loadingProgressManager.addLoadingDocument(mmlProgressManager, "mml", mmlProgressManager);
    mmlProgressManager.addProgressCallback(() => {
      this.loadingProgressManager.updateDocumentProgress(mmlProgressManager);
    });
    mmlProgressManager.setInitialLoad(true);
  }
}

const app = new App((window as any).SESSION_TOKEN);
app.update();
