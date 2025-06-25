import { PositionAndRotation, radToDeg } from "@mml-io/mml-web";
import { Color, Euler, Group, Object3D, Quaternion, SkinnedMesh, Vector3 } from "three";

import { CameraManager } from "../camera/CameraManager";
import { CollisionsManager } from "../collisions/CollisionsManager";
import { KeyInputManager } from "../input/KeyInputManager";
import { VirtualJoystick } from "../input/VirtualJoystick";
import { EulXYZ } from "../math/EulXYZ";
import { Quat } from "../math/Quat";
import { Vect3 } from "../math/Vect3";
import { Composer } from "../rendering/composer";
import { TimeManager } from "../time/TimeManager";
import { TweakPane } from "../tweakpane/TweakPane";

import { AnimationConfig, Character, CharacterDescription } from "./Character";
import { CharacterInstances } from "./CharacterInstances";
import { CharacterModelLoader } from "./CharacterModelLoader";
import { colorArrayToColors } from "./CharacterModel";
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
  composer: Composer;
  characterModelLoader: CharacterModelLoader;
  collisionsManager: CollisionsManager;
  cameraManager: CameraManager;
  timeManager: TimeManager;
  keyInputManager: KeyInputManager;
  virtualJoystick?: VirtualJoystick;
  remoteUserStates: Map<number, CharacterState>;
  sendUpdate: (update: CharacterState) => void;
  animationConfig: AnimationConfig;
  spawnConfiguration: SpawnConfigurationState;
  characterResolve: (clientId: number) => {
    username: string;
    characterDescription: CharacterDescription;
    colors: Array<[number, number, number]>;
  };
  updateURLLocation?: boolean;
};

export class CharacterManager {
  public readonly headTargetOffset = new Vect3(0, 1.3, 0);

  private localClientId: number = 0;

  public remoteCharacters: Map<number, Character> = new Map();
  public remoteCharacterControllers: Map<number, RemoteController> = new Map();

  private localCharacterSpawned: boolean = false;
  public localController: LocalController;
  public localCharacter: Character | null = null;
  public characterInstances: CharacterInstances | null = null;

  public readonly group: Group;
  private lastUpdateSentTime: number = 0;

  private readonly MAX_REAL_REMOTE_CHARACTERS = 1;
  private readonly CHARACTERS_TO_CHECK_PER_FRAME = 5;
  private readonly HYSTERESIS_DISTANCE_SQUARED = 25.0;
  private readonly SIGNIFICANT_MOVEMENT_SQUARED = 4.0;
  private readonly LOD_CHANGE_COOLDOWN_MS = 2000;

  private activeCharacters: Array<{
    id: number;
    lastPosition: { x: number; y: number; z: number };
    distanceSquared: number;
    isReal: boolean;
    dirty: boolean; // needs distance recalculation
    lastLODChange: number; // timestamp of last promotion/demotion
    loadingState?: 'loading' | 'loaded'; // track loading state for smooth transitions
  }> = [];

  private pendingSpawns = new Set<number>();
  private lodCheckIndex = 0;
  private lastLodCheck = 0;
  // Track characters that are loading to keep instances visible
  private loadingCharacters = new Set<number>();

  constructor(private config: CharacterManagerConfig) {
    this.group = new Group();
  }


  public spawnLocalCharacter(
    id: number,
    username: string,
    characterDescription: CharacterDescription,
    spawnPosition: Vect3 = new Vect3(),
    spawnRotation: EulXYZ = new EulXYZ(),
  ) {
    const character = new Character({
      username,
      characterDescription,
      animationConfig: this.config.animationConfig,
      characterModelLoader: this.config.characterModelLoader,
      characterId: id,
      modelLoadedCallback: () => {
        this.initializeCharacterInstances();
      },
      cameraManager: this.config.cameraManager,
      composer: this.config.composer,
      isLocal: true,
    });
    const quaternion = character.quaternion;
    this.config.sendUpdate({
      id: id,
      position: {
        x: spawnPosition.x,
        y: spawnPosition.y,
        z: spawnPosition.z,
      },
      rotation: { quaternionY: quaternion.y, quaternionW: quaternion.w },
      state: AnimationState.idle,
      colors: character.getColors(),
    });
    this.localClientId = id;
    this.localCharacter = character;
    this.localController = new LocalController({
      character: this.localCharacter,
      id: this.localClientId,
      collisionsManager: this.config.collisionsManager,
      keyInputManager: this.config.keyInputManager,
      virtualJoystick: this.config.virtualJoystick,
      cameraManager: this.config.cameraManager,
      timeManager: this.config.timeManager,
      spawnConfiguration: this.config.spawnConfiguration,
    });
    this.localCharacter.position.set(spawnPosition.x, spawnPosition.y, spawnPosition.z);
    const spawnQuat = new Quat().setFromEulerXYZ(spawnRotation);
    this.localCharacter.quaternion.set(spawnQuat.x, spawnQuat.y, spawnQuat.z, spawnQuat.w);
    this.group.add(character);
    this.localCharacterSpawned = true;
  }

