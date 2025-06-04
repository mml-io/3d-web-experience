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
} from "@mml-io/3d-web-client-core";
import {
  ChatNetworkingClient,
  ChatNetworkingClientChatMessage,
  ChatNetworkingServerErrorType,
  StringToHslOptions,
  TextChatUI,
  TextChatUIProps,
} from "@mml-io/3d-web-text-chat";
import {
  USER_NETWORKING_AUTHENTICATION_FAILED_ERROR_TYPE,
  USER_NETWORKING_CONNECTION_LIMIT_REACHED_ERROR_TYPE,
  USER_NETWORKING_SERVER_SHUTDOWN_ERROR_TYPE,
  USER_NETWORKING_USER_UPDATE_MESSAGE_TYPE,
  UserData,
  UserNetworkingClient,
  UserNetworkingClientUpdate,
  UserNetworkingServerErrorType,
  WebsocketStatus,
} from "@mml-io/3d-web-user-networking";
import {
  IMMLScene,
  LoadingProgressManager,
  registerCustomElementsToWindow,
  setGlobalDocumentTimeManager,
  setGlobalMMLScene,
} from "@mml-io/mml-web";
import ammoWasmJs from "base64:./wasm/ammo.wasm.js";
import ammoWasmWasm from "base64:./wasm/ammo.wasm.wasm";
import dracoWasmJs from "base64:./wasm/draco.wasm.js";
import dracoWasmWasm from "base64:./wasm/draco.wasm.wasm";
import glslangWasmJs from "base64:./wasm/glslang.js";
import twgslWasmJs from "base64:./wasm/twgsl.js";
import * as playcanvas from "playcanvas";

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
  onServerBroadcast?: (broadcast: { broadcastType: string; payload: any }) => void;
  loadingScreen?: LoadingScreenConfig;
} & UpdatableConfig;

