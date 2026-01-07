import { PositionAndRotation, radToDeg } from "@mml-io/mml-web";

import { CameraManager } from "../camera/CameraManager";
import { CollisionsManager } from "../collisions/CollisionsManager";
import { KeyInputManager } from "../input/KeyInputManager";
import { VirtualJoystick } from "../input/VirtualJoystick";
import { EulXYZ } from "../math/EulXYZ";
import { Quat } from "../math/Quat";
import { Vect3 } from "../math/Vect3";
import { CharacterRenderState, CharacterDescription } from "../rendering/IRenderer";
import { CharacterControllerValues } from "../tweakpane/blades/characterControlsFolder";
import { TweakPane } from "../tweakpane/TweakPane";

import { AnimationMixer } from "./AnimationMixer";
import { AnimationState, CharacterState } from "./CharacterState";
import { LocalController } from "./LocalController";
import { RemoteController } from "./RemoteController";
import { encodeCharacterAndCamera } from "./url-position";

type SpawnPosition = {
  x: number;
  y: number;
  z: number;
};

type SpawnPositionVariance = {
  x: number;
  y: number;
  z: number;
};

type RespawnTrigger = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
};

export type SpawnConfiguration = {
  spawnPosition?: Partial<SpawnPosition>;
  spawnPositionVariance?: Partial<SpawnPositionVariance>;
  spawnYRotation?: number;
  respawnTrigger?: Partial<RespawnTrigger>;
  enableRespawnButton?: boolean;
};

export type SpawnConfigurationState = {
  spawnPosition: SpawnPosition;
  spawnPositionVariance: SpawnPositionVariance;
  spawnYRotation: number;
  respawnTrigger: RespawnTrigger;
  enableRespawnButton: boolean;
};

export type CharacterManagerConfig = {
  collisionsManager: CollisionsManager;
  cameraManager: CameraManager;
  keyInputManager: KeyInputManager;
  virtualJoystick?: VirtualJoystick;
  remoteUserStates: Map<number, CharacterState>;
  sendUpdate: (update: CharacterState) => void;
  sendLocalCharacterColors: (colors: Array<[number, number, number]>) => void;
  spawnConfiguration: SpawnConfigurationState;
  characterControllerValues: CharacterControllerValues;
  characterResolve: (clientId: number) => {
    username: string | null;
    characterDescription: CharacterDescription | null;
    colors: Array<[number, number, number]> | null;
  };
  updateURLLocation?: boolean;
};

type RemoteCharacterState = {
  id: number;
  controller: RemoteController;
  animationMixer: AnimationMixer;
  lastUsername: string;
  lastCharacterDescription: CharacterDescription | null;
  lastColors: Array<[number, number, number]> | null;
  renderState: CharacterRenderState;
};

export class CharacterManager {
  public static readonly headTargetOffset = new Vect3(0, 1.75, 0);

  private localClientId: number = 0;
  public remoteCharacters: Map<number, RemoteCharacterState> = new Map();
  public localController: LocalController | null = null;
  private localRenderState: CharacterRenderState | null = null;
  private localAnimationMixer: AnimationMixer | null = null;

  private lastUpdateSentTime: number = 0;
  private tempCameraTarget = new Vect3();
  private cachedCharacterStates: Map<number, CharacterRenderState> = new Map();
  private pendingDescriptionUpdates: Set<number> = new Set();
  private pendingRemovals: Set<number> = new Set();

  constructor(private config: CharacterManagerConfig) {}

  /**
   * Sets the local client ID early to prevent the local character from being
   * spawned as a remote character when network updates arrive before spawnLocalCharacter is called.
   */
  public setLocalClientId(id: number): void {
    this.localClientId = id;
  }