  private calculateDistanceSquared(position: { x: number; y: number; z: number }): number {
    if (!this.localCharacter) return Number.MAX_VALUE;
    const localPos = this.localCharacter.position;
    const dx = position.x - localPos.x;
    const dy = position.y - localPos.y;
    const dz = position.z - localPos.z;
    return dx * dx + dy * dy + dz * dz;
  }

  private addActiveCharacter(
    id: number,
    position: { x: number; y: number; z: number },
    isReal: boolean,
  ): void {
    const existing = this.activeCharacters.find((c) => c.id === id);
    if (existing) return;

    this.activeCharacters.push({
      id,
      lastPosition: { ...position },
      distanceSquared: this.calculateDistanceSquared(position),
      isReal,
      dirty: false,
      lastLODChange: Date.now(),
    });
  }

  private removeActiveCharacter(id: number): void {
    const index = this.activeCharacters.findIndex((c) => c.id === id);
    if (index !== -1) {
      this.activeCharacters.splice(index, 1);
    }
  }

  private markCharacterDirty(id: number, newPosition: { x: number; y: number; z: number }): void {
    const char = this.activeCharacters.find((c) => c.id === id);
    if (!char) return;

    const dx = newPosition.x - char.lastPosition.x;
    const dy = newPosition.y - char.lastPosition.y;
    const dz = newPosition.z - char.lastPosition.z;
    const movementSquared = dx * dx + dy * dy + dz * dz;

    if (movementSquared > this.SIGNIFICANT_MOVEMENT_SQUARED) {
      char.dirty = true;
      char.lastPosition = { ...newPosition };
    }
  }

  private partialSort(characters: typeof this.activeCharacters, n: number): void {
    if (characters.length <= n) return;

    const quickSelect = (
      arr: typeof characters,
      k: number,
      start = 0,
      end = arr.length - 1,
    ): void => {
      if (start >= end) return;

      const pivotIndex = Math.floor((start + end) / 2);
      const pivotValue = arr[pivotIndex].distanceSquared;

      let left = start;
      const right = end;

      [arr[pivotIndex], arr[end]] = [arr[end], arr[pivotIndex]];

      for (let i = start; i < end; i++) {
        if (arr[i].distanceSquared < pivotValue) {
          [arr[i], arr[left]] = [arr[left], arr[i]];
          left++;
        }
      }

      [arr[left], arr[end]] = [arr[end], arr[left]];

      if (k < left) {
        quickSelect(arr, k, start, left - 1);
      } else if (k > left) {
        quickSelect(arr, k, left + 1, end);
      }
    };

    quickSelect(characters, n);
  }

  private evaluateLODWithBudget(): void {
    if (this.activeCharacters.length === 0) return;

    const charactersToProcess = Math.min(
      this.CHARACTERS_TO_CHECK_PER_FRAME,
      this.activeCharacters.length,
    );

    for (let i = 0; i < charactersToProcess; i++) {
      const charIndex = (this.lodCheckIndex + i) % this.activeCharacters.length;
      const char = this.activeCharacters[charIndex];

      if (char.dirty) {
        char.distanceSquared = this.calculateDistanceSquared(char.lastPosition);
        char.dirty = false;
      }
    }

    this.lodCheckIndex = (this.lodCheckIndex + charactersToProcess) % this.activeCharacters.length;

    if (this.lastLodCheck % 20 === 0) {
      this.performLODSwitch();

      if (this.lastLodCheck % 120 === 0) {
        const realCount = this.activeCharacters.filter((c) => c.isReal).length;
        const instanceCount = this.activeCharacters.filter((c) => !c.isReal).length;
        const pendingCount = this.pendingSpawns.size;

        const instanceInfo = this.characterInstances?.getInstanceInfo() || {
          active: 0,
          total: 0,
          available: 0,
        };

        console.log(
          `CharacterManager LOD Status: ${realCount} real, ${instanceCount} instances, ${pendingCount} pending (${this.activeCharacters.length + pendingCount} total) | Instance Pool: ${instanceInfo.active}/${instanceInfo.total} (${instanceInfo.available} available)`,
        );
      }
    }

    this.lastLodCheck++;
  }

