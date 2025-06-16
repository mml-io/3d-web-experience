import { PositionAndRotation } from "@mml-io/mml-web";
import { Group } from "three";

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
        instanceCount: 700,
        spawnRadius: 20,
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
  ) {
    const character = new Character({
      username,
      characterDescription,
      animationConfig: this.config.animationConfig,
      characterModelLoader: this.config.characterModelLoader,
      characterId: id,
      modelLoadedCallback: () => {
        // character loaded callback
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
      return {
        position: this.localCharacter.position,
        rotation: this.localCharacter.rotation,
      };
    }
    return {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
    };
  }

  public clear() {
    for (const [id, character] of this.remoteCharacters) {
      character.remove();
      this.remoteCharacters.delete(id);
      this.remoteCharacterControllers.delete(id);
    }
    if (this.localCharacter) {
      this.localCharacter.remove();
      this.localCharacter = null;
    }
    if (this.characterInstances) {
      this.characterInstances.dispose();
      this.characterInstances = null;
    }
  }

  public addSelfChatBubble(message: string) {
    if (this.localCharacter) {
      this.localCharacter.addChatBubble(message);
    }
  }

  public addChatBubble(id: number, message: string) {
    this.remoteCharacters.get(id)?.addChatBubble(message);
  }

  public respawnIfPresent(id: number) {
    const characterInfo = this.config.characterResolve(id);

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
        // Limit updates to per 30ms
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
        const { position } = update;

        if (!this.remoteCharacters.has(id) && this.localCharacterSpawned === true) {
          const characterInfo = this.config.characterResolve(id);
          this.spawnRemoteCharacter(
            id,
            characterInfo.username,
            characterInfo.characterDescription,
            new Vect3(position.x, position.y, position.z),
          );
        }

        const characterController = this.remoteCharacterControllers.get(id);
        if (characterController) {
          characterController.update(
            update,
            this.config.timeManager.time,
            this.config.timeManager.deltaTime,
          );
        }
      }

      for (const [id, character] of this.remoteCharacters) {
        if (!this.config.remoteUserStates.has(id)) {
          character.remove();
          this.remoteCharacters.delete(id);
          this.remoteCharacterControllers.delete(id);
        }
      }

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
