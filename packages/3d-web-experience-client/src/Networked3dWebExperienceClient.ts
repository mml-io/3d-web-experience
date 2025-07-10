import { AvatarConfiguration, AvatarSelectionUI } from "@mml-io/3d-web-avatar-selection-ui";
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
  EnvironmentConfiguration,
  ErrorScreen,
  EulXYZ,
  GroundPlane,
  Key,
  KeyInputManager,
  LoadingScreen,
  LoadingScreenConfig,
  MMLCompositionScene,
  TimeManager,
  TweakPane,
  SpawnConfiguration,
  SpawnConfigurationState,
  Vect3,
  VirtualJoystick,
  Character,
} from "@mml-io/3d-web-client-core";
import { StringToHslOptions, TextChatUI, TextChatUIProps } from "@mml-io/3d-web-text-chat";
import {
  FROM_SERVER_CHAT_MESSAGE_TYPE,
  FROM_CLIENT_CHAT_MESSAGE_TYPE,
  ClientChatMessage,
  UserData,
  UserNetworkingClient,
  UserNetworkingClientUpdate,
  WebsocketStatus,
  parseServerChatMessage,
  DeltaNetV01ServerErrors,
  NetworkUpdate,
  SERVER_BROADCAST_MESSAGE_TYPE,
  ServerBroadcastMessage,
  parseServerBroadcastMessage,
} from "@mml-io/3d-web-user-networking";
import {
  IMMLScene,
  LoadingProgressManager,
  registerCustomElementsToWindow,
  setGlobalDocumentTimeManager,
  setGlobalMMLScene,
} from "@mml-io/mml-web";
import { Scene, AudioListener, Vector3 } from "three";

type MMLDocumentConfiguration = {
  url: string;
  position?: {
    x: number;
    y: number;
    z: number;
  };
  rotation?: {
    x: number;
    y: number;
    z: number;
  };
  scale?: {
    x: number;
    y: number;
    z: number;
  };
};

export type Networked3dWebExperienceClientConfig = {
  userNetworkAddress: string;
  sessionToken: string;
  chatVisibleByDefault?: boolean;
  userNameToColorOptions?: StringToHslOptions;
  animationConfig: AnimationConfig;
  voiceChatAddress?: string;
  updateURLLocation?: boolean;
  onServerBroadcast?: (broadcast: ServerBroadcastMessage) => void;
  loadingScreen?: LoadingScreenConfig;
} & UpdatableConfig;

export type UpdatableConfig = {
  enableChat?: boolean;
  mmlDocuments?: { [key: string]: MMLDocumentConfiguration };
  environmentConfiguration?: EnvironmentConfiguration;
  spawnConfiguration?: SpawnConfiguration;
  avatarConfiguration?: AvatarConfiguration;
  allowCustomDisplayName?: boolean;
  enableTweakPane?: boolean;
  allowOrbitalCamera?: boolean;
  postProcessingEnabled?: boolean;
};

function normalizeSpawnConfiguration(spawnConfig?: SpawnConfiguration): SpawnConfigurationState {
  return {
    spawnPosition: {
      x: spawnConfig?.spawnPosition?.x ?? 0,
      y: spawnConfig?.spawnPosition?.y ?? 0,
      z: spawnConfig?.spawnPosition?.z ?? 0,
    },
    spawnPositionVariance: {
      x: spawnConfig?.spawnPositionVariance?.x ?? 0,
      y: spawnConfig?.spawnPositionVariance?.y ?? 0,
      z: spawnConfig?.spawnPositionVariance?.z ?? 0,
    },
    spawnYRotation: spawnConfig?.spawnYRotation ?? 0,
    respawnTrigger: {
      minX: spawnConfig?.respawnTrigger?.minX ?? Number.NEGATIVE_INFINITY,
      maxX: spawnConfig?.respawnTrigger?.maxX ?? Number.POSITIVE_INFINITY,
      minY: spawnConfig?.respawnTrigger?.minY ?? -100,
      maxY: spawnConfig?.respawnTrigger?.maxY ?? Number.POSITIVE_INFINITY,
      minZ: spawnConfig?.respawnTrigger?.minZ ?? Number.NEGATIVE_INFINITY,
      maxZ: spawnConfig?.respawnTrigger?.maxZ ?? Number.POSITIVE_INFINITY,
    },
    enableRespawnButton: spawnConfig?.enableRespawnButton ?? false,
  };
}