  public spawnLocalCharacter(
    id: number,
    spawnPosition: Vect3 = new Vect3(),
    spawnRotation: EulXYZ = new EulXYZ(),
  ) {
    const position = new Vect3(spawnPosition.x, spawnPosition.y, spawnPosition.z);
    const quaternion = new Quat().setFromEulerXYZ(spawnRotation);

    this.config.sendUpdate({
      position: {
        x: spawnPosition.x,
        y: spawnPosition.y,
        z: spawnPosition.z,
      },
      rotation: { quaternionY: quaternion.y, quaternionW: quaternion.w },
      state: AnimationState.idle,
    });

    this.localClientId = id;
    this.localController = new LocalController({
      id: this.localClientId,
      position: position,
      quaternion: quaternion,
      collisionsManager: this.config.collisionsManager,
      keyInputManager: this.config.keyInputManager,
      virtualJoystick: this.config.virtualJoystick,
      cameraManager: this.config.cameraManager,
      spawnConfiguration: this.config.spawnConfiguration,
      characterControllerValues: this.config.characterControllerValues,
    });

    // Initialize cached renderState for local character
    const characterInfo = this.config.characterResolve(this.localClientId);
    const rotation = new EulXYZ().setFromQuaternion(quaternion);
    this.localAnimationMixer = new AnimationMixer(AnimationState.idle);
    this.localRenderState = {
      id: this.localClientId,
      position: new Vect3(position.x, position.y, position.z),
      rotation: rotation,
      animationState: AnimationState.idle,
      animationWeights: this.localAnimationMixer.getWeights(),
      animationTimes: this.localAnimationMixer.getAnimationTimes(),
      username: characterInfo.username ?? `Unknown User ${this.localClientId}`,
      characterDescription: characterInfo.characterDescription,
      colors: characterInfo.colors,
      isLocal: true,
    };
    this.cachedCharacterStates.set(this.localClientId, this.localRenderState);
  }

  public setupTweakPane(tweakPane: TweakPane) {
    if (this.localController) {
      tweakPane.setupCharacterController(this.localController);
    }
  }

  public getLocalCharacterPositionAndRotation(): PositionAndRotation {
    if (this.localController) {
      const rotation = this.localController.config.quaternion;
      return {
        position: this.localController.config.position,
        rotation: {
          x: radToDeg(rotation.x),
          y: radToDeg(rotation.y),
          z: radToDeg(rotation.z),
        },
      };
    }
    return {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
    };
  }

  public clear() {
    // Track all character IDs that need to be removed from the renderer
    for (const [id] of this.remoteCharacters) {
      this.pendingRemovals.add(id);
    }
    if (this.localClientId !== 0) {
      this.pendingRemovals.add(this.localClientId);
    }

    this.remoteCharacters.clear();
    this.cachedCharacterStates.clear();
    this.localRenderState = null;

    if (this.localController) {
      this.localController = null;
    }
  }

  public dispose() {
    this.clear();
    this.localController = null;
  }

  public networkCharacterInfoUpdated(id: number) {
    // Handle remote characters
    const remoteChar = this.remoteCharacters.get(id);
    if (remoteChar) {
      const characterInfo = this.config.characterResolve(id);
      const newUsername = characterInfo.username ?? `Unknown User ${id}`;

      // Check if description/colors changed BEFORE updating
      const descriptionChanged =
        remoteChar.lastUsername !== newUsername ||
        remoteChar.lastCharacterDescription !== characterInfo.characterDescription ||
        remoteChar.lastColors !== characterInfo.colors;

      remoteChar.lastUsername = newUsername;
      remoteChar.lastCharacterDescription = characterInfo.characterDescription;
      remoteChar.lastColors = characterInfo.colors;

      // Update cached renderState
      if (remoteChar.renderState) {
        remoteChar.renderState.username = remoteChar.lastUsername;
        remoteChar.renderState.characterDescription = remoteChar.lastCharacterDescription;
        remoteChar.renderState.colors = remoteChar.lastColors;
      }

      // Mark for description update in next update() call
      if (descriptionChanged) {
        this.pendingDescriptionUpdates.add(id);
      }
    }

    // Handle local character - update renderState if needed
    if (id === this.localClientId && this.localRenderState) {
      const characterInfo = this.config.characterResolve(id);
      const newUsername = characterInfo.username ?? `Unknown User ${id}`;

      // Check if description/colors changed BEFORE updating
      const descriptionChanged =
        this.localRenderState.username !== newUsername ||
        this.localRenderState.characterDescription !== characterInfo.characterDescription ||
        this.localRenderState.colors !== characterInfo.colors;

      // Update cached renderState
      this.localRenderState.username = newUsername;
      this.localRenderState.characterDescription = characterInfo.characterDescription;
      this.localRenderState.colors = characterInfo.colors;

      // Mark for description update in next update() call
      if (descriptionChanged) {
        this.pendingDescriptionUpdates.add(id);
      }
    }
  }

