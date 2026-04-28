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
  normalizeSpawnConfiguration,
  Vect3,
  InputProvider,
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
import {
  experienceClientSubProtocols,
  type ServerBroadcastMessage,
} from "@mml-io/3d-web-experience-protocol";
import { ThreeJSWorldRenderer } from "@mml-io/3d-web-threejs";
import {
  UserData,
  UserNetworkingClientUpdate,
  NetworkUpdate,
} from "@mml-io/3d-web-user-networking";
import { LoadingProgressManager, registerCustomElementsToWindow } from "@mml-io/mml-web";

import { AvatarConfiguration } from "./AvatarType";
import { ClientEventEmitter } from "./ClientEventEmitter";
import { DefaultRespawnButtonPlugin } from "./DefaultRespawnButtonPlugin";
import { DefaultVirtualJoystickPlugin } from "./DefaultVirtualJoystickPlugin";
import type { UIPlugin } from "./plugins";
import { WorldConnection, type WorldEvent } from "./WorldConnection";

export type Networked3dWebExperienceClientConfig = {
  userNetworkAddress: string;
  sessionToken: string;
  animationConfig: AnimationConfig;
  voiceChatAddress?: string;
  updateURLLocation?: boolean;
  onServerBroadcast?: (broadcast: ServerBroadcastMessage) => void;
  loadingScreen?: LoadingScreenConfig;
  createRenderer?: (options: CreateRendererOptions) => IRenderer;
  waitForWorldConfig?: boolean;
  /** Virtual joystick for touch/mobile input. Defaults to built-in joystick. Pass `null` to disable. */
  virtualJoystickPlugin?: UIPlugin | null;
  /** Respawn button overlay. Defaults to built-in button. Pass `null` to disable. */
  respawnButtonPlugin?: UIPlugin | null;
  /**
   * Additional UI plugins mounted alongside the built-in plugins.
   * Use this to add arbitrary overlay UI (HUD, minimap, voice
   * controls, etc.) that participates in the standard plugin lifecycle.
   */
  plugins?: UIPlugin[];
  /**
   * When true, the underlying CharacterManager skips its remote-character
   * processing — the consumer's renderer wrapper (e.g. narwhal) is expected
   * to own the remote-character pipeline and read network state directly
   * via the wrapper's update path. The live `remoteUserStates` and
   * `localCharacterId` are forwarded to the renderer through `RenderState`
   * so the wrapper can drive its own pipeline. Default false.
   */
  skipRemoteCharacterUpdate?: boolean;
} & UpdatableConfig;

/**
 * The subset of the client config that can be updated at runtime, either via
 * `updateConfig()` or delivered from the server as the JSON payload of a
 * `FROM_SERVER_WORLD_CONFIG_MESSAGE_TYPE` message.
 *
 * The server-side equivalent is `WorldConfigPayload` from
 * `@mml-io/3d-web-experience-protocol`.
 */
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
  hud?:
    | false
    | {
        minimap?: boolean;
        playerList?: boolean;
        respawnButton?: boolean;
        [key: string]: boolean | undefined;
      };
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

export class Networked3dWebExperienceClient extends ClientEventEmitter {
  private element: HTMLDivElement;
  private canvasHolder: HTMLDivElement;

  private renderer: IRenderer;
  private rendererConfig: RendererConfig;

  private cameraManager: CameraManager;
  private collisionsManager: CollisionsManager;
  private characterManager: CharacterManager;
  private keyInputManager = new KeyInputManager();
  private resizeObserver: ResizeObserver;

  private connectionId: number | null = null;
  private worldConnection: WorldConnection;
  private remoteUserStates = new Map<number, UserNetworkingClientUpdate>();
  private userProfiles = new Map<number, UserData>();

  private virtualJoystickPlugin: UIPlugin | null;
  private respawnButtonPlugin: UIPlugin | null;
  private plugins: UIPlugin[];
  private tweakPane: TweakPane;

  private spawnConfiguration: SpawnConfigurationState;
  private cameraValues = createDefaultCameraValues();
  private characterControllerValues = createDefaultCharacterControllerValues();

  private initialLoadCompleted = false;
  private pendingChatMessages: {
    username: string;
    message: string;
    fromConnectionId: number;
    userId: string;
    isLocal: boolean;
  }[] = [];
  private latestConfig: Partial<UpdatableConfig> = {};
  private loadingProgressManager = new LoadingProgressManager();
  private loadingScreen: LoadingScreen;
  private errorScreen?: ErrorScreen;