export class Networked3dWebExperienceClient {
  private element: HTMLDivElement;
  private canvasHolder: HTMLDivElement;

  private scene: Scene = new Scene();
  private composer: Composer;
  private tweakPane: TweakPane | null = null;
  private audioListener = new AudioListener();

  private cameraManager: CameraManager;

  private collisionsManager: CollisionsManager;

  private characterModelLoader: CharacterModelLoader;
  private characterManager: CharacterManager;

  private timeManager = new TimeManager();

  private keyInputManager = new KeyInputManager();
  private virtualJoystick: VirtualJoystick;

  private mmlCompositionScene: MMLCompositionScene;
  private mmlFrames: { [key: string]: HTMLElement } = {};

  private clientId: number | null = null;
  private networkClient: UserNetworkingClient;
  private remoteUserStates = new Map<number, UserNetworkingClientUpdate>();
  private userProfiles = new Map<number, UserData>();

  private textChatUI: TextChatUI | null = null;

  private avatarSelectionUI: AvatarSelectionUI | null = null;

  private readonly latestCharacterObject = {
    characterState: null as null | CharacterState,
  };
  private characterControllerPaneSet: boolean = false;

  private spawnConfiguration: SpawnConfigurationState;

  private initialLoadCompleted = false;
  private loadingProgressManager = new LoadingProgressManager();
  private loadingScreen: LoadingScreen;
  private errorScreen?: ErrorScreen;
  private groundPlane: GroundPlane | null = null;
  private respawnButton: HTMLDivElement | null = null;

  private currentRequestAnimationFrame: number | null = null;

  constructor(
    private holderElement: HTMLElement,
    private config: Networked3dWebExperienceClientConfig,
  ) {
    this.element = document.createElement("div");
    this.element.style.position = "absolute";
    this.element.style.width = "100%";
    this.element.style.height = "100%";
    this.holderElement.appendChild(this.element);

    document.addEventListener("mousedown", () => {
      if (this.audioListener.context.state === "suspended") {
        this.audioListener.context.resume();
      }
    });

    this.canvasHolder = document.createElement("div");
    this.canvasHolder.style.position = "absolute";
    this.canvasHolder.style.width = "100%";
    this.canvasHolder.style.height = "100%";
    this.element.appendChild(this.canvasHolder);

    this.collisionsManager = new CollisionsManager(this.scene);
    this.cameraManager = new CameraManager(this.canvasHolder, this.collisionsManager);
    this.cameraManager.camera.add(this.audioListener);
    this.characterModelLoader = new CharacterModelLoader();

    this.virtualJoystick = new VirtualJoystick(this.element, {
      radius: 70,
      innerRadius: 20,
      mouseSupport: false,
    });

    this.composer = new Composer({
      scene: this.scene,
      cameraManager: this.cameraManager,
      spawnSun: true,
      environmentConfiguration: this.config.environmentConfiguration,
      postProcessingEnabled: this.config.postProcessingEnabled,
    });
    this.canvasHolder.appendChild(this.composer.renderer.domElement);

    if (this.config.enableTweakPane !== false) {
      this.setupTweakPane();
    }

    const resizeObserver = new ResizeObserver(() => {
      this.composer.fitContainer();
    });
    resizeObserver.observe(this.element);

    const initialNetworkLoadRef = {};
    this.loadingProgressManager.addLoadingAsset(initialNetworkLoadRef, "network", "network");
    this.networkClient = new UserNetworkingClient({
      url: this.config.userNetworkAddress,
      sessionToken: this.config.sessionToken,
      websocketFactory: (url: string) => new WebSocket(url, "delta-net-v0.1"),
      statusUpdateCallback: (status: WebsocketStatus) => {
        console.log(`Websocket status: ${status}`);
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
          this.loadingProgressManager.completedLoadingAsset(initialNetworkLoadRef);
        }
      },
      onUpdate: (update: NetworkUpdate): void => {
        this.onNetworkUpdate(update);
      },
      onServerError: (error: { message: string; errorType: string }) => {
        switch (error.errorType) {
          case DeltaNetV01ServerErrors.USER_AUTHENTICATION_FAILED_ERROR_TYPE:
            this.disposeWithError(error.message);
            break;
          case DeltaNetV01ServerErrors.USER_NETWORKING_CONNECTION_LIMIT_REACHED_ERROR_TYPE:
            this.disposeWithError(error.message);
            break;
          case DeltaNetV01ServerErrors.USER_NETWORKING_SERVER_SHUTDOWN_ERROR_TYPE:
            this.disposeWithError(error.message || "Server shutdown");
            break;
          default:
            console.error(`Unhandled server error: ${error.message}`);
            this.disposeWithError(error.message);
        }
      },
      onCustomMessage: (customType: number, contents: string) => {
        if (customType === SERVER_BROADCAST_MESSAGE_TYPE) {
          const serverBroadcastMessage = parseServerBroadcastMessage(contents);
          if (serverBroadcastMessage instanceof Error) {
            console.error(`Invalid server broadcast message: ${contents}`);
          } else {
            this.config.onServerBroadcast?.(serverBroadcastMessage);
          }
        } else if (customType === FROM_SERVER_CHAT_MESSAGE_TYPE) {
          const serverChatMessage = parseServerChatMessage(contents);
          if (serverChatMessage instanceof Error) {
            console.error(`Invalid server chat message: ${contents}`);
          } else {
            this.handleChatMessage(serverChatMessage.fromUserId, serverChatMessage.message);
          }
        } else {
          console.warn(`Did not recognize custom message type ${customType}`);
        }
      },
    }, {
      username: null,
      characterDescription: null,
      colors: null,
    }, {
      position: { x: 0, y: 0, z: 0 },
      rotation: { quaternionY: 0, quaternionW: 1 },
      state: 0,
    });

