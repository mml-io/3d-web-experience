import {
  CameraManager,
  CollisionsManager,
  IRenderer,
  MMLDocumentConfiguration,
  RendererConfig,
  RenderState,
  TweakPane,
} from "@mml-io/3d-web-client-core";
import { LoadingProgressManager } from "@mml-io/mml-web";
import { AudioListener, Group, Scene, Vector3 } from "three";

import { ThreeJSCameraManager } from "./camera/ThreeJSCameraManager";
import { Character, LoadedAnimations } from "./character/Character";
import { CharacterModelLoader } from "./character/loading/CharacterModelLoader";
import { ThreeJSCharacterManager } from "./character/ThreeJSCharacterManager";
import { ThreeJSCollisionManager } from "./collisions/ThreeJSCollisionManager";
import { Composer } from "./composer";
import { GroundPlane } from "./ground-plane/GroundPlane";
import { ThreeJSMMLCompositionScene } from "./mml/ThreeJSMMLCompositionScene";
import { ThreeJSMMLManager } from "./mml/ThreeJSMMLManager";
import { ThreeJSTweakPaneFolders } from "./tweakpane/ThreeJSTweakPaneFolders";

export interface ThreeJSRendererOptions {
  targetElement: HTMLElement;
  coreCameraManager: CameraManager;
  collisionsManager: CollisionsManager;
  config: RendererConfig;
  tweakPane?: TweakPane | null;
  mmlTargetWindow: Window;
  mmlTargetElement: HTMLElement;
  loadingProgressManager: LoadingProgressManager | null;
  mmlDocuments: { [key: string]: MMLDocumentConfiguration };
  mmlAuthToken: string | null;
}

export class ThreeJSWorldRenderer implements IRenderer {
  private scene: Scene = new Scene();
  private composer: Composer;
  private audioListener = new AudioListener();
  private characterGroup: Group = new Group();
  private groundPlane: GroundPlane | null = null;
  private tweakPane: TweakPane | null = null;

  private characterModelLoader: CharacterModelLoader;
  private animationsPromise: Promise<LoadedAnimations>;
  private config: RendererConfig;
  private localCharacterId: number | null = null;

  public mmlCompositionScene: ThreeJSMMLCompositionScene;

  private threeJSCollisionManager: ThreeJSCollisionManager;
  private threeJSTweakPaneProvider: ThreeJSTweakPaneFolders | null = null;
  private threeJSCameraManager: ThreeJSCameraManager;
  private coreCameraManager: CameraManager;
  private loadingProgressManager: LoadingProgressManager | null = null;
  private targetElement: HTMLElement;
  private collisionsManager: CollisionsManager;
  private mmlTargetWindow: Window;
  private mmlTargetElement: HTMLElement;

  private characterManager: ThreeJSCharacterManager;
  private mmlManager: ThreeJSMMLManager;