  public update(
    deltaTime: number,
    frameCounter: number,
  ): {
    updatedCharacterDescriptions: number[];
    removedUserIds: number[];
  } {
    const updatedCharacterDescriptions: number[] = [];
    const removedUserIds: number[] = [];

    // Process pending removals from clear()
    for (const id of this.pendingRemovals) {
      removedUserIds.push(id);
    }
    this.pendingRemovals.clear();

    // Process pending description updates from networkCharacterInfoUpdated
    for (const id of this.pendingDescriptionUpdates) {
      updatedCharacterDescriptions.push(id);
    }
    this.pendingDescriptionUpdates.clear();

    // Update local character renderState in-place
    if (this.localController && this.localRenderState && this.localAnimationMixer) {
      this.localController.update(deltaTime);

      // Mutate cached renderState in-place
      this.localRenderState.position.set(
        this.localController.config.position.x,
        this.localController.config.position.y,
        this.localController.config.position.z,
      );
      const quat = this.localController.config.quaternion;
      this.localRenderState.rotation.setFromQuaternion(new Quat(quat.x, quat.y, quat.z, quat.w));

      // Update animation mixer with target state
      const targetAnimation = this.localController.getTargetAnimation();
      this.localAnimationMixer.setTargetState(targetAnimation);
      this.localAnimationMixer.update(deltaTime);

      this.localRenderState.animationState = this.localAnimationMixer.getPrimaryState();
      this.localRenderState.animationWeights = this.localAnimationMixer.getWeights();
      this.localRenderState.animationTimes = this.localAnimationMixer.getAnimationTimes();

      // Check if description changed
      const characterInfo = this.config.characterResolve(this.localClientId);
      const newUsername = characterInfo.username ?? `Unknown User ${this.localClientId}`;
      if (
        this.localRenderState.username !== newUsername ||
        this.localRenderState.characterDescription !== characterInfo.characterDescription ||
        this.localRenderState.colors !== characterInfo.colors
      ) {
        this.localRenderState.username = newUsername;
        this.localRenderState.characterDescription = characterInfo.characterDescription;
        this.localRenderState.colors = characterInfo.colors;
        updatedCharacterDescriptions.push(this.localClientId);
      }

      const currentTime = new Date().getTime();
      const timeSinceLastUpdate = currentTime - this.lastUpdateSentTime;
      if (timeSinceLastUpdate > 30) {
        this.lastUpdateSentTime = currentTime;
        this.config.sendUpdate(this.localController.networkState);
      }

      const targetOffset = this.tempCameraTarget
        .set(0, 0, 0)
        .add(CharacterManager.headTargetOffset)
        .applyQuat(this.localController.config.quaternion)
        .add(this.localController.config.position);
      this.config.cameraManager.setTarget(targetOffset);

      if (
        this.config.updateURLLocation &&
        frameCounter % 60 === 0 &&
        document.hasFocus() &&
        !this.config.cameraManager.hasActiveInput() &&
        !this.localController.isOnMovingSurface()
      ) {
        const cameraState = this.config.cameraManager.getCameraState();
        const cameraRotation = new EulXYZ().setFromQuaternion(cameraState.rotation);
        const hash = encodeCharacterAndCamera(
          {
            position: this.localController.config.position,
            rotation: new EulXYZ().setFromQuaternion(this.localController.config.quaternion),
          },
          {
            position: cameraState.position,
            rotation: cameraRotation,
          },
        );
        const url = new URL(window.location.href);
        url.hash = hash;
        window.history.replaceState({}, "", url);
      }
    }

    // Process remote characters
    for (const [id, networkUpdate] of this.config.remoteUserStates) {
      if (id === this.localClientId) {
        continue;
      }

      let existingCharacter = this.remoteCharacters.get(id);
      if (!existingCharacter) {
        // Spawn new remote character with a RemoteController
        const { position } = networkUpdate;
        const initialRotation = new EulXYZ().setFromQuaternion(
          new Quat(0, networkUpdate.rotation.quaternionY, 0, networkUpdate.rotation.quaternionW),
        );

        const characterInfo = this.config.characterResolve(id);
        const controller = new RemoteController(
          new Vect3(position.x, position.y, position.z),
          initialRotation,
          networkUpdate.state,
        );
        const animationMixer = new AnimationMixer(networkUpdate.state);

        // Initialize cached renderState
        const cachedRotation = new EulXYZ();
        cachedRotation.setFromQuaternion(controller.rotation);
        const renderState: CharacterRenderState = {
          id,
          position: new Vect3(controller.position.x, controller.position.y, controller.position.z),
          rotation: cachedRotation,
          animationState: controller.animationState,
          animationWeights: animationMixer.getWeights(),
          animationTimes: animationMixer.getAnimationTimes(),
          username: characterInfo.username ?? `Unknown User ${id}`,
          characterDescription: characterInfo.characterDescription,
          colors: characterInfo.colors,
          isLocal: false,
        };

        existingCharacter = {
          id,
          controller,
          animationMixer,
          lastUsername: renderState.username,
          lastCharacterDescription: renderState.characterDescription,
          lastColors: renderState.colors,
          renderState,
        };
        this.remoteCharacters.set(id, existingCharacter);
        this.cachedCharacterStates.set(id, renderState);
      } else {
        // Update existing character's controller with network state
        existingCharacter.controller.update(networkUpdate, deltaTime);

        // Update animation mixer
        existingCharacter.animationMixer.setTargetState(
          existingCharacter.controller.animationState,
        );
        existingCharacter.animationMixer.update(deltaTime);

        // Mutate cached renderState in-place
        existingCharacter.renderState.position.set(
          existingCharacter.controller.position.x,
          existingCharacter.controller.position.y,
          existingCharacter.controller.position.z,
        );
        existingCharacter.renderState.rotation.setFromQuaternion(
          existingCharacter.controller.rotation,
        );
        existingCharacter.renderState.animationState =
          existingCharacter.animationMixer.getPrimaryState();
        existingCharacter.renderState.animationWeights =
          existingCharacter.animationMixer.getWeights();
        existingCharacter.renderState.animationTimes =
          existingCharacter.animationMixer.getAnimationTimes();

        // Check if description changed
        const characterInfo = this.config.characterResolve(id);
        const newUsername = characterInfo.username ?? `Unknown User ${id}`;
        if (
          existingCharacter.lastUsername !== newUsername ||
          existingCharacter.lastCharacterDescription !== characterInfo.characterDescription ||
          existingCharacter.lastColors !== characterInfo.colors
        ) {
          existingCharacter.lastUsername = newUsername;
          existingCharacter.lastCharacterDescription = characterInfo.characterDescription;
          existingCharacter.lastColors = characterInfo.colors;
          existingCharacter.renderState.username = newUsername;
          existingCharacter.renderState.characterDescription = characterInfo.characterDescription;
          existingCharacter.renderState.colors = characterInfo.colors;
          updatedCharacterDescriptions.push(id);
        }
      }
    }

    // Find despawned characters
    for (const [id] of this.remoteCharacters) {
      if (!this.config.remoteUserStates.has(id)) {
        removedUserIds.push(id);
        this.remoteCharacters.delete(id);
        this.cachedCharacterStates.delete(id);
      }
    }

    return {
      updatedCharacterDescriptions,
      removedUserIds,
    };
  }

  public getAllCharacterStates(): Map<number, CharacterRenderState> {
    // Return the cached Map directly - all objects are mutated in-place by update()
    return this.cachedCharacterStates;
  }

  public getLocalClientId(): number {
    return this.localClientId;
  }
}