  private performLODSwitch(): void {
    if (this.activeCharacters.length === 0) return;

    for (const char of this.activeCharacters) {
      if (char.dirty) {
        char.distanceSquared = this.calculateDistanceSquared(char.lastPosition);
        char.dirty = false;
      }
    }

    const sortedChars = [...this.activeCharacters];
    this.partialSort(sortedChars, this.MAX_REAL_REMOTE_CHARACTERS);

    const shouldBeReal = new Set<number>();

    for (let i = 0; i < Math.min(this.MAX_REAL_REMOTE_CHARACTERS, sortedChars.length); i++) {
      const char = sortedChars[i];
      shouldBeReal.add(char.id);

      if (char.isReal && i >= this.MAX_REAL_REMOTE_CHARACTERS) {
        const wouldBeDemotedDistance =
          sortedChars[this.MAX_REAL_REMOTE_CHARACTERS - 1]?.distanceSquared || 0;
        if (char.distanceSquared <= wouldBeDemotedDistance + this.HYSTERESIS_DISTANCE_SQUARED) {
          shouldBeReal.add(char.id);
        }
      }
    }

    const now = Date.now();
    for (const char of this.activeCharacters) {
      const shouldBe = shouldBeReal.has(char.id);

      if (char.isReal !== shouldBe) {
        const timeSinceLastChange = now - char.lastLODChange;
        if (timeSinceLastChange < this.LOD_CHANGE_COOLDOWN_MS) {
          continue;
        }

        if (shouldBe) {
          console.log(
            `CharacterManager: Promoting character ${char.id} to real character (distance: ${Math.sqrt(char.distanceSquared).toFixed(1)})`,
          );
          this.promoteToReal(char.id);
        } else {
          console.log(
            `CharacterManager: Demoting character ${char.id} to instance (distance: ${Math.sqrt(char.distanceSquared).toFixed(1)})`,
          );
          this.demoteToInstance(char.id);
        }
        char.isReal = shouldBe;
        char.lastLODChange = now;
      }
    }
  }

  private promoteToReal(id: number): void {
    console.log(`CharacterManager: Promoting character ${id} to real character`);
    const networkState = this.config.remoteUserStates.get(id);
    if (!networkState) {
      console.error(`CharacterManager: Cannot promote character ${id}: no network state`);
      return;
    }

    // Mark character as loading and update active character state
    this.loadingCharacters.add(id);
    const activeChar = this.activeCharacters.find((c) => c.id === id);
    if (activeChar) {
      activeChar.loadingState = 'loading';
    }

    const characterInfo = this.config.characterResolve(id);
    const position = new Vect3(
      networkState.position.x,
      networkState.position.y,
      networkState.position.z,
    );
    const euler = new Euler().setFromQuaternion(
      new Quaternion(0, networkState.rotation.quaternionY, 0, networkState.rotation.quaternionW),
    );
    const rotation = new EulXYZ(euler.x, euler.y, euler.z);

    // Spawn the real character with a callback to handle loading completion
    this.spawnRemoteCharacterWithLoadingCallback(
      id,
      characterInfo.username,
      characterInfo.characterDescription,
      position,
      rotation,
      networkState.state,
      () => {
        // Called when the real character has finished loading
        this.onRealCharacterLoaded(id);
      }
    );

    console.log(
      `CharacterManager: Started promoting character ${id} to real character with animation: ${AnimationState[networkState.state]}`,
    );
  }