  constructor({
    targetElement,
    coreCameraManager,
    collisionsManager,
    config,
    tweakPane = null,
    mmlTargetWindow,
    mmlTargetElement,
    loadingProgressManager,
    mmlDocuments,
    mmlAuthToken,
  }: ThreeJSRendererOptions) {
    this.targetElement = targetElement;
    this.coreCameraManager = coreCameraManager;
    this.collisionsManager = collisionsManager;
    this.tweakPane = tweakPane;
    this.config = config;
    this.mmlTargetWindow = mmlTargetWindow;
    this.mmlTargetElement = mmlTargetElement;
    this.loadingProgressManager = loadingProgressManager;
    this.animationsPromise = Character.loadAnimations(
      new CharacterModelLoader(),
      config.animationConfig,
    );
    this.characterModelLoader = new CharacterModelLoader();

    this.scene.add(this.audioListener);
    this.scene.add(this.characterGroup);

    this.threeJSCameraManager = new ThreeJSCameraManager(this.coreCameraManager);

    this.composer = new Composer({
      scene: this.scene,
      cameraManager: this.threeJSCameraManager,
      spawnSun: config.spawnSun ?? true,
      environmentConfiguration: config.environmentConfiguration,
      postProcessingEnabled: config.postProcessingEnabled,
    });

    // Create ThreeJSCollisionManager to handle Three.js-specific collision mesh processing
    this.threeJSCollisionManager = new ThreeJSCollisionManager(this.scene);

    // Set up collision debug visualization callback
    this.collisionsManager.onDebugChange = (enabled: boolean) => {
      this.threeJSCollisionManager.toggleDebugForAll(enabled);
    };

    // Initialize character manager
    this.characterManager = new ThreeJSCharacterManager(
      this.characterGroup,
      this.animationsPromise,
      this.characterModelLoader,
      this.threeJSCameraManager,
      this.composer,
    );

    // Initialize MML
    this.mmlCompositionScene = new ThreeJSMMLCompositionScene({
      targetElement: this.targetElement,
      scene: this.scene,
      camera: this.threeJSCameraManager.mainCamera,
      audioListener: this.audioListener,
      collisionsManager: this.collisionsManager,
      threeJSCollisionManager: this.threeJSCollisionManager,
      loadingProgressManager: this.loadingProgressManager,
      getUserPositionAndRotation: () => {
        // Return local character position/rotation
        const localCharData = this.characterManager.getLocalCharacterForMML(this.localCharacterId);
        if (localCharData) {
          return localCharData;
        }
        return {
          position: { x: 0, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
        };
      },
    });

    this.scene.add(this.mmlCompositionScene.group);

    // Initialize MML manager
    this.mmlManager = new ThreeJSMMLManager(
      this.mmlCompositionScene,
      this.mmlTargetWindow,
      this.mmlTargetElement,
      this.loadingProgressManager,
    );

    this.targetElement.appendChild(this.composer.renderer.domElement);

    // Setup audio context resume on user interaction
    document.addEventListener("mousedown", () => {
      if (this.audioListener.context.state === "suspended") {
        this.audioListener.context.resume();
      }
    });

    // Initialize ground plane if configured
    this.setGroundPlaneEnabled(this.config.environmentConfiguration?.groundPlane ?? true);

    // Setup tweakPane if provided (after initialization is complete)
    if (this.tweakPane) {
      this.setupTweakPane();
    }

    this.setMMLConfiguration(mmlDocuments, mmlAuthToken);
  }

  private setupTweakPane(): void {
    if (!this.tweakPane) {
      return;
    }

    // Create and setup the ThreeJS-specific provider
    this.threeJSTweakPaneProvider = new ThreeJSTweakPaneFolders(
      this.composer.renderer,
      this.scene,
      this.composer,
      this.collisionsManager,
      this.config.postProcessingEnabled,
    );

    this.threeJSTweakPaneProvider.registerFolders((this.tweakPane as any).gui);
    this.threeJSTweakPaneProvider.setupChangeHandlers();

    this.tweakPane.setupCamPane(this.coreCameraManager);
  }

  render(state: RenderState): void {
    const startFrameTimeMs = performance.now();

    // Update local character ID from render state
    this.localCharacterId = state.localCharacterId;

    const { removedUserIds, deltaTimeSeconds } = state;

    // Handle removed characters
    for (const characterId of removedUserIds) {
      this.characterManager.despawnCharacter(characterId);
    }

    // Update character manager (handles spawning, updating, LOD evaluation, etc.)
    this.characterManager.update(state, deltaTimeSeconds);

    // Update camera manager (syncs Three.js cameras with core state)
    this.threeJSCameraManager.update();

    // Update audio listener position
    this.updateAudioListenerPosition();

    // Render the frame
    const characterPosition = this.characterManager.getLocalCharacterPosition(
      this.localCharacterId,
    );
    this.composer.sun?.updateCharacterPosition(
      new Vector3(characterPosition?.x || 0, characterPosition?.y || 0, characterPosition?.z || 0),
    );
    this.composer.render();

    // End frame timing and update TweakPane if visible (skip expensive operations when hidden)
    if (this.threeJSTweakPaneProvider && this.tweakPane && this.tweakPane.guiVisible) {
      const endFrameTimeMs = performance.now();
      const frameRenderTimeMs = endFrameTimeMs - startFrameTimeMs;
      this.threeJSTweakPaneProvider.update(deltaTimeSeconds, frameRenderTimeMs);
      this.tweakPane.updateCameraData(this.coreCameraManager);
    }
  }

  private updateAudioListenerPosition(): void {
    const headPosition =
      this.localCharacterId !== null
        ? this.characterManager.getCharacterHeadPosition(this.localCharacterId)
        : null;

    this.audioListener.rotation.copy(this.threeJSCameraManager.mainCamera.rotation);

    if (headPosition) {
      this.audioListener.position.copy(headPosition);
    } else {
      this.audioListener.position.copy(this.threeJSCameraManager.mainCamera.position);
    }
    this.audioListener.updateMatrixWorld();
  }

  private setGroundPlaneEnabled(enabled: boolean): void {
    if (enabled && this.groundPlane === null) {
      this.groundPlane = new GroundPlane();
      const creationResult = this.threeJSCollisionManager.createCollisionMesh(this.groundPlane);
      this.collisionsManager.addMeshesGroup(this.groundPlane, creationResult);
      this.threeJSCollisionManager.updateDebugVisualization(
        this.collisionsManager.isDebugEnabled(),
        this.groundPlane,
        creationResult.meshBVH,
      );
      this.scene.add(this.groundPlane);
    } else if (!enabled && this.groundPlane !== null) {
      this.collisionsManager.removeMeshesGroup(this.groundPlane);
      this.threeJSCollisionManager.removeDebugVisualization(this.groundPlane);
      this.scene.remove(this.groundPlane);
      this.groundPlane = null;
    }
  }

  fitContainer(): void {
    this.composer.fitContainer();
  }

  dispose(): void {
    // Dispose character manager
    this.characterManager.dispose();

    // Dispose ground plane
    if (this.groundPlane) {
      this.collisionsManager.removeMeshesGroup(this.groundPlane);
      this.threeJSCollisionManager.removeDebugVisualization(this.groundPlane);
      this.scene.remove(this.groundPlane);
      this.groundPlane = null;
    }

    // Dispose TweakPane provider (TweakPane itself is managed by client)
    if (this.threeJSTweakPaneProvider) {
      this.threeJSTweakPaneProvider = null;
    }
    this.tweakPane = null;

    // Dispose collision debug visuals
    this.threeJSCollisionManager.clearAllDebugVisualizations();

    // Dispose MML manager
    this.mmlManager.dispose();

    // Dispose MML
    this.mmlCompositionScene.dispose();

    // Dispose camera manager
    this.threeJSCameraManager.dispose();

    // Dispose composer
    this.composer.dispose();
  }

  addChatBubble(characterId: number, message: string): void {
    this.characterManager.addChatBubble(characterId, message);
  }

  updateConfig(config: Partial<RendererConfig>): void {
    this.config = {
      ...this.config,
      ...config,
    };

    if (config.environmentConfiguration !== undefined) {
      this.composer.updateEnvironmentConfiguration(config.environmentConfiguration);
      this.setGroundPlaneEnabled(config.environmentConfiguration.groundPlane ?? true);
    }

    if (config.postProcessingEnabled !== undefined) {
      this.composer.togglePostProcessing(config.postProcessingEnabled);
    }

    if (config.enableTweakPane !== undefined && this.tweakPane) {
      this.tweakPane.setVisible(config.enableTweakPane);
    }
  }

  public setMMLConfiguration(
    mmlDocuments: { [key: string]: MMLDocumentConfiguration },
    authToken: string | null,
  ): void {
    this.mmlManager.setMMLConfiguration(mmlDocuments, authToken);
  }

  onChatMessage(message: string): void {
    this.mmlManager.onChatMessage(message);
  }
}
