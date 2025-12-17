import {
  AnimationConfig,
  CameraManager,
  CameraTransform,
  CharacterDescription,
  CharacterManager,
  CharacterState,
  CollisionsManager,
  EulXYZ,
  IRenderer,
  KeyInputManager,
  RenderState,
  RendererConfig,
  SpawnConfigurationState,
  Vect3,
  createDefaultCharacterControllerValues,
} from "@mml-io/3d-web-client-core";
import { ThreeJSWorldRenderer } from "@mml-io/3d-web-threejs";
import { LoadingProgressManager } from "@mml-io/mml-web";
import { MMLWebRunnerClient } from "@mml-io/mml-web-runner";
import { EditableNetworkedDOM, NetworkedDOM } from "@mml-io/networked-dom-document";

import hdrJpgUrl from "../../../assets/hdr/puresky_2k.jpg";
import airAnimationFileUrl from "../../../assets/models/anim_air.glb";
import doubleJumpAnimationFileUrl from "../../../assets/models/anim_double_jump.glb";
import idleAnimationFileUrl from "../../../assets/models/anim_idle.glb";
import jogAnimationFileUrl from "../../../assets/models/anim_jog.glb";
import sprintAnimationFileUrl from "../../../assets/models/anim_run.glb";
import defaultAvatarMeshFileUrl from "../../../assets/models/bot.glb";

import { LocalAvatarServer } from "./LocalAvatarServer";

const animationConfig: AnimationConfig = {
  airAnimationFileUrl,
  idleAnimationFileUrl,
  jogAnimationFileUrl,
  sprintAnimationFileUrl,
  doubleJumpAnimationFileUrl,
};

// Specify the avatar to use here:
const characterDescription: CharacterDescription = {
  // Option 1 (Default) - Use a GLB file directly
  meshFileUrl: defaultAvatarMeshFileUrl, // This is just an address of a GLB file
  // Option 2 - Use an MML Character from a URL
  // mmlCharacterUrl: "https://...",
  // Option 3 - Use an MML Character from a string
  // mmlCharacterString: `<m-character src="https://..."></m-character>`,
};

export class LocalAvatarClient {
  public element: HTMLDivElement;
  private canvasHolder: HTMLDivElement;

  private renderer: IRenderer;
  private rendererConfig: RendererConfig;
  private readonly keyInputManager = new KeyInputManager(() => {
    return this.cameraManager.hasActiveInput();
  });
  private readonly characterManager: CharacterManager;
  private readonly cameraManager: CameraManager;

  private readonly collisionsManager = new CollisionsManager();
  private readonly remoteUserStates = new Map<number, CharacterState>();

  private resizeObserver: ResizeObserver;
  private documentRunnerClients = new Set<MMLWebRunnerClient>();
  private animationFrameRequest: number | null = null;

  private spawnConfiguration: SpawnConfigurationState;
  private cachedCameraTransform: CameraTransform = {
    position: new Vect3(),
    rotation: { x: 0, y: 0, z: 0 },
    fov: 0,
  };
  private lastUpdateTimeMs: number = 0;
  private frameCounter: number = 0;