  private onRealCharacterLoaded(id: number): void {
    // Mark as loaded
    this.loadingCharacters.delete(id);
    const activeChar = this.activeCharacters.find((c) => c.id === id);
    if (activeChar) {
      activeChar.loadingState = 'loaded';
    }

    // Now it's safe to remove the instance
    if (this.characterInstances) {
      this.characterInstances.despawnInstance(id);
      console.log(
        `CharacterManager: Removed character ${id} from instances after real character loaded (smooth transition)`,
      );
    }

    console.log(
      `CharacterManager: Successfully completed promotion of character ${id} to real character`,
    );
  }



  private demoteToInstance(id: number): void {
    const networkState = this.config.remoteUserStates.get(id);
    if (!networkState) return;

    this.loadingCharacters.delete(id);
    const activeChar = this.activeCharacters.find((c) => c.id === id);
    if (activeChar) {
      activeChar.loadingState = undefined;
    }

    const characterInfo = this.config.characterResolve(id);
    const colorsToUse = colorArrayToColors(characterInfo.colors);

    const character = this.remoteCharacters.get(id);
    if (character) {
      this.group.remove(character);
      this.remoteCharacters.delete(id);
      this.remoteCharacterControllers.delete(id);
      console.log(`CharacterManager: Removed real character ${id} from scene for demotion`);
    }

    if (this.characterInstances) {
      const position = new Vect3(
        networkState.position.x,
        networkState.position.y,
        networkState.position.z,
      );
      const euler = new Euler().setFromQuaternion(
        new Quaternion(0, networkState.rotation.quaternionY, 0, networkState.rotation.quaternionW),
      );
      const rotation = new EulXYZ(euler.x, euler.y, euler.z);

      const spawnSuccess = this.characterInstances.spawnInstanceWithCachedColors(
        id,
        colorsToUse,
        position,
        rotation,
        networkState.state, // pass current animation state
      );

      if (spawnSuccess) {
        console.log(
          `CharacterManager: Successfully demoted character ${id} to instance using colors`,
        );
      } else {
        console.error(
          `CharacterManager: Failed to demote character ${id} to instance - no capacity`,
        );
      }
    } else {
      console.warn(
        `CharacterManager: Could not demote character ${id} - CharacterInstances not available`,
      );
    }
  }

  public createRespawnButton(): HTMLDivElement {
    const respawnButton = document.createElement("div");
    respawnButton.className = "respawn-button";
    respawnButton.textContent = "RESPAWN";
    respawnButton.addEventListener("click", () => {
      this.localController.resetPosition();
    });
    respawnButton.style.position = "absolute";
    respawnButton.style.top = "14px";
    respawnButton.style.left = "8px";
    respawnButton.style.zIndex = "102";
    respawnButton.style.backgroundColor = "rgba(0, 0, 0, 0.7)";
    respawnButton.style.color = "#ffffff";
    respawnButton.style.borderRadius = "8px";
    respawnButton.style.border = "1px solid rgba(255, 255, 255, 0.21)";
    respawnButton.style.height = "22px";
    respawnButton.style.padding = "8px";
    respawnButton.style.cursor = "pointer";
    respawnButton.style.fontSize = "12px";
    respawnButton.style.fontFamily = "Helvetica, sans-serif";
    respawnButton.style.userSelect = "none";
    respawnButton.style.display = "flex";
    respawnButton.style.alignItems = "center";
    respawnButton.style.justifyContent = "center";
    return respawnButton;
  }

  public setupTweakPane(tweakPane: TweakPane) {
    tweakPane.setupCharacterController(this.localController);
  }

  private async initializeCharacterInstances() {
    try {
      if (!this.localCharacter) {
        console.error("no local character");
        return;
      }

      const mesh = this.localCharacter.getMesh();
      if (!mesh) {
        console.error("no mesh available from local character");
        return;
      }

      this.characterInstances = new CharacterInstances({
        mesh,
        animationConfig: this.config.animationConfig,
        characterModelLoader: this.config.characterModelLoader,
        cameraManager: this.config.cameraManager,
        timeManager: this.config.timeManager,
        instanceCount: 4096,
        spawnRadius: 50,
        debug: false,
      });

      const instancedMesh = await this.characterInstances.initialize();
      if (instancedMesh) {
        this.group.add(instancedMesh);
        this.characterInstances.setupFrustumCulling();
        console.log("character instances initialized");
      } else {
        console.error("failed to initialize character instances");
        this.characterInstances = null;
      }
    } catch (error) {
      console.error("error initializing instances:", error);
      this.characterInstances = null;
    }
  }