export type UpdatableConfig = {
  chatNetworkAddress?: string | null;
  mmlDocuments?: { [key: string]: MMLDocumentConfiguration };
  environmentConfiguration?: EnvironmentConfiguration;
  spawnConfiguration?: SpawnConfiguration;
  avatarConfiguration?: AvatarConfiguration;
  allowCustomDisplayName?: boolean;
  enableTweakPane?: boolean;
  allowOrbitalCamera?: boolean;
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

  private playcanvasApp: playcanvas.AppBase;
  private playcanvasScene: playcanvas.Scene;

  private canvas: HTMLCanvasElement;

  private composer: Composer;
  private tweakPane: TweakPane | null = null;

  private cameraManager: CameraManager;

  private collisionsManager: CollisionsManager;

  private characterModelLoader;
  private characterManager: CharacterManager;

  private timeManager = new TimeManager();

  private keyInputManager = new KeyInputManager();
  private virtualJoystick: VirtualJoystick;

  private mmlCompositionScene: MMLCompositionScene;
  private mmlFrames: { [key: string]: HTMLElement } = {};

  private clientId: number | null = null;
  private networkClient: UserNetworkingClient;
  private remoteUserStates = new Map<number, CharacterState>();
  private userProfiles = new Map<number, UserData>();

  private networkChat: ChatNetworkingClient | null = null;
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

  constructor(
    private holderElement: HTMLElement,
    private config: Networked3dWebExperienceClientConfig,
  ) {
    this.element = document.createElement("div");
    this.element.style.position = "absolute";
    this.element.style.width = "100%";
    this.element.style.height = "100%";
    this.holderElement.appendChild(this.element);

    this.canvas = document.createElement("canvas");
    this.canvas.style.pointerEvents = "none";

    this.canvasHolder = document.createElement("div");
    this.canvasHolder.style.position = "absolute";
    this.canvasHolder.style.width = "100%";
    this.canvasHolder.style.height = "100%";
    this.canvasHolder.appendChild(this.canvas);
    this.element.appendChild(this.canvasHolder);

    // TODO - report loading progress correctly
    this.init();
  }

  async init() {
    playcanvas.WasmModule.setConfig("Ammo", {
      glueUrl: "data:text/javascript;base64," + ammoWasmJs,
      wasmUrl: "data:application/octet-stream;base64," + ammoWasmWasm,
    });
    await new Promise<void>((resolve) => {
      playcanvas.WasmModule.getInstance("Ammo", () => resolve());
    });

    playcanvas.WasmModule.setConfig("DracoDecoderModule", {
      glueUrl: "data:text/javascript;base64," + dracoWasmJs,
      wasmUrl: "data:application/wasm;base64," + dracoWasmWasm,
    });

    this.canvas = document.createElement("canvas");
    this.canvas.style.pointerEvents = "none";
    this.element.appendChild(this.canvas);

    this.playcanvasApp = new playcanvas.AppBase(this.canvas);

    const gfxOptions = {
      deviceTypes: ["webgpu", "webgl2"],
      glslangUrl: "data:text/javascript;base64," + glslangWasmJs,
      twgslUrl: "data:text/javascript;base64," + twgslWasmJs,
      antialias: true,
    };

    const soundManager = new playcanvas.SoundManager();
    const device = await playcanvas.createGraphicsDevice(this.canvas, gfxOptions);
    device.maxPixelRatio = window.devicePixelRatio;
    const createOptions = new playcanvas.AppOptions();
    createOptions.soundManager = soundManager;
    createOptions.graphicsDevice = device;
    createOptions.componentSystems = [
      playcanvas.RenderComponentSystem,
      playcanvas.CollisionComponentSystem,
      playcanvas.RigidBodyComponentSystem,
      playcanvas.CameraComponentSystem,
      playcanvas.LightComponentSystem,
      playcanvas.ModelComponentSystem,
      playcanvas.AnimComponentSystem,
      playcanvas.SoundComponentSystem,
      playcanvas.AudioListenerComponentSystem,
    ];
    createOptions.resourceHandlers = [
      playcanvas.AudioHandler,
      playcanvas.TextureHandler,
      playcanvas.ContainerHandler,
      playcanvas.ModelHandler,
      playcanvas.AnimationHandler,
    ];
    window.playcanvasApp = this.playcanvasApp;
    this.playcanvasApp.init(createOptions);
    this.playcanvasScene = this.playcanvasApp.scene;
    this.playcanvasApp.scene.physicalUnits = true;
    this.playcanvasApp.setCanvasFillMode(playcanvas.FILLMODE_NONE);
    this.playcanvasApp.setCanvasResolution(playcanvas.RESOLUTION_FIXED);

    // Set the canvas size to non-zero to avoid errors on startup
    device.resizeCanvas(128, 128);

    // const camera = new playcanvas.Entity("camera", this.playcanvasApp);
    // camera.addComponent("audiolistener");
    // camera.addComponent("camera", {
    //   fov: 75,
    //   clearColor: new playcanvas.Color(1, 1, 1, 1),
    // } as playcanvas.CameraComponent);
    // camera.setPosition(0, 5, 10);
    // this.playcanvasApp.root.addChild(camera);

    const envMapAsset = new playcanvas.Asset("env-atlas", "texture", {
      url: this.config.environmentConfiguration.skybox.hdrUrl,
    });
    this.playcanvasApp.assets.add(envMapAsset);
    this.playcanvasApp.assets.load(envMapAsset);

    const onEnvMapAssetLoad = (texture: playcanvas.Texture) => {
      const skybox = playcanvas.EnvLighting.generateSkyboxCubemap(texture);
      const lighting = playcanvas.EnvLighting.generateLightingSource(texture);
      const envAtlas = playcanvas.EnvLighting.generateAtlas(lighting, {});
      lighting.destroy();
      this.playcanvasScene.envAtlas = envAtlas;
      this.playcanvasScene.skybox = skybox;
      this.playcanvasScene.skyboxLuminance = 10000;
    };

    if (envMapAsset.loaded) {
      onEnvMapAssetLoad(envMapAsset.resource);
    } else {
      envMapAsset.on("load", (envMapAsset: playcanvas.Asset) => {
        onEnvMapAssetLoad(envMapAsset.resource);
      });
    }

    this.playcanvasApp.start();

    this.collisionsManager = new CollisionsManager();

    device.resizeCanvas(128, 128);
    this.cameraManager = new CameraManager(
      this.playcanvasApp,
      this.canvasHolder,
      this.collisionsManager,
    );

    this.virtualJoystick = new VirtualJoystick(this.element, {
      radius: 70,
      innerRadius: 20,
      mouseSupport: false,
    });

    this.composer = new Composer({
      playcanvasApp: this.playcanvasApp,
      playcanvasScene: this.playcanvasApp.scene,
      cameraManager: this.cameraManager,
      spawnSun: true,
      environmentConfiguration: this.config.environmentConfiguration,
    });

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
      onServerError: (error: { message: string; errorType: UserNetworkingServerErrorType }) => {
        switch (error.errorType) {
          case USER_NETWORKING_AUTHENTICATION_FAILED_ERROR_TYPE:
            this.disposeWithError(error.message);
            break;
          case USER_NETWORKING_CONNECTION_LIMIT_REACHED_ERROR_TYPE:
            this.disposeWithError(error.message);
            break;
          case USER_NETWORKING_SERVER_SHUTDOWN_ERROR_TYPE:
            this.disposeWithError(error.message || "Server shutdown");
            break;
          default:
            console.error(`Unhandled server error: ${error.message}`);
            this.disposeWithError(error.message);
        }
      },
      onServerBroadcast: (broadcast: { broadcastType: string; payload: any }) => {
        this.config.onServerBroadcast?.(broadcast);
      },
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

    this.characterModelLoader = new CharacterModelLoader(this.playcanvasApp, false);

    this.characterManager = new CharacterManager(this.playcanvasApp, {
      composer: this.composer,
      characterModelLoader: this.characterModelLoader,
      collisionsManager: this.collisionsManager,
      cameraManager: this.cameraManager,
      timeManager: this.timeManager,
      keyInputManager: this.keyInputManager,
      virtualJoystick: this.virtualJoystick,
      remoteUserStates: this.remoteUserStates,
      sendUpdate: (characterState: CharacterState) => {
        this.latestCharacterObject.characterState = characterState;
        this.networkClient.sendUpdate(characterState);
      },
      animationConfig: this.config.animationConfig,
      spawnConfiguration: this.spawnConfiguration,
      characterResolve: (characterId: number) => {
        return this.resolveCharacterData(characterId);
      },
      updateURLLocation: this.config.updateURLLocation !== false,
    });

    this.setGroundPlaneEnabled(this.config.environmentConfiguration?.groundPlane ?? true);

    this.setupMMLScene();

    this.playcanvasApp.root.addChild(this.characterManager.group);

    if (this.spawnConfiguration.enableRespawnButton) {
      this.element.appendChild(this.characterManager.createRespawnButton());
    }
    //
    // this.loadingScreen = new LoadingScreen(this.loadingProgressManager, this.config.loadingScreen);
    // this.element.append(this.loadingScreen.element);
    //
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

        this.playcanvasApp.on("update", (delta) => {
          this.update();
        });

        this.setGroundPlaneEnabled(this.config.environmentConfiguration?.groundPlane ?? true);
      }
    });
    this.loadingProgressManager.setInitialLoad(true);
  }

  private setGroundPlaneEnabled(enabled: boolean) {
    if (enabled && this.groundPlane === null) {
      this.groundPlane = new GroundPlane(this.playcanvasApp);
      this.collisionsManager.addMeshesGroup(this.groundPlane);
      this.playcanvasApp.root.addChild(this.groundPlane);
    } else if (!enabled && this.groundPlane !== null) {
      this.collisionsManager.removeMeshesGroup(this.groundPlane);
      this.playcanvasApp.root.removeChild(this.groundPlane);
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

    if (config.chatNetworkAddress !== undefined) {
      if (config.chatNetworkAddress === null && this.networkChat !== null) {
        this.networkChat.stop();
        this.networkChat = null;
        this.textChatUI?.dispose();
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

    if (this.textChatUI && id === this.clientId) {
      this.textChatUI.setClientName(userData.username);
    }

    this.characterManager.respawnIfPresent(id);
  }

  private sendIdentityUpdateToServer(
    displayName: string,
    characterDescription: CharacterDescription,
  ) {
    if (!this.clientId) {
      throw new Error("Client ID not set");
    }

    this.networkClient.sendMessage({
      type: USER_NETWORKING_USER_UPDATE_MESSAGE_TYPE,
      userIdentity: {
        username: displayName,
        characterDescription: characterDescription,
      },
    });
  }

  private setupTweakPane() {
    if (this.tweakPane) {
      return;
    }
    this.tweakPane = new TweakPane(this.element, this.playcanvasApp, this.playcanvasScene);
    this.cameraManager.setupTweakPane(this.tweakPane);
    this.composer.setupTweakPane(this.tweakPane);
  }

  private connectToTextChat() {
    if (this.clientId === null) {
      return;
    }
    if (this.networkChat === null && this.config.chatNetworkAddress) {
      const user = this.userProfiles.get(this.clientId);
      if (!user) {
        throw new Error("User not found");
      }

      if (this.textChatUI === null) {
        const textChatUISettings: TextChatUIProps = {
          holderElement: this.element,
          clientname: user.username,
          sendMessageToServerMethod: (message: string) => {
            this.characterManager.addSelfChatBubble(message);

            this.mmlCompositionScene.onChatMessage(message);
            if (this.clientId === null || this.networkChat === null) return;
            this.networkChat.sendChatMessage(message);
          },
          visibleByDefault: this.config.chatVisibleByDefault,
          stringToHslOptions: this.config.userNameToColorOptions,
        };
        this.textChatUI = new TextChatUI(textChatUISettings);
        this.textChatUI.init();
      }

      this.networkChat = new ChatNetworkingClient({
        url: this.config.chatNetworkAddress,
        sessionToken: this.config.sessionToken,
        websocketFactory: (url: string) => new WebSocket(url),
        statusUpdateCallback: (status: WebsocketStatus) => {
          if (status === WebsocketStatus.Disconnected || status === WebsocketStatus.Reconnecting) {
            // The connection was lost after being established - the connection may be re-established with a different client ID
          }
        },
        clientChatUpdate: (
          clientId: number,
          chatNetworkingUpdate: null | ChatNetworkingClientChatMessage,
        ) => {
          if (chatNetworkingUpdate !== null && this.textChatUI !== null) {
            const username = this.userProfiles.get(clientId)?.username || "Unknown";
            this.textChatUI.addTextMessage(username, chatNetworkingUpdate.text);
            this.characterManager.addChatBubble(clientId, chatNetworkingUpdate.text);
          }
        },
        onServerError: (error: { message: string; errorType: ChatNetworkingServerErrorType }) => {
          console.error(`Chat server error: ${error.message}. errorType: ${error.errorType}`);
          this.disposeWithError(error.message);
        },
      });
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
      displayName: ownIdentity.username,
      characterDescription: ownIdentity.characterDescription,
      sendIdentityUpdateToServer: this.sendIdentityUpdateToServer.bind(this),
      availableAvatars: this.config.avatarConfiguration?.availableAvatars ?? [],
      allowCustomAvatars: this.config.avatarConfiguration?.allowCustomAvatars,
      allowCustomDisplayName: this.config.allowCustomDisplayName || false,
    });
    this.avatarSelectionUI.init();
  }

  public update(): void {
    if (!this.initialLoadCompleted) {
      return;
    }
    this.timeManager.update();
    this.characterManager.update();
    this.cameraManager.update();
    this.composer.sun?.updateCharacterPosition(
      this.characterManager.localCharacter?.getLocalPosition(),
    );
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
      ownIdentity.username,
      ownIdentity.characterDescription,
      spawnPosition,
      spawnRotation,
    );

    if (cameraPosition !== null) {
      this.cameraManager.camera.setLocalPosition(
        cameraPosition.x,
        cameraPosition.y,
        cameraPosition.z,
      );
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
    this.networkClient.stop();
    this.networkChat?.stop();
    for (const [key, element] of Object.entries(this.mmlFrames)) {
      element.remove();
    }
    this.mmlFrames = {};
    this.textChatUI?.dispose();
    this.mmlCompositionScene.dispose();
    this.composer.dispose();
    this.tweakPane?.dispose();
    this.playcanvasApp.destroy();
    this.cameraManager.dispose();
    this.loadingScreen.dispose();
    this.errorScreen?.dispose();
  }

  private setupMMLScene() {
    registerCustomElementsToWindow(window);
    this.mmlCompositionScene = new MMLCompositionScene({
      targetElement: this.element,
      playcanvasScene: this.playcanvasScene,
      playcanvasApp: this.playcanvasApp,
      camera: this.cameraManager.camera,
      collisionsManager: this.collisionsManager,
      getUserPositionAndRotation: () => {
        return this.characterManager.getLocalCharacterPositionAndRotation();
      },
    });
    this.playcanvasApp.root.addChild(this.mmlCompositionScene.group);
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
