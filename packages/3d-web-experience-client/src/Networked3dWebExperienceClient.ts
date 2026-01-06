import {
  AnimationConfig,
  CameraManager,
  CameraTransform,
  CharacterDescription,
  CharacterState,
  CollisionsManager,
  EnvironmentConfiguration,
  ErrorScreen,
  EulXYZ,
  Key,
  KeyInputManager,
  LoadingScreen,
  LoadingScreenConfig,
  SpawnConfiguration,
  SpawnConfigurationState,
  Vect3,
  VirtualJoystick,
  Quat,
  getSpawnData,
  IRenderer,
  RenderState,
  CharacterManager,
  MMLDocumentConfiguration,
  TweakPane,
  createDefaultCharacterControllerValues,
  createDefaultCameraValues,
  RendererConfig,
} from "@mml-io/3d-web-client-core";
import { ThreeJSWorldRenderer } from "@mml-io/3d-web-threejs";
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
import { LoadingProgressManager, registerCustomElementsToWindow } from "@mml-io/mml-web";

import { AvatarSelectionUI, AvatarConfiguration } from "./avatar-selection-ui";
import { StringToHslOptions, TextChatUI, TextChatUIProps } from "./chat-ui";
import styles from "./Networked3dWebExperience.module.css";

export type Networked3dWebExperienceClientConfig = {
  userNetworkAddress: string;
  sessionToken: string;
  authToken?: string | null;
  chatVisibleByDefault?: boolean;
  userNameToColorOptions?: StringToHslOptions;
  animationConfig: AnimationConfig;
  voiceChatAddress?: string;
  updateURLLocation?: boolean;
  onServerBroadcast?: (broadcast: ServerBroadcastMessage) => void;
  loadingScreen?: LoadingScreenConfig;
  createRenderer?: (options: CreateRendererOptions) => IRenderer;
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

export type CreateRendererOptions = {
  targetElement: HTMLElement;
  coreCameraManager: CameraManager;
  collisionsManager: CollisionsManager;
  config: RendererConfig;
  tweakPane: TweakPane;
  mmlTargetWindow: Window;
  mmlTargetElement: HTMLElement;
  loadingProgressManager: LoadingProgressManager;
  mmlDocuments: { [key: string]: MMLDocumentConfiguration };
  mmlAuthToken: string | null;
  onInitialized: () => void;
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

  private renderer: IRenderer;
  private rendererConfig: RendererConfig;

  private cameraManager: CameraManager;
  private collisionsManager: CollisionsManager;
  private characterManager: CharacterManager;
  private keyInputManager = new KeyInputManager();
  private virtualJoystick: VirtualJoystick;

  private clientId: number | null = null;
  private networkClient: UserNetworkingClient;
  private remoteUserStates = new Map<number, UserNetworkingClientUpdate>();
  private userProfiles = new Map<number, UserData>();

  private textChatUI: TextChatUI | null = null;
  private avatarSelectionUI: AvatarSelectionUI | null = null;
  private tweakPane: TweakPane;

  private spawnConfiguration: SpawnConfigurationState;
  private cameraValues = createDefaultCameraValues();
  private characterControllerValues = createDefaultCharacterControllerValues();

  private initialLoadCompleted = false;
  private loadingProgressManager = new LoadingProgressManager();
  private loadingScreen: LoadingScreen;
  private errorScreen?: ErrorScreen;
  private respawnButton: HTMLDivElement | null = null;

  // Frame timing
  private currentRequestAnimationFrame: number | null = null;
  private lastUpdateTimeMs: number = 0;
  private frameCounter: number = 0;
  private readonly targetFPS: number = 60;
  private readonly fixedDeltaTime: number = 1 / this.targetFPS;
  private readonly frameIntervalMs: number = 1000 / this.targetFPS;
  private accumulatedTime: number = 0;

  private cachedCameraTransform: CameraTransform = {
    position: new Vect3(),
    rotation: { x: 0, y: 0, z: 0 },
    fov: 0,
  };

  constructor(
    private holderElement: HTMLElement,
    private config: Networked3dWebExperienceClientConfig,
  ) {
    this.element = document.createElement("div");
    this.element.style.position = "absolute";
    this.element.style.width = "100%";
    this.element.style.height = "100%";
    this.holderElement.appendChild(this.element);

    this.canvasHolder = document.createElement("div");
    this.canvasHolder.style.position = "absolute";
    this.canvasHolder.style.width = "100%";
    this.canvasHolder.style.height = "100%";
    this.element.appendChild(this.canvasHolder);

    this.collisionsManager = new CollisionsManager();
    this.cameraManager = new CameraManager(this.canvasHolder, this.collisionsManager);

    this.virtualJoystick = new VirtualJoystick(this.element, {
      radius: 70,
      innerRadius: 20,
      mouseSupport: false,
    });

    this.tweakPane = new TweakPane(
      this.canvasHolder,
      {
        cameraValues: this.cameraValues,
        characterControllerValues: this.characterControllerValues,
      },
      config.enableTweakPane ?? false,
    );

    this.spawnConfiguration = normalizeSpawnConfiguration(this.config.spawnConfiguration);

    const spawnData = getSpawnData(this.spawnConfiguration, true);
    const spawnRotation = new Quat().setFromEulerXYZ(spawnData.spawnRotation);

    const initialNetworkLoadRef = {};
    this.loadingProgressManager.addLoadingAsset(initialNetworkLoadRef, "network", "network");
    this.networkClient = new UserNetworkingClient(
      {
        url: this.config.userNetworkAddress,
        sessionToken: this.config.sessionToken,
        websocketFactory: (url: string) => new WebSocket(url, "delta-net-v0.1"),
        statusUpdateCallback: (status: WebsocketStatus) => {
          console.log(`Websocket status: ${status}`);
          if (status === WebsocketStatus.Disconnected || status === WebsocketStatus.Reconnecting) {
            this.characterManager.clear();
            this.remoteUserStates.clear();
            this.clientId = null;
          }
        },
        assignedIdentity: (clientId: number) => {
          console.log(`Assigned ID: ${clientId}`);
          this.clientId = clientId;
          // Set the local client ID early to prevent the local character from being
          // spawned as a remote character when network updates arrive before loading completes
          this.characterManager.setLocalClientId(clientId);
          if (this.initialLoadCompleted) {
            const spawnData = getSpawnData(this.spawnConfiguration, true);
            this.spawnCharacter(spawnData);
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
      },
      {
        username: null,
        characterDescription: null,
        colors: null,
      },
      {
        position: spawnData.spawnPosition,
        rotation: {
          quaternionY: spawnRotation.y,
          quaternionW: spawnRotation.w,
        },
        state: 0,
      },
    );

    if (this.config.allowOrbitalCamera) {
      this.keyInputManager.createKeyBinding(Key.C, () => {
        if (document.activeElement === document.body) {
          this.cameraManager.toggleFlyCamera();
          this.renderer.fitContainer();
        }
      });
    }

    this.characterManager = new CharacterManager({
      collisionsManager: this.collisionsManager,
      cameraManager: this.cameraManager,
      keyInputManager: this.keyInputManager,
      virtualJoystick: this.virtualJoystick,
      remoteUserStates: this.remoteUserStates,
      sendUpdate: (characterState: CharacterState) => {
        this.networkClient.sendUpdate(characterState);
      },
      sendLocalCharacterColors: (colors: Array<[number, number, number]>) => {
        this.networkClient.updateColors(colors);
      },
      spawnConfiguration: this.spawnConfiguration,
      characterControllerValues: this.characterControllerValues,
      characterResolve: (clientId: number) => {
        return this.resolveCharacterData(clientId);
      },
      updateURLLocation: this.config.updateURLLocation !== false,
    });

    if (this.spawnConfiguration.enableRespawnButton) {
      this.respawnButton = this.createRespawnButton();
      this.element.appendChild(this.respawnButton);
    }

    this.loadingScreen = new LoadingScreen(this.loadingProgressManager, this.config.loadingScreen);
    this.element.append(this.loadingScreen.element);

    this.loadingProgressManager.addProgressCallback(() => {
      const [, completed] = this.loadingProgressManager.toRatio();
      if (completed && !this.initialLoadCompleted) {
        this.initialLoadCompleted = true;
        this.connectToTextChat();
        this.mountAvatarSelectionUI();
        this.spawnCharacter(spawnData);
      }
    });

    registerCustomElementsToWindow(window);
    this.rendererConfig = {
      animationConfig: config.animationConfig,
      environmentConfiguration: config.environmentConfiguration,
      postProcessingEnabled: config.postProcessingEnabled,
      spawnSun: true,
      enableTweakPane: config.enableTweakPane,
    };

    if (this.config.createRenderer) {
      this.renderer = this.config.createRenderer({
        targetElement: this.canvasHolder,
        coreCameraManager: this.cameraManager,
        collisionsManager: this.collisionsManager,
        config: this.rendererConfig,
        tweakPane: this.tweakPane,
        mmlTargetWindow: window,
        mmlTargetElement: document.body,
        loadingProgressManager: this.loadingProgressManager,
        mmlDocuments: this.config.mmlDocuments ?? {},
        mmlAuthToken: this.config.authToken ?? null,
        onInitialized: () => {
          this.loadingProgressManager.setInitialLoad(true);
        },
      });
    } else {
      // Default to ThreeJS renderer
      this.renderer = new ThreeJSWorldRenderer({
        targetElement: this.canvasHolder,
        coreCameraManager: this.cameraManager,
        collisionsManager: this.collisionsManager,
        config: this.rendererConfig,
        tweakPane: this.tweakPane,
        mmlTargetWindow: window,
        mmlTargetElement: document.body,
        loadingProgressManager: this.loadingProgressManager,
        mmlDocuments: this.config.mmlDocuments ?? {},
        mmlAuthToken: this.config.authToken ?? null,
      });
      this.loadingProgressManager.setInitialLoad(true);
    }

    if (this.characterManager.localController) {
      this.characterManager.setupTweakPane(this.tweakPane);
    }

    const resizeObserver = new ResizeObserver(() => {
      this.renderer.fitContainer();
    });
    resizeObserver.observe(this.element);
  }

  public updateConfig(config: Partial<UpdatableConfig>) {
    this.config = {
      ...this.config,
      ...config,
    };

    // Update renderer config if any renderer-related config changed
    const rendererConfigUpdate: Partial<RendererConfig> = {};
    if (config.environmentConfiguration !== undefined) {
      rendererConfigUpdate.environmentConfiguration = config.environmentConfiguration;
    }
    if (config.postProcessingEnabled !== undefined) {
      rendererConfigUpdate.postProcessingEnabled = config.postProcessingEnabled;
    }
    if (config.enableTweakPane !== undefined) {
      rendererConfigUpdate.enableTweakPane = config.enableTweakPane;
    }

    if (Object.keys(rendererConfigUpdate).length > 0) {
      this.rendererConfig = {
        ...this.rendererConfig,
        ...rendererConfigUpdate,
      };
      this.renderer.updateConfig(rendererConfigUpdate);
    }

    if (this.avatarSelectionUI) {
      if (config.avatarConfiguration) {
        this.avatarSelectionUI.updateAvatarConfig(config.avatarConfiguration);
      }
      this.avatarSelectionUI.updateAllowCustomDisplayName(config.allowCustomDisplayName || false);
    }

    if (config.allowOrbitalCamera !== undefined) {
      if (config.allowOrbitalCamera === false) {
        this.keyInputManager.removeKeyBinding(Key.C);
        if (this.cameraManager.isFlyCameraOn() === true) {
          this.cameraManager.toggleFlyCamera();
        }
      } else if (config.allowOrbitalCamera === true) {
        this.keyInputManager.createKeyBinding(Key.C, () => {
          if (document.activeElement === document.body) {
            this.cameraManager.toggleFlyCamera();
            this.renderer.fitContainer();
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
      this.respawnButton = this.createRespawnButton();
      this.element.appendChild(this.respawnButton);
    } else if (!this.spawnConfiguration.enableRespawnButton && this.respawnButton) {
      this.respawnButton.remove();
      this.respawnButton = null;
    }

    if (config.mmlDocuments !== undefined) {
      this.renderer.setMMLConfiguration(config.mmlDocuments, this.config.authToken ?? null);
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

  private createRespawnButton(): HTMLDivElement {
    const respawnButton = document.createElement("div");
    respawnButton.className = styles.respawnButton;
    respawnButton.textContent = "RESPAWN";
    respawnButton.addEventListener("click", () => {
      this.characterManager.localController?.resetPosition();
    });
    return respawnButton;
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
    for (const [clientId, userDataUpdate] of updatedUsers) {
      const userState = userDataUpdate.userState;
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
        this.characterManager.networkCharacterInfoUpdated(clientId);
      }
      this.remoteUserStates.set(clientId, userDataUpdate.components);
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

  private handleChatMessage(fromUserId: number, message: string) {
    if (this.textChatUI === null) {
      return;
    }

    if (fromUserId === 0) {
      this.textChatUI.addTextMessage("System", message);
    } else {
      const user = this.userProfiles.get(fromUserId);
      if (!user) {
        console.error(`User not found for clientId ${fromUserId}`);
        return;
      }
      const username = user.username ?? `Unknown User ${fromUserId}`;
      this.textChatUI.addTextMessage(username, message);
      this.renderer.addChatBubble(fromUserId, message);
    }
  }

  private connectToTextChat() {
    if (this.clientId === null) {
      return;
    }

    if (this.config.enableChat && this.textChatUI === null) {
      const user = this.userProfiles.get(this.clientId);
      if (!user) {
        throw new Error("User not found");
      }

      const textChatUISettings: TextChatUIProps = {
        holderElement: this.canvasHolder,
        sendMessageToServerMethod: (message: string) => {
          this.renderer.onChatMessage(message);

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
    const currentTimeMs = performance.now();

    this.currentRequestAnimationFrame = requestAnimationFrame(() => {
      this.update();
    });

    // Calculate elapsed time since last frame
    const elapsedMs = currentTimeMs - this.lastUpdateTimeMs;
    this.lastUpdateTimeMs = currentTimeMs;

    // Clamp elapsed time to prevent spiral of death (e.g., after tab switch)
    const elapsedSeconds = Math.min(elapsedMs / 1000, 0.1);

    // Accumulate time for fixed timestep physics
    this.accumulatedTime += elapsedSeconds;

    // Track if any physics updates occurred this frame
    let physicsUpdated = false;
    const updatedCharacterDescriptions: number[] = [];
    const removedUserIds: number[] = [];

    // Run physics at fixed timestep - this ensures deterministic behavior
    // regardless of display refresh rate (60Hz, 120Hz, 144Hz, etc.)
    while (this.accumulatedTime >= this.fixedDeltaTime) {
      this.frameCounter++;

      // Update character manager with fixed timestep
      const result = this.characterManager.update(this.fixedDeltaTime, this.frameCounter);

      // Merge results from all physics steps
      for (const id of result.updatedCharacterDescriptions) {
        if (!updatedCharacterDescriptions.includes(id)) {
          updatedCharacterDescriptions.push(id);
        }
      }
      for (const id of result.removedUserIds) {
        if (!removedUserIds.includes(id)) {
          removedUserIds.push(id);
        }
      }

      this.accumulatedTime -= this.fixedDeltaTime;
      physicsUpdated = true;
    }

    // Only render if physics was updated (limits render rate to physics rate)
    if (!physicsUpdated) {
      return;
    }

    // Update camera manager (computes camera position/rotation from target, input, etc.)
    // Will be synced to renderer's camera in renderer.render()
    this.cameraManager.update();

    // Update TweakPane character data if visible (skip expensive operations when hidden)
    if (this.tweakPane.guiVisible && this.characterManager.localController) {
      this.tweakPane.updateCharacterData(this.characterManager.localController);
    }

    // Build render state - getAllCharacterStates() returns a cached Map
    const allCharacterStates = this.characterManager.getAllCharacterStates();

    // Read camera state after update
    const cameraState = this.cameraManager.getCameraState();
    const cameraRotation = new EulXYZ().setFromQuaternion(cameraState.rotation);
    this.cachedCameraTransform.position.set(
      cameraState.position.x,
      cameraState.position.y,
      cameraState.position.z,
    );
    this.cachedCameraTransform.rotation.x = cameraRotation.x;
    this.cachedCameraTransform.rotation.y = cameraRotation.y;
    this.cachedCameraTransform.rotation.z = cameraRotation.z;
    this.cachedCameraTransform.fov = cameraState.fov;

    const renderState: RenderState = {
      characters: allCharacterStates,
      updatedCharacterDescriptions,
      removedUserIds,
      cameraTransform: this.cachedCameraTransform,
      localCharacterId: this.characterManager.getLocalClientId(),
      deltaTimeSeconds: this.fixedDeltaTime,
    };

    // Render the actual frame using the associated renderer
    this.renderer.render(renderState);
  }

  private spawnCharacter({
    spawnPosition,
    spawnRotation,
    cameraPosition,
  }: {
    spawnPosition: Vect3;
    spawnRotation: EulXYZ;
    cameraPosition: Vect3;
  }) {
    if (this.clientId === null) {
      throw new Error("Client ID not set");
    }

    const ownIdentity = this.userProfiles.get(this.clientId);
    if (!ownIdentity) {
      throw new Error("Own identity not found");
    }

    this.characterManager.spawnLocalCharacter(this.clientId!, spawnPosition, spawnRotation);

    this.characterManager.setupTweakPane(this.tweakPane);

    if (cameraPosition !== null) {
      const cameraState = this.cameraManager.getMainCameraState();
      cameraState.position.set(cameraPosition.x, cameraPosition.y, cameraPosition.z);
      const target = new Vect3().add(spawnPosition).add(CharacterManager.headTargetOffset);
      this.cameraManager.setTarget(target);
      this.cameraManager.reverseUpdateFromPositions(cameraState.position, cameraState.rotation);
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
    this.textChatUI?.dispose();
    this.tweakPane.dispose();
    this.renderer.dispose();
    if (this.currentRequestAnimationFrame !== null) {
      cancelAnimationFrame(this.currentRequestAnimationFrame);
      this.currentRequestAnimationFrame = null;
    }
    this.cameraManager.dispose();
    this.loadingScreen.dispose();
    this.errorScreen?.dispose();
  }
}