  public spawnRemoteCharacter(
    id: number,
    username: string,
    characterDescription: CharacterDescription,
    spawnPosition: Vect3 = new Vect3(),
    spawnRotation: EulXYZ = new EulXYZ(),
    initialAnimationState?: AnimationState,
  ) {
    this.spawnRemoteCharacterWithLoadingCallback(
      id,
      username,
      characterDescription,
      spawnPosition,
      spawnRotation,
      initialAnimationState,
      undefined // no loading callback for the basic method
    );
  }

  private spawnRemoteCharacterWithLoadingCallback(
    id: number,
    username: string,
    characterDescription: CharacterDescription,
    spawnPosition: Vect3 = new Vect3(),
    spawnRotation: EulXYZ = new EulXYZ(),
    initialAnimationState?: AnimationState,
    onLoaded?: () => void,
  ) {
    const character = new Character({
      username,
      characterDescription,
      animationConfig: this.config.animationConfig,
      characterModelLoader: this.config.characterModelLoader,
      characterId: id,
      modelLoadedCallback: () => {
        if (initialAnimationState !== undefined) {
          character.updateAnimation(initialAnimationState);
          console.log(
            `CharacterManager: Set character ${id} initial animation to: ${AnimationState[initialAnimationState]} (after model load)`,
          );
        }

        const networkState = this.config.remoteUserStates.get(id);
        const characterController = this.remoteCharacterControllers.get(id);
        if (networkState && characterController) {
          characterController.update(
            networkState,
            this.config.timeManager.time,
            this.config.timeManager.deltaTime,
          );
          console.log(
            `CharacterManager: Applied current network state to character ${id} (animation: ${AnimationState[networkState.state]})`,
          );
        }

        // Call the loading callback if provided
        if (onLoaded) {
          onLoaded();
        }
      },
      cameraManager: this.config.cameraManager,
      composer: this.config.composer,
      isLocal: false,
    });

    const spawnQuaternion = new Quat().setFromEulerXYZ(spawnRotation);

    this.remoteCharacters.set(id, character);
    character.position.set(spawnPosition.x, spawnPosition.y, spawnPosition.z);
    character.quaternion.set(
      spawnQuaternion.x,
      spawnQuaternion.y,
      spawnQuaternion.z,
      spawnQuaternion.w,
    );
    const remoteController = new RemoteController({ character, id });
    this.remoteCharacterControllers.set(id, remoteController);
    this.group.add(character);
  }