  constructor(
    private localAvatarServer: LocalAvatarServer,
    private localClientId: number,
    spawnConfiguration: SpawnConfigurationState,
    mmlTargetWindow: Window,
    mmlTargetElement: HTMLElement,
  ) {
    this.element = document.createElement("div");
    this.element.style.position = "absolute";
    this.element.style.width = "100%";
    this.element.style.height = "100%";

    this.canvasHolder = document.createElement("div");
    this.canvasHolder.style.position = "absolute";
    this.canvasHolder.style.width = "100%";
    this.canvasHolder.style.height = "100%";
    this.element.appendChild(this.canvasHolder);

    this.cameraManager = new CameraManager(
      this.canvasHolder,
      this.collisionsManager,
      Math.PI / 2,
      Math.PI / 2,
    );

    this.rendererConfig = {
      animationConfig,
      environmentConfiguration: {
        skybox: {
          hdrJpgUrl,
        },
      },
      postProcessingEnabled: false,
      spawnSun: true,
      enableTweakPane: false,
    };

    this.renderer = new ThreeJSWorldRenderer({
      targetElement: this.canvasHolder,
      coreCameraManager: this.cameraManager,
      collisionsManager: this.collisionsManager,
      config: this.rendererConfig,
      tweakPane: null,
      mmlTargetWindow,
      mmlTargetElement,
      loadingProgressManager: new LoadingProgressManager(),
      mmlDocuments: {},
      mmlAuthToken: null,
    });

    this.resizeObserver = new ResizeObserver(() => {
      this.renderer.fitContainer();
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

    this.spawnConfiguration = {
      spawnPosition: {
        x: spawnConfiguration?.spawnPosition?.x ?? 0,
        y: spawnConfiguration?.spawnPosition?.y ?? 0,
        z: spawnConfiguration?.spawnPosition?.z ?? 0,
      },
      spawnPositionVariance: {
        x: spawnConfiguration?.spawnPositionVariance?.x ?? 0,
        y: spawnConfiguration?.spawnPositionVariance?.y ?? 0,
        z: spawnConfiguration?.spawnPositionVariance?.z ?? 0,
      },
      spawnYRotation: spawnConfiguration?.spawnYRotation ?? 0,
      respawnTrigger: {
        minX: spawnConfiguration?.respawnTrigger?.minX,
        maxX: spawnConfiguration?.respawnTrigger?.maxX,
        minY: spawnConfiguration?.respawnTrigger?.minY ?? -100,
        maxY: spawnConfiguration?.respawnTrigger?.maxY,
        minZ: spawnConfiguration?.respawnTrigger?.minZ,
        maxZ: spawnConfiguration?.respawnTrigger?.maxZ,
      },
      enableRespawnButton: spawnConfiguration?.enableRespawnButton ?? false,
    };

    this.characterManager = new CharacterManager({
      collisionsManager: this.collisionsManager,
      cameraManager: this.cameraManager,
      keyInputManager: this.keyInputManager,
      remoteUserStates: this.remoteUserStates,
      sendUpdate: (characterState: CharacterState) => {
        localAvatarServer.send(localClientId, characterState);
      },
      sendLocalCharacterColors: () => {
        // no-op
      },
      characterResolve: () => {
        return { username: "User", characterDescription, colors: [] };
      },
      spawnConfiguration: this.spawnConfiguration,
      characterControllerValues: createDefaultCharacterControllerValues(),
    });

    const spawnPosition = new Vect3(
      this.spawnConfiguration.spawnPosition!.x,
      this.spawnConfiguration.spawnPosition!.y,
      this.spawnConfiguration.spawnPosition!.z,
    );
    const spawnRotation = new EulXYZ(
      0,
      this.spawnConfiguration.spawnYRotation! * (Math.PI / 180),
      0,
    );
    this.characterManager.spawnLocalCharacter(localClientId, spawnPosition, spawnRotation);

    let cameraPosition: Vect3 | null = null;
    const offset = new Vect3(0, 0, 3.3);
    offset.applyEulerXYZ(new EulXYZ(0, spawnRotation.y, 0));
    cameraPosition = spawnPosition.clone().sub(offset).add(CharacterManager.headTargetOffset);

    if (cameraPosition !== null) {
      const cameraState = this.cameraManager.getMainCameraState();
      cameraState.position.set(cameraPosition.x, cameraPosition.y, cameraPosition.z);
      this.cameraManager.setTarget(
        new Vect3().add(spawnPosition).add(CharacterManager.headTargetOffset),
      );
      this.cameraManager.reverseUpdateFromPositions(cameraState.position, cameraState.rotation);
    }
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
    this.characterManager.dispose();
    this.cameraManager.dispose();
    this.renderer.dispose();
    this.element.remove();
  }

  public update(): void {
    const currentTimeMs = performance.now();
    const elapsedMs = currentTimeMs - this.lastUpdateTimeMs;
    this.lastUpdateTimeMs = currentTimeMs;

    let deltaTimeSeconds = elapsedMs / 1000;
    if (deltaTimeSeconds > 0.1) {
      deltaTimeSeconds = 0.1;
    }
    this.frameCounter++;

    // Update character manager and get state updates (may update camera target)
    const { updatedCharacterDescriptions, removedUserIds } = this.characterManager.update(
      deltaTimeSeconds,
      this.frameCounter,
    );

    // Update camera manager (computes camera position/rotation from target, input, etc.)
    // Will be synced to Three.js cameras in renderer.render() via ThreeJSCameraManager
    this.cameraManager.update();

    // Build render state - getAllCharacterStates() returns the cached Map directly
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
      deltaTimeSeconds: deltaTimeSeconds,
    };

    // Render frame
    this.renderer.render(renderState);

    this.animationFrameRequest = requestAnimationFrame(() => {
      this.update();
    });
  }

  public async addDocument(
    mmlDocument: NetworkedDOM | EditableNetworkedDOM,
    windowTarget: Window,
    remoteHolderElement: HTMLElement,
  ) {
    // Connect MML document using the shared iframe context
    // Both windowTarget and remoteHolderElement are from the shared iframe document
    // The MML scene's targetElement is also in the iframe document, so everything is consistent
    const mmlWebRunnerClient = new MMLWebRunnerClient(
      windowTarget,
      remoteHolderElement,
      (this.renderer as ThreeJSWorldRenderer).mmlCompositionScene!.mmlScene,
    );
    mmlWebRunnerClient.connect(mmlDocument);
    this.documentRunnerClients.add(mmlWebRunnerClient);
  }
}