  private mmlAuthToken: string | null = null;
  private rendererInitialized = false;
  private worldConfigReceived = false;
  private worldConfigTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private static readonly WORLD_CONFIG_TIMEOUT_MS = 10_000;
  private static readonly MAX_PENDING_CHAT_MESSAGES = 100;

  // Frame timing
  private currentRequestAnimationFrame: number | null = null;
  private lastUpdateTimeMs: number = 0;
  private frameCounter: number = 0;
  private readonly targetFPS: number = 60;
  private readonly fixedDeltaTime: number = 1 / this.targetFPS;
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
    super();
    this.virtualJoystickPlugin =
      config.virtualJoystickPlugin === null
        ? null
        : (config.virtualJoystickPlugin ?? new DefaultVirtualJoystickPlugin());
    this.respawnButtonPlugin =
      config.respawnButtonPlugin === null
        ? null
        : (config.respawnButtonPlugin ?? new DefaultRespawnButtonPlugin());
    this.plugins = config.plugins ?? [];
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
    if (!this.config.waitForWorldConfig) {
      this.loadingProgressManager.addLoadingAsset(initialNetworkLoadRef, "network", "network");
    }
    this.worldConnection = new WorldConnection({
      url: this.config.userNetworkAddress,
      sessionToken: this.config.sessionToken,
      websocketFactory: (url: string) => new WebSocket(url, [...experienceClientSubProtocols]),
      initialUserState: { userId: "", username: null, characterDescription: null, colors: null },
      initialPosition: spawnData.spawnPosition,
      initialRotation: { eulerY: 2 * Math.atan2(spawnRotation.y, spawnRotation.w) },
    });