    if (this.config.allowOrbitalCamera) {
      this.keyInputManager.createKeyBinding(Key.C, () => {
        if (document.activeElement === document.body) {
          // No input is selected - accept the key press
          this.cameraManager.toggleFlyCamera();
          this.composer.fitContainer();
        }
      });
    }

    this.spawnConfiguration = normalizeSpawnConfiguration(this.config.spawnConfiguration);

    const animationsPromise = Character.loadAnimations(
      this.characterModelLoader,
      this.config.animationConfig,
    );

    this.characterManager = new CharacterManager({
      composer: this.composer,
      characterModelLoader: this.characterModelLoader,
      collisionsManager: this.collisionsManager,
      cameraManager: this.cameraManager,
      timeManager: this.timeManager,
      keyInputManager: this.keyInputManager,
      virtualJoystick: this.virtualJoystick,
      remoteUserStates: this.remoteUserStates,
      sendUpdate: (characterState: CharacterState) => {
        if (this.latestCharacterObject.characterState?.colors !== characterState.colors) {
          // TODO - this is a hack to update the colors, but it should be done in a reactive way when the colors are actually set
          console.log("Updating colors", characterState.colors);
          if (characterState.colors) {
            this.networkClient.updateColors(characterState.colors);
          }
        }
        this.latestCharacterObject.characterState = characterState;
        this.networkClient.sendUpdate(characterState);
      },
      animationsPromise: animationsPromise,
      spawnConfiguration: this.spawnConfiguration,
      characterResolve: (characterId: number) => {
        return this.resolveCharacterData(characterId);
      },
      updateURLLocation: this.config.updateURLLocation !== false,
    });
    this.scene.add(this.characterManager.group);

    if (this.spawnConfiguration.enableRespawnButton) {
      this.element.appendChild(this.characterManager.createRespawnButton());
    }

    this.setGroundPlaneEnabled(this.config.environmentConfiguration?.groundPlane ?? true);

    this.setupMMLScene();

    this.loadingScreen = new LoadingScreen(this.loadingProgressManager, this.config.loadingScreen);
    this.element.append(this.loadingScreen.element);

