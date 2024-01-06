import { PositionAndRotation } from "mml-web";
import { Euler, Group, Quaternion, Vector3 } from "three";

import { CameraManager } from "../camera/CameraManager";
import { CollisionsManager } from "../collisions/CollisionsManager";
import { ease } from "../helpers/math-helpers";
import { KeyInputManager } from "../input/KeyInputManager";
import { Composer } from "../rendering/composer";
import { TimeManager } from "../time/TimeManager";

import { Character, CharacterDescription } from "./Character";
import { CharacterModelLoader } from "./CharacterModelLoader";
import { AnimationState, CharacterState } from "./CharacterState";
import { LocalController } from "./LocalController";
import { RemoteController } from "./RemoteController";
import { encodeCharacterAndCamera } from "./url-position";

export class CharacterManager {
  private updateLocationHash = true;

  public readonly headTargetOffset = new Vector3(0, 1.3, 0);

  private id: number = 0;

  public remoteCharacters: Map<number, Character> = new Map();
  public remoteCharacterControllers: Map<number, RemoteController> = new Map();

  private characterDescription: CharacterDescription | null = null;
  public localCharacter: Character | null = null;
  private localController: LocalController;

  private cameraOffsetTarget: number = 0;
  private cameraOffset: number = 0;

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
  ) {
    this.group = new Group();
  }

  public spawnCharacter(
    characterDescription: CharacterDescription,
    id: number,
    isLocal: boolean = false,
    spawnPosition: Vector3 = new Vector3(),
    spawnRotation: Euler = new Euler(),
  ) {
    this.characterDescription = characterDescription;
    const character = new Character(
      characterDescription,
      this.characterModelLoader,
      id,
      () => {
        // character loaded callback
      },
      this.cameraManager,
      this.composer,
    );

    if (isLocal) {
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
    }

    if (isLocal) {
      this.id = id;
      this.localCharacter = character;
      this.localController = new LocalController(
        this.localCharacter,
        this.id,
        this.collisionsManager,
        this.keyInputManager,
        this.cameraManager,
        this.timeManager,
      );
      this.localCharacter.position.set(spawnPosition.x, spawnPosition.y, spawnPosition.z);
      this.localCharacter.rotation.set(spawnRotation.x, spawnRotation.y, spawnRotation.z);
    } else {
      this.remoteCharacters.set(id, character);
      const remoteController = new RemoteController(character, id);
      remoteController.character.position.set(spawnPosition.x, spawnPosition.y, spawnPosition.z);
      remoteController.character.rotation.set(spawnRotation.x, spawnRotation.y, spawnRotation.z);
      this.remoteCharacterControllers.set(id, remoteController);
    }
    character.tooltip?.setText(`${id}`);
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

  public update() {
    if (this.localCharacter) {
      this.localCharacter.update(this.timeManager.time, this.timeManager.deltaTime);
      if (this.speakingCharacters.has(this.id)) {
        this.localCharacter.speakingIndicator?.setSpeaking(this.speakingCharacters.get(this.id)!);
      }

      this.localController.update();
      if (this.timeManager.frame % 2 === 0) {
        this.sendUpdate(this.localController.networkState);
      }

      this.cameraOffsetTarget = this.cameraManager.targetDistance <= 0.4 ? 0.13 : 0;
      this.cameraOffset += ease(this.cameraOffsetTarget, this.cameraOffset, 0.1);
      const targetOffset = new Vector3(0, 0, this.cameraOffset);
      targetOffset.add(this.headTargetOffset);
      targetOffset.applyQuaternion(this.localCharacter.quaternion);
      this.cameraManager.setTarget(targetOffset.add(this.localCharacter.position));

      for (const [id, update] of this.clientStates) {
        if (this.remoteCharacters.has(id) && this.speakingCharacters.has(id)) {
          const character = this.remoteCharacters.get(id);
          character?.speakingIndicator?.setSpeaking(this.speakingCharacters.get(id)!);
        }
        const { position } = update;
        if (!this.remoteCharacters.has(id)) {
          this.spawnCharacter(
            this.characterDescription!,
            id,
            false,
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