  public getLocalCharacterPositionAndRotation(): PositionAndRotation {
    if (this.localCharacter && this.localCharacter && this.localCharacter) {
      const rotation = this.localCharacter.rotation;
      return {
        position: this.localCharacter.position,
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
    for (const [id, character] of this.remoteCharacters) {
      this.group.remove(character);
      this.remoteCharacters.delete(id);
      this.remoteCharacterControllers.delete(id);
    }
    if (this.localCharacter) {
      this.group.remove(this.localCharacter);
      this.localCharacter = null;
    }
    if (this.characterInstances) {
      this.characterInstances.dispose();
      this.characterInstances = null;
    }

    this.activeCharacters.length = 0;
    this.pendingSpawns.clear();
    this.loadingCharacters.clear(); // Clean up loading state
    this.lodCheckIndex = 0;
    this.lastLodCheck = 0;
  }

  public addSelfChatBubble(message: string) {
    if (this.localCharacter) {
      this.localCharacter.addChatBubble(message);
    }
  }

  public addChatBubble(id: number, message: string) {
    this.remoteCharacters.get(id)?.addChatBubble(message);
  }

  public remoteCharacterInfoUpdated(id: number) {
    const characterInfo = this.config.characterResolve(id);
    const colors = colorArrayToColors(characterInfo.colors);

    if (this.localCharacter && this.localClientId == id) {
      this.localCharacter.updateCharacter(
        characterInfo.username,
        characterInfo.characterDescription,
      );
    }

    const remoteCharacter = this.remoteCharacters.get(id);
    if (remoteCharacter) {
      remoteCharacter.updateCharacter(characterInfo.username, characterInfo.characterDescription);
    }

    // If this character is currently an instance, update its colors
    const activeChar = this.activeCharacters.find((c) => c.id === id);
    if (activeChar && !activeChar.isReal && this.characterInstances) {
      const success = this.characterInstances.updateInstanceColors(id, colors);
      if (success) {
        console.log(`CharacterManager: Updated instance colors for character ${id}`);
      } else {
        console.warn(`CharacterManager: Failed to update instance colors for character ${id}`);
      }
    }
  }

  public update() {
    if (this.localCharacter) {
      this.localCharacter.update(this.config.timeManager.time, this.config.timeManager.deltaTime);

      this.localController.update();

      if (this.characterInstances) {
        this.characterInstances.update(
          this.config.timeManager.deltaTime,
          this.config.timeManager.time,
        );
      }

      const currentTime = new Date().getTime();
      const timeSinceLastUpdate = currentTime - this.lastUpdateSentTime;
      if (timeSinceLastUpdate > 30) {
        this.lastUpdateSentTime = currentTime;
        this.config.sendUpdate(this.localController.networkState);
      }

      const targetOffset = new Vect3();
      targetOffset
        .add(this.headTargetOffset)
        .applyQuat(
          new Quat(
            this.localCharacter.quaternion.x,
            this.localCharacter.quaternion.y,
            this.localCharacter.quaternion.z,
            this.localCharacter.quaternion.w,
          ),
        )
        .add(this.localCharacter.position);
      this.config.cameraManager.setTarget(targetOffset);

      for (const [id, update] of this.config.remoteUserStates) {
        if (id === this.localClientId) {
          continue;
        }

        const { position } = update;
        const currentPosition = { x: position.x, y: position.y, z: position.z };

        if (
          !this.activeCharacters.find((c) => c.id === id) &&
          !this.pendingSpawns.has(id) &&
          this.localCharacterSpawned === true
        ) {
          const realCharacterCount = this.activeCharacters.filter((c) => c.isReal).length;
          const instanceInfo = this.characterInstances?.getInstanceInfo() || {
            active: 0,
            total: 0,
            available: 0,
          };

          const shouldSpawnAsReal = realCharacterCount < this.MAX_REAL_REMOTE_CHARACTERS;
          const canSpawnAsInstance = instanceInfo.available > 0 && this.characterInstances;

          console.log(
            `CharacterManager: New character ${id}: realCount=${realCharacterCount}/${this.MAX_REAL_REMOTE_CHARACTERS}, shouldSpawnAsReal=${shouldSpawnAsReal}, instanceCapacity=${instanceInfo.available}/${instanceInfo.total}`,
          );

          if (!shouldSpawnAsReal && !canSpawnAsInstance) {
            console.error(
              `CharacterManager: Cannot spawn character ${id}: Real character limit reached and no instance capacity available`,
            );
            return;
          }

          this.pendingSpawns.add(id);

          if (shouldSpawnAsReal) {
            const characterInfo = this.config.characterResolve(id);
            this.spawnRemoteCharacter(
              id,
              characterInfo.username,
              characterInfo.characterDescription,
              new Vect3(position.x, position.y, position.z),
              new EulXYZ(),
              update.state,
            );
            console.log(
              `CharacterManager: Spawned character ${id} as real character (${realCharacterCount + 1}/${this.MAX_REAL_REMOTE_CHARACTERS})`,
            );

            this.pendingSpawns.delete(id);
            this.addActiveCharacter(id, currentPosition, shouldSpawnAsReal);
          } else {
            if (this.characterInstances) {
              const characterInfo = this.config.characterResolve(id);
              
              // Convert characterInfo colors to Map<string, Color> format
              const colorMap = colorArrayToColors(characterInfo.colors);

              const euler = new Euler().setFromQuaternion(
                new Quaternion(
                  0,
                  update.rotation.quaternionY,
                  0,
                  update.rotation.quaternionW,
                ),
              );
              const rotation = new EulXYZ(euler.x, euler.y, euler.z);

              const spawnSuccess = this.characterInstances.spawnInstanceWithCachedColors(
                id,
                colorMap,
                new Vect3(position.x, position.y, position.z),
                rotation,
                update.state,
              );

              if (spawnSuccess) {
                console.log(
                  `CharacterManager: Successfully spawned character ${id} as instance using characterInfo colors`,
                );
                this.pendingSpawns.delete(id);
                this.addActiveCharacter(id, currentPosition, false);
              } else {
                this.pendingSpawns.delete(id);
                console.error(
                  `CharacterManager: Failed to spawn instance for character ${id} - no available instances`,
                );
              }
            } else {
              this.pendingSpawns.delete(id);
              console.warn(
                `CharacterManager: Cannot spawn instance for character ${id} - CharacterInstances not ready, will retry`,
              );
            }
          }
        }

        this.markCharacterDirty(id, currentPosition);

        const activeChar = this.activeCharacters.find((c) => c.id === id);
        if (activeChar) {
          if (activeChar.isReal) {
            // Update real character
            const character = this.remoteCharacters.get(id);
            const characterController = this.remoteCharacterControllers.get(id);
            if (characterController) {
              characterController.update(
                update,
                this.config.timeManager.time,
                this.config.timeManager.deltaTime,
              );

              if (character && character.getCurrentAnimation() !== update.state) {
                character.updateAnimation(update.state);
                console.log(
                  `CharacterManager: Corrected animation for character ${id}: ${AnimationState[character.getCurrentAnimation()]} to ${AnimationState[update.state]}`,
                );
              }
            }
          } else {
            if (this.characterInstances) {
              const euler = new Euler().setFromQuaternion(
                new Quaternion(0, update.rotation.quaternionY, 0, update.rotation.quaternionW),
              );
              this.characterInstances.updateInstance(
                id,
                new Vect3(position.x, position.y, position.z),
                new EulXYZ(euler.x, euler.y, euler.z),
                update.state,
                true, // lerping
              );
            }
          }
        } else if (this.pendingSpawns.has(id)) {
          // "instance not found" errors during initialization
        }
      }

      for (const activeChar of [...this.activeCharacters]) {
        if (!this.config.remoteUserStates.has(activeChar.id)) {
          console.log(
            `CharacterManager: Cleaning up disconnected character ${activeChar.id} (was ${activeChar.isReal ? "real" : "instance"})`,
          );

          if (activeChar.isReal) {
            const character = this.remoteCharacters.get(activeChar.id);
            if (character) {
              this.group.remove(character);
              this.remoteCharacters.delete(activeChar.id);
              this.remoteCharacterControllers.delete(activeChar.id);
            }
          } else {
            if (this.characterInstances) {
              this.characterInstances.despawnInstance(activeChar.id);
            }
          }

          // Clean up loading state to prevent memory leaks
          this.loadingCharacters.delete(activeChar.id);
          this.removeActiveCharacter(activeChar.id);
        }
      }

      for (const pendingId of [...this.pendingSpawns]) {
        if (!this.config.remoteUserStates.has(pendingId)) {
          console.log(`CharacterManager: Cleaning up disconnected pending character ${pendingId}`);
          this.pendingSpawns.delete(pendingId);
          this.loadingCharacters.delete(pendingId); // Clean up loading state
        }
      }

      for (const [id, character] of this.remoteCharacters) {
        if (!this.config.remoteUserStates.has(id)) {
          console.log(`CharacterManager: Cleaning up orphaned real character ${id}`);
          this.group.remove(character);
          this.remoteCharacters.delete(id);
          this.remoteCharacterControllers.delete(id);
          this.loadingCharacters.delete(id); // Clean up loading state
        }
      }

      this.evaluateLODWithBudget();

      if (
        this.config.updateURLLocation &&
        this.config.timeManager.frame % 60 === 0 &&
        document.hasFocus() &&
        /*
         Don't update the URL if the camera is being controlled as some browsers (e.g. Chrome) cause a hitch to Pointer
         events when the url is updated
        */
        !this.config.cameraManager.hasActiveInput()
      ) {
        const hash = encodeCharacterAndCamera(
          this.localCharacter,
          this.config.cameraManager.camera,
        );
        const url = new URL(window.location.href);
        url.hash = hash;
        window.history.replaceState({}, "", url);
      }
    }
  }
}