    this.worldConnection.addEventListener((event: WorldEvent) => {
      switch (event.type) {
        case "disconnected":
        case "reconnecting":
          this.characterManager.clear();
          this.remoteUserStates.clear();
          this.connectionId = null;
          this.pendingChatMessages = [];
          break;

        case "identity_assigned":
          console.log(`Assigned ID: ${event.connectionId}`);
          this.connectionId = event.connectionId;
          // Set the local connection ID early to prevent the local character from being
          // spawned as a remote character when network updates arrive before loading completes
          this.characterManager.setLocalConnectionId(event.connectionId);
          if (this.initialLoadCompleted) {
            this.spawnCharacter(getSpawnData(this.spawnConfiguration, true));
          } else if (!this.config.waitForWorldConfig) {
            this.loadingProgressManager.completedLoadingAsset(initialNetworkLoadRef);
          }
          break;

        case "server_error":
          this.disposeWithError(event.message);
          break;

        case "session_config":
          if (event.config.authToken !== undefined) {
            this.mmlAuthToken = event.config.authToken;
            if (this.rendererInitialized && this.config.mmlDocuments) {
              this.renderer.setMMLConfiguration(this.config.mmlDocuments, this.mmlAuthToken);
            }
          }
          break;

        case "world_config": {
          if (this.worldConfigTimeoutId !== null) {
            clearTimeout(this.worldConfigTimeoutId);
            this.worldConfigTimeoutId = null;
          }
          const parsedConfig = event.config;
          // WorldConfigPayload types (environmentConfiguration,
          // spawnConfiguration, avatarConfiguration) are structurally
          // compatible with their client-core / experience-client
          // counterparts, so no casts are needed.
          const updatable: UpdatableConfig = {};
          if (parsedConfig.enableChat !== undefined) {
            updatable.enableChat = parsedConfig.enableChat;
          }
          if (parsedConfig.mmlDocuments !== undefined) {
            updatable.mmlDocuments = parsedConfig.mmlDocuments;
          }
          if (parsedConfig.environmentConfiguration !== undefined) {
            updatable.environmentConfiguration = parsedConfig.environmentConfiguration;
          }
          if (parsedConfig.spawnConfiguration !== undefined) {
            updatable.spawnConfiguration = parsedConfig.spawnConfiguration;
          }
          if (parsedConfig.avatarConfiguration !== undefined) {
            updatable.avatarConfiguration = parsedConfig.avatarConfiguration;
          }
          if (parsedConfig.allowCustomDisplayName !== undefined) {
            updatable.allowCustomDisplayName = parsedConfig.allowCustomDisplayName;
          }
          if (parsedConfig.enableTweakPane !== undefined) {
            updatable.enableTweakPane = parsedConfig.enableTweakPane;
          }
          if (parsedConfig.allowOrbitalCamera !== undefined) {
            updatable.allowOrbitalCamera = parsedConfig.allowOrbitalCamera;
          }
          if (parsedConfig.postProcessingEnabled !== undefined) {
            updatable.postProcessingEnabled = parsedConfig.postProcessingEnabled;
          }
          if (parsedConfig.hud !== undefined) {
            updatable.hud = parsedConfig.hud;
          }
          this.updateConfig(updatable);
          // Mark config as received regardless of parse success so the
          // client is not blocked indefinitely — it will use defaults.
          this.worldConfigReceived = true;
          this.checkReadyForInitialLoad();
          break;
        }

        case "server_broadcast":
          this.config.onServerBroadcast?.({
            broadcastType: event.broadcastType,
            payload: event.payload,
          });
          break;

        case "chat":
          this.handleChatMessage(
            event.message.fromConnectionId,
            event.message.userId,
            event.message.message,
          );
          break;

        case "network_update":
          this.onNetworkUpdate(event.update);
          break;
      }
    });

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
      remoteUserStates: this.remoteUserStates,
      sendUpdate: (characterState: CharacterState) => {
        this.worldConnection.sendUpdate(characterState);
      },
      sendLocalCharacterColors: (colors: Array<[number, number, number]>) => {
        this.worldConnection.updateColors(colors);
      },
      spawnConfiguration: this.spawnConfiguration,
      characterControllerValues: this.characterControllerValues,
      characterResolve: (connectionId: number) => {
        return this.resolveCharacterData(connectionId);
      },
      updateURLLocation: this.config.updateURLLocation !== false,
      skipRemoteCharacterUpdate: this.config.skipRemoteCharacterUpdate ?? false,
    });

    this.loadingScreen = new LoadingScreen(this.loadingProgressManager, this.config.loadingScreen);
    this.element.append(this.loadingScreen.element);

    this.loadingProgressManager.addProgressCallback(() => {
      const [, completed] = this.loadingProgressManager.toRatio();
      if (completed && !this.initialLoadCompleted) {
        this.initialLoadCompleted = true;
        if (this.connectionId === null || this.disposed) return;

        for (const plugin of this.getAllPlugins()) {
          plugin.mount(this.element, this);
        }

        // Deliver config to plugins after mount. If no world config has been
        // received yet, this delivers {} which lets plugins create with defaults.
        this.emit("configChanged", this.latestConfig);
        for (const plugin of this.getAllPlugins()) {
          plugin.onConfigChanged?.(this.latestConfig);
        }

        this.spawnCharacter(getSpawnData(this.spawnConfiguration, true));
        this.emit("ready");

        // Replay chat messages that arrived before plugins were mounted
        for (const chatEvent of this.pendingChatMessages) {
          this.emit("chat", chatEvent);
        }
        this.pendingChatMessages = [];
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

    const mmlDocumentsForRenderer = this.config.waitForWorldConfig
      ? {}
      : (this.config.mmlDocuments ?? {});

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
        mmlDocuments: mmlDocumentsForRenderer,
        mmlAuthToken: this.mmlAuthToken,
        onInitialized: () => {
          this.rendererInitialized = true;
          if (this.config.waitForWorldConfig) {
            this.checkReadyForInitialLoad();
          } else {
            this.loadingProgressManager.setInitialLoad(true);
          }
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
        mmlDocuments: mmlDocumentsForRenderer,
        mmlAuthToken: this.mmlAuthToken,
      });
      this.rendererInitialized = true;
      if (this.config.waitForWorldConfig) {
        this.checkReadyForInitialLoad();
      } else {
        this.loadingProgressManager.setInitialLoad(true);
      }
    }

    if (this.characterManager.localController) {
      this.characterManager.setupTweakPane(this.tweakPane);
    }

    this.resizeObserver = new ResizeObserver(() => {
      this.renderer.fitContainer();
    });
    this.resizeObserver.observe(this.element);

    // Populate initial latestConfig from constructor values so plugins
    // receive config even before any server world_config arrives.
    if (this.config.hud !== undefined) {
      this.latestConfig.hud = this.config.hud;
    }
    if (this.config.enableChat !== undefined) {
      this.latestConfig.enableChat = this.config.enableChat;
    }
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

    if (config.spawnConfiguration !== undefined) {
      this.spawnConfiguration = normalizeSpawnConfiguration(config.spawnConfiguration);
      if (this.characterManager.localController) {
        this.characterManager.localController.updateSpawnConfig(this.spawnConfiguration);
      }
    }

    if (config.mmlDocuments !== undefined) {
      this.renderer.setMMLConfiguration(config.mmlDocuments, this.mmlAuthToken);
    }

    this.latestConfig = { ...this.latestConfig, ...config };
    this.emit("configChanged", config);

    if (this.initialLoadCompleted) {
      for (const plugin of this.getAllPlugins()) {
        plugin.onConfigChanged?.(config);
      }
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

  private getAllPlugins(): UIPlugin[] {
    const result: UIPlugin[] = [];
    if (this.virtualJoystickPlugin) result.push(this.virtualJoystickPlugin);
    if (this.respawnButtonPlugin) result.push(this.respawnButtonPlugin);
    result.push(...this.plugins);
    return result;
  }

  private checkReadyForInitialLoad(): void {
    if (this.rendererInitialized && this.worldConfigReceived) {
      if (this.worldConfigTimeoutId !== null) {
        clearTimeout(this.worldConfigTimeoutId);
        this.worldConfigTimeoutId = null;
      }
      this.loadingProgressManager.setInitialLoad(true);
    } else if (this.rendererInitialized && !this.worldConfigReceived) {
      // Start a timeout so the client is not stuck indefinitely if the
      // server never sends a world config message.
      if (this.worldConfigTimeoutId === null) {
        this.worldConfigTimeoutId = setTimeout(() => {
          this.worldConfigTimeoutId = null;
          if (this.disposed) return;
          if (!this.worldConfigReceived) {
            console.warn(
              `World config not received within ${Networked3dWebExperienceClient.WORLD_CONFIG_TIMEOUT_MS}ms — proceeding with default configuration`,
            );
            this.worldConfigReceived = true;
            this.loadingProgressManager.setInitialLoad(true);
          }
        }, Networked3dWebExperienceClient.WORLD_CONFIG_TIMEOUT_MS);
      }
    }
  }

  // Cache the UserData wrapper per connectionId so the per-frame
  // CharacterManager.update path (which calls characterResolve once per
  // remote character per frame) doesn't allocate a new object literal each
  // call. With N remote characters at 60Hz this is N×60 allocations/sec
  // saved. Invalidates whenever any of the underlying user fields change.
  private resolvedCharacterCache = new Map<number, UserData>();

  private resolveCharacterData(connectionId: number): UserData {
    const user = this.userProfiles.get(connectionId);
    if (!user) {
      throw new Error(`Failed to resolve user for connectionId ${connectionId}`);
    }

    const cached = this.resolvedCharacterCache.get(connectionId);
    if (
      cached &&
      cached.userId === user.userId &&
      cached.username === user.username &&
      cached.characterDescription === user.characterDescription &&
      cached.colors === user.colors
    ) {
      return cached;
    }

    const fresh: UserData = {
      userId: user.userId,
      username: user.username,
      characterDescription: user.characterDescription,
      colors: user.colors,
    };
    this.resolvedCharacterCache.set(connectionId, fresh);
    return fresh;
  }

  private onNetworkUpdate(update: NetworkUpdate): void {
    const { removedConnectionIds, addedConnectionIds, updatedUsers } = update;
    for (const connId of removedConnectionIds) {
      const profile = this.userProfiles.get(connId);
      this.emit("userLeft", {
        connectionId: connId,
        userId: profile?.userId ?? "",
        username: profile?.username ?? null,
      });
      this.userProfiles.delete(connId);
      this.remoteUserStates.delete(connId);
      this.resolvedCharacterCache.delete(connId);
    }
    for (const [connId, userData] of addedConnectionIds) {
      this.userProfiles.set(connId, userData.userState);
      this.remoteUserStates.set(connId, userData.components);
      if (connId !== this.connectionId) {
        this.emit("userJoined", {
          connectionId: connId,
          userId: userData.userState.userId ?? "",
          username: userData.userState.username ?? null,
        });
      }
    }
    for (const [connId, userDataUpdate] of updatedUsers) {
      const userState = userDataUpdate.userState;
      if (userState) {
        const profile = this.userProfiles.get(connId);
        if (profile) {
          if (userState.userId !== undefined) {
            profile.userId = userState.userId;
          }
          if (userState.username !== undefined) {
            profile.username = userState.username;
          }
          if (userState.characterDescription !== undefined) {
            profile.characterDescription = userState.characterDescription;
          }
          if (userState.colors !== undefined) {
            profile.colors = userState.colors;
          }
          this.characterManager.networkCharacterInfoUpdated(connId);
        }
      }
      this.remoteUserStates.set(connId, userDataUpdate.components);
    }
  }

  private sendIdentityUpdateToServer(
    displayName: string,
    characterDescription: CharacterDescription,
  ) {
    if (this.connectionId === null) {
      throw new Error("Connection ID not set");
    }

    this.worldConnection.updateUsername(displayName);
    this.worldConnection.updateCharacterDescription(characterDescription);
  }

  private handleChatMessage(fromConnectionId: number, userId: string, message: string) {
    const isLocal = fromConnectionId === this.connectionId;
    let username = "System";

    if (fromConnectionId !== 0) {
      const user = this.userProfiles.get(fromConnectionId);
      // Use a fallback username if the profile hasn't synced yet (race between
      // chat messages arriving via custom messages and user profiles arriving
      // via delta-net state sync).
      username = user?.username ?? `User ${fromConnectionId}`;
      this.renderer.addChatBubble(fromConnectionId, message);
    }

    const chatEvent = { username, message, fromConnectionId, userId, isLocal };
    if (!this.initialLoadCompleted) {
      this.pendingChatMessages.push(chatEvent);
      if (
        this.pendingChatMessages.length > Networked3dWebExperienceClient.MAX_PENDING_CHAT_MESSAGES
      ) {
        this.pendingChatMessages.shift();
      }
      return;
    }
    this.emit("chat", chatEvent);
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
    const removedConnectionIds: number[] = [];

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
      for (const id of result.removedConnectionIds) {
        if (!removedConnectionIds.includes(id)) {
          removedConnectionIds.push(id);
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
      removedConnectionIds,
      cameraTransform: this.cachedCameraTransform,
      localCharacterId: this.characterManager.getLocalConnectionId(),
      deltaTimeSeconds: this.fixedDeltaTime,
      remoteUserStates: this.characterManager.getRemoteUserStates(),
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
    if (this.connectionId === null) {
      throw new Error("Connection ID not set");
    }

    const ownIdentity = this.userProfiles.get(this.connectionId);
    if (!ownIdentity) {
      throw new Error("Own identity not found");
    }

    this.characterManager.spawnLocalCharacter(this.connectionId, spawnPosition, spawnRotation);

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

  // ---------------------------------------------------------------------------
  // Public API — these methods allow wrapper code (e.g. the CLI client or
  // custom scripts) to inspect and interact with the running experience.
  // ---------------------------------------------------------------------------

  /**
   * Add a plugin at runtime. If the experience has already loaded, the plugin
   * is mounted immediately and receives the latest config. Otherwise it will
   * be mounted alongside the other plugins when loading completes.
   */
  public addPlugin(plugin: UIPlugin): void {
    this.plugins.push(plugin);
    if (this.initialLoadCompleted && !this.disposed) {
      plugin.mount(this.element, this);
      if (Object.keys(this.latestConfig).length > 0) {
        plugin.onConfigChanged?.(this.latestConfig);
      }
    }
  }

  /**
   * Remove a previously added plugin. Calls `dispose()` on the plugin if the
   * experience has already loaded (i.e. it was mounted).
   */
  public removePlugin(plugin: UIPlugin): void {
    const index = this.plugins.indexOf(plugin);
    if (index === -1) return;
    this.plugins.splice(index, 1);
    if (this.initialLoadCompleted) {
      plugin.dispose();
    }
  }

  /** Set an additional input provider (e.g. virtual joystick) for character control. */
  public setAdditionalInputProvider(inputProvider: InputProvider): void {
    this.characterManager.setAdditionalInputProvider(inputProvider);
  }

  /** Returns the current spawn configuration (position, respawn trigger, etc.). */
  public getSpawnConfiguration(): SpawnConfigurationState {
    return this.spawnConfiguration;
  }

  /** Returns the local client's connection ID, or null before authentication. */
  public getConnectionId(): number | null {
    return this.connectionId;
  }

  /** Returns position and username of the local character, or null if not yet spawned. */
  public getLocalCharacterState(): {
    connectionId: number;
    userId: string;
    position: { x: number; y: number; z: number };
    username: string;
  } | null {
    if (this.connectionId === null) return null;
    const localController = this.characterManager.localController;
    if (!localController) return null;
    const state = localController.networkState;
    const profile = this.userProfiles.get(this.connectionId);
    return {
      connectionId: this.connectionId,
      userId: profile?.userId ?? "",
      position: { x: state.position.x, y: state.position.y, z: state.position.z },
      username: profile?.username ?? "",
    };
  }

  /**
   * Returns all connected users (including local). Each entry contains
   * the user's connection ID, userId, position, and username.
   */
  public getCharacterStates(): Map<
    number,
    {
      connectionId: number;
      userId: string;
      position: { x: number; y: number; z: number };
      username: string;
      isLocal: boolean;
    }
  > {
    const result = new Map<
      number,
      {
        connectionId: number;
        userId: string;
        position: { x: number; y: number; z: number };
        username: string;
        isLocal: boolean;
      }
    >();

    // Local
    if (this.connectionId !== null) {
      const local = this.getLocalCharacterState();
      if (local) {
        result.set(this.connectionId, { ...local, isLocal: true });
      }
    }

    // Remote (skip local player — already added above with authoritative position)
    for (const [connId, update] of this.remoteUserStates) {
      if (connId === this.connectionId) continue;
      const profile = this.userProfiles.get(connId);
      result.set(connId, {
        connectionId: connId,
        userId: profile?.userId ?? "",
        position: {
          x: update.position?.x ?? 0,
          y: update.position?.y ?? 0,
          z: update.position?.z ?? 0,
        },
        username: profile?.username ?? "",
        isLocal: false,
      });
    }

    return result;
  }

  /** Update the character's avatar. */
  public selectAvatar(characterDescription: CharacterDescription): void {
    if (this.connectionId === null) return;
    const profile = this.userProfiles.get(this.connectionId);
    const displayName = profile?.username ?? "";
    this.sendIdentityUpdateToServer(displayName, characterDescription);
  }

  /** Update the character's display name. */
  public setDisplayName(name: string): void {
    if (this.connectionId === null) return;
    const profile = this.userProfiles.get(this.connectionId);
    if (!profile?.characterDescription) return;
    this.sendIdentityUpdateToServer(name, profile.characterDescription);
  }

  /** Respawn the local character at the configured spawn point. */
  public respawn(): void {
    this.characterManager.localController?.resetPosition();
  }

  /** Send a chat message. */
  public sendChatMessage(message: string): void {
    if (this.connectionId === null) return;

    // Show the message immediately in the local UI (same as the UI-initiated path)
    this.renderer.onChatMessage(message);

    this.worldConnection.sendChatMessage(message);
  }

  /** Access the underlying world connection. */
  public getWorldConnection(): WorldConnection {
    return this.worldConnection;
  }

  /** Access the renderer. */
  public getRenderer(): IRenderer {
    return this.renderer;
  }

  /** Access the character manager (local/remote character state, spawning). */
  public getCharacterManager(): CharacterManager {
    return this.characterManager;
  }

  /** Access the camera manager. */
  public getCameraManager(): CameraManager {
    return this.cameraManager;
  }

  /** Look up a user's profile (username, avatar, colors) by connection ID. */
  public getUserProfile(connectionId: number): UserData | null {
    return this.userProfiles.get(connectionId) ?? null;
  }

  /** Get all user profiles. */
  public getUserProfiles(): ReadonlyMap<number, UserData> {
    return this.userProfiles;
  }

  public dispose() {
    this.disposed = true;
    this.resizeObserver.disconnect();
    if (this.worldConfigTimeoutId !== null) {
      clearTimeout(this.worldConfigTimeoutId);
      this.worldConfigTimeoutId = null;
    }
    this.characterManager.dispose();
    this.worldConnection.stop();
    for (const plugin of this.getAllPlugins()) {
      plugin.dispose();
    }
    this.tweakPane.dispose();
    this.renderer.dispose();
    if (this.currentRequestAnimationFrame !== null) {
      cancelAnimationFrame(this.currentRequestAnimationFrame);
      this.currentRequestAnimationFrame = null;
    }
    this.cameraManager.dispose();
    this.loadingScreen.dispose();
    this.errorScreen?.dispose();
    this.emit("disposed");
    this.clearAllHandlers();
  }
}
