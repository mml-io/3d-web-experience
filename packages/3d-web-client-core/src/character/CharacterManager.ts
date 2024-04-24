import { PositionAndRotation } from "mml-web";
import { Euler, Group, Quaternion, Vector3 } from "three";

import { CameraManager } from "../camera/CameraManager";
import { CollisionsManager } from "../collisions/CollisionsManager";
import { ease } from "../helpers/math-helpers";
import { KeyInputManager } from "../input/KeyInputManager";
import { Composer } from "../rendering/composer";
import { TimeManager } from "../time/TimeManager";

import { AnimationConfig, Character, CharacterDescription } from "./Character";
import { CharacterModelLoader } from "./CharacterModelLoader";
import { AnimationState, CharacterState } from "./CharacterState";
import { LocalController } from "./LocalController";
import { RemoteController } from "./RemoteController";
import { encodeCharacterAndCamera } from "./url-position";

export class CharacterManager {
  private updateLocationHash = true;

  public readonly headTargetOffset = new Vector3(0, 1.3, 0);

  private localClientId: number = 0;

  public remoteCharacters: Map<number, Character> = new Map();
  public remoteCharacterControllers: Map<number, RemoteController> = new Map();

  private localCharacterSpawned: boolean = false;
  private localController: LocalController;
  public localCharacter: Character | null = null;

  private speakingCharacters: Map<number, boolean> = new Map();

  public readonly group: Group;

  constructor(
    private readonly composer: Composer,
    private readonly characterModelLoader: CharacterModelLoader,
    private readonly collisionsManager: CollisionsManager,
    private readonly cameraManager: CameraManager,
    private readonly timeManager: TimeManager,
    private readonly keyInputManager: KeyInputManager,
    private readonly clientStates: Map<number, CharacterState>,
    private readonly sendUpdate: (update: CharacterState) => void,
    private readonly animationConfig: AnimationConfig,
    private readonly characterResolve: (clientId: number) => {
      username: string;
      characterDescription: CharacterDescription;
    },
  ) {
    this.group = new Group();
  }

  public spawnLocalCharacter(
    id: number,
    username: string,
    characterDescription: CharacterDescription,
    spawnPosition: Vector3 = new Vector3(),
    spawnRotation: Euler = new Euler(),
  ) {
    const character = new Character(
      username,
      characterDescription,
      this.animationConfig,
      this.characterModelLoader,
      id,
      () => {
        // character loaded callback
      },
      this.cameraManager,
      this.composer,
      true,
    );
    const quaternion = new Quaternion().setFromEuler(character.rotation);
    this.sendUpdate({
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
    this.localController = new LocalController(
      this.localCharacter,
      this.localClientId,
      this.collisionsManager,
      this.keyInputManager,
      this.cameraManager,
      this.timeManager,
    );
    this.localCharacter.position.set(spawnPosition.x, spawnPosition.y, spawnPosition.z);
    this.localCharacter.rotation.set(spawnRotation.x, spawnRotation.y, spawnRotation.z);
    this.group.add(character);
    this.localCharacterSpawned = true;
  }

  public spawnRemoteCharacter(
    id: number,
    username: string,
    characterDescription: CharacterDescription,
    spawnPosition: Vector3 = new Vector3(),
    spawnRotation: Euler = new Euler(),
  ) {
    const character = new Character(
      username,
      characterDescription,
      this.animationConfig,
      this.characterModelLoader,
      id,
      () => {
        // character loaded callback
      },
      this.cameraManager,
      this.composer,
      false,
    );

    this.remoteCharacters.set(id, character);
    const remoteController = new RemoteController(character, id);
    remoteController.character.position.set(spawnPosition.x, spawnPosition.y, spawnPosition.z);
    remoteController.character.rotation.set(spawnRotation.x, spawnRotation.y, spawnRotation.z);
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
      this.group.remove(character);
      this.remoteCharacters.delete(id);
      this.remoteCharacterControllers.delete(id);
    }
    if (this.localCharacter) {
      this.group.remove(this.localCharacter);
      this.localCharacter = null;
    }
  }

  public setSpeakingCharacter(id: number, value: boolean) {
    this.speakingCharacters.set(id, value);
  }

  public respawnIfPresent(id: number) {
    const characterInfo = this.characterResolve(id);

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
      this.localCharacter.update(this.timeManager.time, this.timeManager.deltaTime);
      if (this.speakingCharacters.has(this.localClientId)) {
        this.localCharacter.speakingIndicator?.setSpeaking(
          this.speakingCharacters.get(this.localClientId)!,
        );
      }

      this.localController.update();
      if (this.timeManager.frame % 2 === 0) {
        this.sendUpdate(this.localController.networkState);
      }

      const targetOffset = new Vector3();
      targetOffset
        .add(this.headTargetOffset)
        .applyQuaternion(this.localCharacter.quaternion)
        .add(this.localCharacter.position);
      this.cameraManager.setTarget(targetOffset);

      for (const [id, update] of this.clientStates) {
        if (this.remoteCharacters.has(id) && this.speakingCharacters.has(id)) {
          const character = this.remoteCharacters.get(id);
          character?.speakingIndicator?.setSpeaking(this.speakingCharacters.get(id)!);
        }
        const { position } = update;

        if (!this.remoteCharacters.has(id) && this.localCharacterSpawned === true) {
          const characterInfo = this.characterResolve(id);
          this.spawnRemoteCharacter(
            id,
            characterInfo.username,
            characterInfo.characterDescription,
            new Vector3(position.x, position.y, position.z),
          );
        }

        const characterController = this.remoteCharacterControllers.get(id);
        if (characterController) {
          characterController.update(update, this.timeManager.time, this.timeManager.deltaTime);
        }
      }

      for (const [id, character] of this.remoteCharacters) {
        if (!this.clientStates.has(id)) {
          character.speakingIndicator?.dispose();
          this.group.remove(character);
          this.remoteCharacters.delete(id);
          this.remoteCharacterControllers.delete(id);
        }
      }

      if (this.updateLocationHash && this.timeManager.frame % 60 === 0) {
        window.location.hash = encodeCharacterAndCamera(
          this.localCharacter,
          this.cameraManager.camera,
        );
      }
    }
  }
}