    this.loadingProgressManager.addProgressCallback(() => {
      const [, completed] = this.loadingProgressManager.toRatio();
      if (completed && !this.initialLoadCompleted) {
        this.initialLoadCompleted = true;
        /*
         When all content (in particular MML) has loaded, spawn the character (this is to avoid the character falling
         through as-yet-unloaded geometry)
        */
        console.log("Initial load completed");

        this.connectToTextChat();
        this.mountAvatarSelectionUI();
        this.spawnCharacter();
      }
    });
    this.loadingProgressManager.setInitialLoad(true);
  }

  private setGroundPlaneEnabled(enabled: boolean) {
    if (enabled && this.groundPlane === null) {
      this.groundPlane = new GroundPlane();
      this.collisionsManager.addMeshesGroup(this.groundPlane);
      this.scene.add(this.groundPlane);
    } else if (!enabled && this.groundPlane !== null) {
      this.collisionsManager.removeMeshesGroup(this.groundPlane);
      this.scene.remove(this.groundPlane);
      this.groundPlane = null;
    }
  }

  public updateConfig(config: Partial<UpdatableConfig>) {
    this.config = {
      ...this.config,
      ...config,
    };
    if (config.environmentConfiguration) {
      this.composer.updateEnvironmentConfiguration(config.environmentConfiguration);
      this.setGroundPlaneEnabled(config.environmentConfiguration.groundPlane ?? true);
    }

    if (this.avatarSelectionUI) {
      if (config.avatarConfiguration) {
        this.avatarSelectionUI.updateAvatarConfig(config.avatarConfiguration);
      }
      this.avatarSelectionUI.updateAllowCustomDisplayName(config.allowCustomDisplayName || false);
    }

    if (config.enableTweakPane !== undefined) {
      if (config.enableTweakPane === false && this.tweakPane !== null) {
        this.tweakPane.dispose();
        this.tweakPane = null;
      } else if (config.enableTweakPane === true && this.tweakPane === null) {
        this.setupTweakPane();
      }
    }

    if (this.config.postProcessingEnabled !== undefined) {
      this.composer.togglePostProcessing(this.config.postProcessingEnabled);
      if (this.tweakPane) {
        this.tweakPane.dispose();
        this.tweakPane = null;
        this.setupTweakPane();
      }
    }

    if (config.allowOrbitalCamera !== undefined) {
      if (config.allowOrbitalCamera === false) {
        this.keyInputManager.removeKeyBinding(Key.C);
        if (this.cameraManager.isFlyCameraOn() === true) {
          // Disable the fly camera if it was enabled
          this.cameraManager.toggleFlyCamera();
        }
      } else if (config.allowOrbitalCamera === true) {
        this.keyInputManager.createKeyBinding(Key.C, () => {
          if (document.activeElement === document.body) {
            // No input is selected - accept the key press
            this.cameraManager.toggleFlyCamera();
            this.composer.fitContainer();
          }
        });
      }
    }

    if (config.enableChat) {
      if (!config.enableChat && this.textChatUI !== null) {
        this.textChatUI.dispose();
        this.textChatUI = null;
      } else {
        this.connectToTextChat();
      }
    }

    this.spawnConfiguration = normalizeSpawnConfiguration(config.spawnConfiguration);
    if (this.characterManager.localController) {
      this.characterManager.localController.updateSpawnConfig(this.spawnConfiguration);
    }
    if (this.spawnConfiguration.enableRespawnButton && !this.respawnButton) {
      this.respawnButton = this.characterManager.createRespawnButton();
      this.element.appendChild(this.respawnButton);
    } else if (!this.spawnConfiguration.enableRespawnButton && this.respawnButton) {
      this.respawnButton.remove();
      this.respawnButton = null;
    }

    if (config.mmlDocuments) {
      this.setMMLDocuments(config.mmlDocuments);
    }
  }

  static createFullscreenHolder(): HTMLDivElement {
    document.body.style.margin = "0";
    document.body.style.overflow = "hidden";

    const holder = document.createElement("div");
    holder.style.position = "absolute";
    holder.style.width = "100%";
    holder.style.height = "100%";
    holder.style.overflow = "hidden";
    document.body.appendChild(holder);
    return holder;
  }

  private resolveCharacterData(clientId: number): UserData {
    const user = this.userProfiles.get(clientId)!;

    if (!user) {
      throw new Error(`Failed to resolve user for clientId ${clientId}`);
    }

    return {
      username: user.username,
      characterDescription: user.characterDescription,
      colors: user.colors,
    };
  }

  private onNetworkUpdate(update: NetworkUpdate): void {
    const { removedUserIds, addedUserIds, updatedUsers } = update;
    for (const clientId of removedUserIds) {
      this.userProfiles.delete(clientId);
      this.remoteUserStates.delete(clientId);
    }
    for (const [clientId, userData] of addedUserIds) {
      this.userProfiles.set(clientId, userData.userState);
      this.remoteUserStates.set(clientId, userData.components);
    }
    for (const [clientId, userData] of updatedUsers) {
      const userState = userData.userState;
      if (userState) {
        if (userState.username !== undefined) {
          this.userProfiles.get(clientId)!.username = userState.username;
        }
        if (userState.characterDescription !== undefined) {
          this.userProfiles.get(clientId)!.characterDescription = userState.characterDescription;
        }
        if (userState.colors !== undefined) {
          this.userProfiles.get(clientId)!.colors = userState.colors;
        }
        this.characterManager.remoteCharacterInfoUpdated(clientId);
      }
      this.remoteUserStates.set(clientId, userData.components);
    }
  }

  private sendIdentityUpdateToServer(
    displayName: string,
    characterDescription: CharacterDescription,
  ) {
    if (!this.clientId) {
      throw new Error("Client ID not set");
    }

    this.networkClient.updateUsername(displayName);
    this.networkClient.updateCharacterDescription(characterDescription);
  }

  private setupTweakPane() {
    if (this.tweakPane) {
      return;
    }

    this.tweakPane = new TweakPane(
      this.element,
      this.composer.renderer,
      this.scene,
      this.composer,
      this.config.postProcessingEnabled,
    );
    this.cameraManager.setupTweakPane(this.tweakPane);
    this.composer.setupTweakPane(this.tweakPane);
  }

  private handleChatMessage(fromUserId: number, message: string) {
    if (this.textChatUI === null) {
      return;
    }

    if (fromUserId === 0) {
      // Server message - handle as system message
      this.textChatUI.addTextMessage("System", message);
    } else {
      // User message
      const user = this.userProfiles.get(fromUserId);
      if (!user) {
        console.error(`User not found for clientId ${fromUserId}`);
        return;
      }
      const username = user.username ?? `Unknown User ${fromUserId}`;
      this.textChatUI.addTextMessage(username, message);
      this.characterManager.addChatBubble(fromUserId, message);
    }
  }

  private connectToTextChat() {
    if (this.clientId === null) {
      return;
    }

    // Chat is now integrated into the main deltanet connection
    // Only create the UI if chat is enabled (not explicitly disabled)
    if (this.config.enableChat && this.textChatUI === null) {
      const user = this.userProfiles.get(this.clientId);
      if (!user) {
        throw new Error("User not found");
      }

      const textChatUISettings: TextChatUIProps = {
        holderElement: this.element,
        sendMessageToServerMethod: (message: string) => {
          this.characterManager.addSelfChatBubble(message);
          this.mmlCompositionScene.onChatMessage(message);

          // Send chat message through deltanet custom message
          this.networkClient.sendCustomMessage(
            FROM_CLIENT_CHAT_MESSAGE_TYPE,
            JSON.stringify({ message } satisfies ClientChatMessage),
          );
        },
        visibleByDefault: this.config.chatVisibleByDefault,
        stringToHslOptions: this.config.userNameToColorOptions,
      };
      this.textChatUI = new TextChatUI(textChatUISettings);
      this.textChatUI.init();
    }
  }

  private mountAvatarSelectionUI() {
    if (this.clientId === null) {
      throw new Error("Client ID not set");
    }
    const ownIdentity = this.userProfiles.get(this.clientId);
    if (!ownIdentity) {
      throw new Error("Own identity not found");
    }
    this.avatarSelectionUI = new AvatarSelectionUI({
      holderElement: this.element,
      visibleByDefault: false,
      displayName: ownIdentity.username ?? `Unknown User ${this.clientId}`, 
      characterDescription: ownIdentity.characterDescription ?? {
        meshFileUrl: "",
      },
      sendIdentityUpdateToServer: this.sendIdentityUpdateToServer.bind(this),
      availableAvatars: this.config.avatarConfiguration?.availableAvatars ?? [],
      allowCustomAvatars: this.config.avatarConfiguration?.allowCustomAvatars,
      allowCustomDisplayName: this.config.allowCustomDisplayName || false,
    });
    this.avatarSelectionUI.init();
  }

  public update(): void {
    this.timeManager.update();
    this.characterManager.update();
    this.cameraManager.update();
    const characterPosition = this.characterManager.localCharacter?.getPosition();
    this.composer.sun?.updateCharacterPosition(
      new Vector3(characterPosition?.x || 0, characterPosition?.y || 0, characterPosition?.z || 0),
    );
    this.composer.render(this.timeManager);
    if (this.tweakPane?.guiVisible) {
      this.tweakPane.updateStats(this.timeManager);
      this.tweakPane.updateCameraData(this.cameraManager);
      if (this.characterManager.localCharacter && this.characterManager.localController) {
        if (!this.characterControllerPaneSet) {
          this.characterControllerPaneSet = true;
          this.characterManager.setupTweakPane(this.tweakPane);
        } else {
          this.tweakPane.updateCharacterData(this.characterManager.localController);
        }
      }
    }
    this.currentRequestAnimationFrame = requestAnimationFrame(() => {
      this.update();
    });
  }

  private randomWithVariance(value: number, variance: number): number {
    const min = value - variance;
    const max = value + variance;
    return Math.random() * (max - min) + min;
  }

  private spawnCharacter() {
    if (this.clientId === null) {
      throw new Error("Client ID not set");
    }

    const spawnPosition = new Vect3();
    spawnPosition.set(
      this.randomWithVariance(
        this.spawnConfiguration.spawnPosition.x,
        this.spawnConfiguration.spawnPositionVariance.x,
      ),
      this.randomWithVariance(
        this.spawnConfiguration.spawnPosition.y,
        this.spawnConfiguration.spawnPositionVariance.y,
      ),
      this.randomWithVariance(
        this.spawnConfiguration.spawnPosition!.z,
        this.spawnConfiguration.spawnPositionVariance.z,
      ),
    );
    const spawnRotation = new EulXYZ(
      0,
      -this.spawnConfiguration.spawnYRotation! * (Math.PI / 180),
      0,
    );

    let cameraPosition: Vect3 | null = null;
    const offset = new Vect3(0, 0, 3.3);
    offset.applyEulerXYZ(new EulXYZ(0, spawnRotation.y, 0));
    cameraPosition = spawnPosition.clone().sub(offset).add(this.characterManager.headTargetOffset);

    if (window.location.hash && window.location.hash.length > 1) {
      const urlParams = decodeCharacterAndCamera(window.location.hash.substring(1));
      spawnPosition.copy(urlParams.character.position);
      spawnRotation.setFromQuaternion(urlParams.character.quaternion);
      cameraPosition = new Vect3(urlParams.camera.position);
    }
    const ownIdentity = this.userProfiles.get(this.clientId);
    if (!ownIdentity) {
      throw new Error("Own identity not found");
    }

    this.characterManager.spawnLocalCharacter(
      this.clientId!,
      ownIdentity.username ?? `Unknown User ${this.clientId}`,
      ownIdentity.characterDescription,
      spawnPosition,
      spawnRotation,
    );

    if (cameraPosition !== null) {
      this.cameraManager.camera.position.set(cameraPosition.x, cameraPosition.y, cameraPosition.z);
      this.cameraManager.setTarget(
        new Vect3().add(spawnPosition).add(this.characterManager.headTargetOffset),
      );
      this.cameraManager.reverseUpdateFromPositions();
    }
  }

  private disposeWithError(message: string) {
    this.dispose();
    this.errorScreen = new ErrorScreen("An error occurred", message);
    this.element.append(this.errorScreen.element);
  }

  public dispose() {
    this.characterManager.dispose();
    this.networkClient.stop();
    for (const [key, element] of Object.entries(this.mmlFrames)) {
      element.remove();
    }
    this.mmlFrames = {};
    this.textChatUI?.dispose();
    this.mmlCompositionScene.dispose();
    this.composer.dispose();
    this.tweakPane?.dispose();
    if (this.currentRequestAnimationFrame !== null) {
      cancelAnimationFrame(this.currentRequestAnimationFrame);
      this.currentRequestAnimationFrame = null;
    }
    this.cameraManager.dispose();
    this.loadingScreen.dispose();
    this.errorScreen?.dispose();
  }

  private setupMMLScene() {
    registerCustomElementsToWindow(window);
    this.mmlCompositionScene = new MMLCompositionScene({
      targetElement: this.element,
      renderer: this.composer.renderer,
      scene: this.scene,
      camera: this.cameraManager.camera,
      audioListener: this.audioListener,
      collisionsManager: this.collisionsManager,
      getUserPositionAndRotation: () => {
        return this.characterManager.getLocalCharacterPositionAndRotation();
      },
    });
    this.scene.add(this.mmlCompositionScene.group);
    setGlobalMMLScene(this.mmlCompositionScene.mmlScene as IMMLScene);
    setGlobalDocumentTimeManager(this.mmlCompositionScene.documentTimeManager);

    this.setMMLDocuments(this.config.mmlDocuments ?? {});

    const mmlProgressManager = this.mmlCompositionScene.mmlScene.getLoadingProgressManager!()!;
    this.loadingProgressManager.addLoadingDocument(mmlProgressManager, "mml", mmlProgressManager);
    mmlProgressManager.addProgressCallback(() => {
      this.loadingProgressManager.updateDocumentProgress(mmlProgressManager);
    });
    mmlProgressManager.setInitialLoad(true);
  }

  private createFrame(mmlDocument: MMLDocumentConfiguration) {
    const frameElement = document.createElement("m-frame");
    frameElement.setAttribute("src", mmlDocument.url);
    this.updateFrameAttributes(frameElement, mmlDocument);
    return frameElement;
  }

  private updateFrameAttributes(frameElement: HTMLElement, mmlDocument: MMLDocumentConfiguration) {
    const existingSrc = frameElement.getAttribute("src");
    if (existingSrc !== mmlDocument.url) {
      frameElement.setAttribute("src", mmlDocument.url);
    }
    if (mmlDocument.position) {
      frameElement.setAttribute("x", mmlDocument.position.x.toString());
      frameElement.setAttribute("y", mmlDocument.position.y.toString());
      frameElement.setAttribute("z", mmlDocument.position.z.toString());
    } else {
      frameElement.setAttribute("x", "0");
      frameElement.setAttribute("y", "0");
      frameElement.setAttribute("z", "0");
    }
    if (mmlDocument.rotation) {
      frameElement.setAttribute("rx", mmlDocument.rotation.x.toString());
      frameElement.setAttribute("ry", mmlDocument.rotation.y.toString());
      frameElement.setAttribute("rz", mmlDocument.rotation.z.toString());
    } else {
      frameElement.setAttribute("rx", "0");
      frameElement.setAttribute("ry", "0");
      frameElement.setAttribute("rz", "0");
    }
    if (mmlDocument.scale?.x !== undefined) {
      frameElement.setAttribute("sx", mmlDocument.scale.x.toString());
    } else {
      frameElement.setAttribute("sx", "1");
    }
    if (mmlDocument.scale?.y !== undefined) {
      frameElement.setAttribute("sy", mmlDocument.scale.y.toString());
    } else {
      frameElement.setAttribute("sy", "1");
    }
    if (mmlDocument.scale?.z !== undefined) {
      frameElement.setAttribute("sz", mmlDocument.scale.z.toString());
    } else {
      frameElement.setAttribute("sz", "1");
    }
  }

  private setMMLDocuments(mmlDocuments: { [key: string]: MMLDocumentConfiguration }) {
    const newFramesMap: { [key: string]: HTMLElement } = {};
    for (const [key, mmlDocSpec] of Object.entries(mmlDocuments)) {
      const existing = this.mmlFrames[key];
      if (!existing) {
        const frameElement = this.createFrame(mmlDocSpec);
        document.body.appendChild(frameElement);
        newFramesMap[key] = frameElement;
      } else {
        delete this.mmlFrames[key];
        newFramesMap[key] = existing;
        this.updateFrameAttributes(existing, mmlDocSpec);
      }
    }
    for (const [key, element] of Object.entries(this.mmlFrames)) {
      element.remove();
    }
    this.mmlFrames = newFramesMap;
  }
}
