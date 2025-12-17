import {
  CharacterRenderState,
  EulXYZ,
  IVect3,
  Quat,
  RenderState,
  Vect3,
} from "@mml-io/3d-web-client-core";
import { Euler, Group, Quaternion, Vector3 } from "three";

import { ThreeJSCameraManager } from "../camera/ThreeJSCameraManager";
import { Composer } from "../composer";

import { Character, LoadedAnimations } from "./Character";
import { colorArrayToColors } from "./CharacterModel";
import { CharacterInstances } from "./instancing/CharacterInstances";
import { CharacterModelLoader } from "./loading/CharacterModelLoader";

type LoadedCharacterState = {
  character: Character;
  characterLoaded: boolean;
  abortController?: AbortController;
};

type CharacterReadyForScene = {
  id: number;
  character: Character;
};

export class ThreeJSCharacterManager {
  private characterGroup: Group;
  private characterModelLoader: CharacterModelLoader;
  private animationsPromise: Promise<LoadedAnimations>;
  private characterInstances: CharacterInstances | null = null;
  private characterInstancesReady = false;
  private pendingInstanceCharacters = new Map<number, CharacterRenderState>();

  // Track loaded characters (promoted from instances)
  private loadedCharacters = new Map<number, LoadedCharacterState>();
  private loadingCharacters = new Set<number>();
  private charactersReadyForScene: CharacterReadyForScene[] = [];

  private readonly MAX_SCENE_ADDITIONS_PER_FRAME = 3;
  private readonly MAX_REAL_REMOTE_CHARACTERS = 30;
  private readonly LOD_CHANGE_COOLDOWN_MS = 2000;

  private lastLODEvaluation = new Map<number, number>();
  private cachedHeadPosition = new Vector3();

  constructor(
    characterGroup: Group,
    animationsPromise: Promise<LoadedAnimations>,
    characterModelLoader: CharacterModelLoader,
    private threeJSCameraManager: ThreeJSCameraManager,
    private composer: Composer,
  ) {
    this.characterGroup = characterGroup;
    this.characterModelLoader = characterModelLoader;
    this.animationsPromise = animationsPromise;

    // Initialize character instances
    const characterInstances = new CharacterInstances({
      animationsPromise,
      characterModelLoader: this.characterModelLoader,
      cameraManager: this.threeJSCameraManager,
      debug: false,
    });

    characterInstances.initialize().then((instancedMesh) => {
      if (instancedMesh) {
        this.characterGroup.add(instancedMesh);
        characterInstances.setupFrustumCulling();
        this.characterInstances = characterInstances;
        this.characterInstancesReady = true;
      } else {
        console.error("Failed to initialize character instances");
      }
    });
  }

  update(state: RenderState, deltaTimeSeconds: number): void {
    // Process queued characters ready for scene (throttled)
    const charactersToAdd = this.charactersReadyForScene.splice(
      0,
      this.MAX_SCENE_ADDITIONS_PER_FRAME,
    );
    for (const { character } of charactersToAdd) {
      this.characterGroup.add(character);
    }

    // Process all characters
    for (const [id, charState] of state.characters) {
      const loadedChar = this.loadedCharacters.get(id);
      const isLoaded = loadedChar?.characterLoaded ?? false;
      const isPending = this.pendingInstanceCharacters.has(id);
      const hasInstance = this.characterInstances?.hasInstance(id) ?? false;

      if (!isLoaded && !hasInstance && !isPending) {
        // New character - spawn it as instance
        this.spawnCharacter(charState);
      } else if (!isLoaded && isPending && !hasInstance && this.characterInstancesReady) {
        // Pending character and instances are now ready - spawn it
        this.spawnCharacter(charState);
      } else if (!isLoaded) {
        // Existing instance or pending - update transform
        // This includes characters that are loading (in loadedCharacters but characterLoaded is false)
        this.updateCharacterTransform(charState);
      }
    }

    // Handle description changes (sparse check)
    for (const characterId of state.updatedCharacterDescriptions) {
      const charState = state.characters.get(characterId);
      if (charState) {
        this.updateCharacterDescription(charState);
      }
    }

    // Evaluate LOD (promote/demote characters based on distance)
    // Local characters are always promoted to real meshes
    // Skip until characterInstances is ready
    if (this.characterInstancesReady) {
      this.evaluateLOD(state);

      // Update character instances
      if (this.characterInstances) {
        this.characterInstances.update(deltaTimeSeconds);
      }
    }

    // Update loaded characters
    // This applies to both local and remote characters
    for (const [id, loadedChar] of this.loadedCharacters) {
      const charState = state.characters.get(id);
      if (charState && loadedChar.characterLoaded) {
        // Directly apply position and rotation from state
        loadedChar.character.position.set(
          charState.position.x,
          charState.position.y,
          charState.position.z,
        );
        const euler = new Euler(charState.rotation.x, charState.rotation.y, charState.rotation.z);
        const quaternion = new Quaternion().setFromEuler(euler);
        loadedChar.character.quaternion.set(quaternion.x, quaternion.y, quaternion.z, quaternion.w);

        // Use animation weights and times from core instead of single state transitions
        loadedChar.character.applyAnimationWeights(charState.animationWeights);
        loadedChar.character.applyAnimationTimes(charState.animationTimes);

        loadedChar.character.update(deltaTimeSeconds);
      } else if (!charState) {
        console.warn(`[Renderer] Loaded character ${id} not found in state.characters`);
      }
    }
  }

  despawnCharacter(characterId: number): void {
    // Remove loaded character if exists
    const loadedChar = this.loadedCharacters.get(characterId);
    if (loadedChar) {
      if (loadedChar.abortController) {
        loadedChar.abortController.abort();
      }
      this.characterGroup.remove(loadedChar.character);
      loadedChar.character.dispose();
      this.loadedCharacters.delete(characterId);
    }

    // Remove from loading set
    this.loadingCharacters.delete(characterId);

    // Remove from ready queue
    const queueIndex = this.charactersReadyForScene.findIndex((c) => c.id === characterId);
    if (queueIndex !== -1) {
      this.charactersReadyForScene.splice(queueIndex, 1);
    }

    // Remove from pending state
    this.pendingInstanceCharacters.delete(characterId);

    // Remove instance
    if (this.characterInstances) {
      this.characterInstances.despawnInstance(characterId);
    }
  }

  getLocalCharacterPosition(localCharacterId: number | null): IVect3 | null {
    if (localCharacterId === null) {
      return null;
    }

    const loadedChar = this.loadedCharacters.get(localCharacterId);
    if (loadedChar && loadedChar.characterLoaded) {
      return loadedChar.character.position;
    }

    return null;
  }

  getCharacterHeadPosition(characterId: number): Vector3 | null {
    const loadedChar = this.loadedCharacters.get(characterId);
    if (loadedChar && loadedChar.characterLoaded) {
      const headPos = loadedChar.character.getHeadWorldPosition();
      if (headPos) {
        this.cachedHeadPosition.set(headPos.x, headPos.y, headPos.z);
        return this.cachedHeadPosition;
      }
    }
    return null;
  }

  addChatBubble(characterId: number, message: string): void {
    const loadedChar = this.loadedCharacters.get(characterId);
    if (loadedChar && loadedChar.characterLoaded) {
      loadedChar.character.addChatBubble(message);
    }
  }

  getLocalCharacterForMML(localCharacterId: number | null): {
    position: { x: number; y: number; z: number };
    rotation: { x: number; y: number; z: number };
  } | null {
    if (localCharacterId !== null) {
      const loadedChar = this.loadedCharacters.get(localCharacterId);
      if (loadedChar && loadedChar.characterLoaded) {
        return {
          position: loadedChar.character.position,
          rotation: {
            x: loadedChar.character.rotation.x * (180 / Math.PI),
            y: loadedChar.character.rotation.y * (180 / Math.PI),
            z: loadedChar.character.rotation.z * (180 / Math.PI),
          },
        };
      }
    }
    return null;
  }

  dispose(): void {
    // Dispose all loaded characters
    for (const [, loadedChar] of this.loadedCharacters) {
      if (loadedChar.abortController) {
        loadedChar.abortController.abort();
      }
      this.characterGroup.remove(loadedChar.character);
      loadedChar.character.dispose();
    }
    this.loadedCharacters.clear();
    this.loadingCharacters.clear();
    this.charactersReadyForScene.length = 0;
    this.pendingInstanceCharacters.clear();

    // Dispose character instances
    if (this.characterInstances) {
      this.characterInstances.dispose();
      this.characterInstances = null;
    }
  }

  private spawnCharacter(charState: CharacterRenderState): void {
    // All characters start as instances (may be promoted to full characters via LOD)
    if (!this.characterInstances) {
      // Store the character state for when instances are ready
      this.pendingInstanceCharacters.set(charState.id, charState);
      return;
    }

    this.spawnCharacterInstance(charState);
  }

  private spawnCharacterInstance(charState: CharacterRenderState): void {
    if (!this.characterInstances) {
      return;
    }

    // Check if instance already exists (defensive check)
    if (this.characterInstances.hasInstance(charState.id)) {
      // Remove from pending if present and return
      this.pendingInstanceCharacters.delete(charState.id);
      return;
    }

    // Remove from pending if present
    this.pendingInstanceCharacters.delete(charState.id);

    const colorMap = colorArrayToColors(charState.colors ?? []);

    this.characterInstances.spawnInstance(
      charState.id,
      colorMap,
      charState.position,
      charState.rotation,
      charState.animationState,
    );
  }

  private updateCharacterTransform(charState: CharacterRenderState): void {
    if (!this.characterInstances) {
      // Update the stored character state for when instances are ready
      this.pendingInstanceCharacters.set(charState.id, charState);
      return;
    }

    const loadedChar = this.loadedCharacters.get(charState.id);
    if (!loadedChar || !loadedChar.characterLoaded) {
      // Update instance transform
      this.characterInstances.updateInstance(
        charState.id,
        charState.position,
        charState.rotation,
        charState.animationState,
        charState.animationWeights,
      );
    }
  }

  private updateCharacterDescription(charState: CharacterRenderState): void {
    const loadedChar = this.loadedCharacters.get(charState.id);
    if (loadedChar && loadedChar.characterLoaded) {
      // Update loaded character description (works for both local and remote)
      const abortController = new AbortController();
      loadedChar.character.updateCharacter(
        charState.username,
        charState.characterDescription,
        abortController,
        () => {
          if (abortController.signal.aborted) {
            return;
          }
        },
        (error) => {
          console.error("Character model load failed", charState.id, error);
        },
      );
      loadedChar.abortController = abortController;
    }

    // Update instance colors if character has instance
    if (
      this.characterInstances &&
      charState.colors &&
      this.characterInstances.hasInstance(charState.id)
    ) {
      const colorMap = colorArrayToColors(charState.colors);
      this.characterInstances.updateInstanceColors(charState.id, colorMap);
    }
  }

  private evaluateLOD(state: RenderState): void {
    if (!this.characterInstances) {
      return;
    }

    // Get local character position from state (don't require it to be loaded)
    const localCharState =
      state.localCharacterId !== null ? state.characters.get(state.localCharacterId) : null;
    if (!localCharState) {
      return;
    }
    const localPosition = localCharState.position;

    const now = Date.now();

    // Process all characters to determine if they should be real or instances
    for (const [id, charState] of state.characters) {
      const isLocal = id === state.localCharacterId;
      const isReal = this.loadedCharacters.has(id) || this.loadingCharacters.has(id);

      // Local characters should always be real meshes
      let shouldBeReal = isLocal;

      if (!isLocal) {
        // For remote characters, calculate distance and determine LOD
        const dx = charState.position.x - localPosition.x;
        const dy = charState.position.y - localPosition.y;
        const dz = charState.position.z - localPosition.z;
        const distanceSquared = dx * dx + dy * dy + dz * dz;

        // Find how many characters are closer (including local character)
        let closerCount = 1; // Local character is always closer
        for (const [otherId, otherCharState] of state.characters) {
          if (otherId === id || otherId === state.localCharacterId) {
            continue;
          }
          const otherDx = otherCharState.position.x - localPosition.x;
          const otherDy = otherCharState.position.y - localPosition.y;
          const otherDz = otherCharState.position.z - localPosition.z;
          const otherDistanceSquared = otherDx * otherDx + otherDy * otherDy + otherDz * otherDz;
          if (otherDistanceSquared < distanceSquared) {
            closerCount++;
          }
        }

        // Promote closest remote characters to real
        shouldBeReal = closerCount <= this.MAX_REAL_REMOTE_CHARACTERS;
      }

      if (isReal !== shouldBeReal) {
        // Local characters should be promoted immediately without cooldown
        if (!isLocal) {
          const lastChange = this.lastLODEvaluation.get(id) ?? 0;
          const timeSinceLastChange = now - lastChange;

          if (timeSinceLastChange < this.LOD_CHANGE_COOLDOWN_MS) {
            continue;
          }
        }

        this.lastLODEvaluation.set(id, now);

        if (shouldBeReal) {
          this.promoteToReal(charState);
        } else {
          this.demoteToInstance(id, charState);
        }
      }
    }
  }

  private promoteToReal(charState: CharacterRenderState): void {
    if (this.loadedCharacters.has(charState.id) || this.loadingCharacters.has(charState.id)) {
      return;
    }

    this.loadingCharacters.add(charState.id);
    const abortController = new AbortController();

    // Get position from instance if available, otherwise use state position
    let position = new Vect3(charState.position.x, charState.position.y, charState.position.z);
    const instancePosition = this.characterInstances?.getPositionForInstance(charState.id);
    if (instancePosition) {
      position = instancePosition;
    }

    // Remove from pending instances if present
    this.pendingInstanceCharacters.delete(charState.id);

    const character = new Character({
      username: charState.username,
      characterDescription: charState.characterDescription,
      animationsPromise: this.animationsPromise,
      characterModelLoader: this.characterModelLoader,
      characterId: charState.id,
      modelLoadedCallback: () => {
        if (abortController.signal.aborted) {
          return;
        }

        const loadedCharState = this.loadedCharacters.get(charState.id);
        if (!loadedCharState) {
          return;
        }

        loadedCharState.characterLoaded = true;
        this.loadingCharacters.delete(charState.id);

        // Add to scene queue
        this.charactersReadyForScene.push({
          id: charState.id,
          character,
        });

        // Shadow the instance if it exists (for remote characters promoted from instances)
        if (this.characterInstances?.hasInstance(charState.id)) {
          this.characterInstances.shadowInstance(charState.id);
        }
      },
      modelLoadFailedCallback: (error: Error) => {
        if (abortController.signal.aborted) {
          return;
        }

        console.warn(`Character ${charState.id} model failed to load, keeping instance visible`);

        this.loadingCharacters.delete(charState.id);

        const loadedCharState = this.loadedCharacters.get(charState.id);
        if (loadedCharState && loadedCharState.character.parent) {
          this.characterGroup.remove(loadedCharState.character);
        }

        if (loadedCharState) {
          loadedCharState.character.dispose();
          this.loadedCharacters.delete(charState.id);
        }
      },
      cameraManager: this.threeJSCameraManager,
      composer: this.composer,
      isLocal: charState.isLocal,
      abortController,
    });

    const spawnQuaternion = new Quat().setFromEulerXYZ(charState.rotation);
    character.position.set(position.x, position.y, position.z);
    character.quaternion.set(
      spawnQuaternion.x,
      spawnQuaternion.y,
      spawnQuaternion.z,
      spawnQuaternion.w,
    );

    this.loadedCharacters.set(charState.id, {
      character,
      characterLoaded: false,
      abortController,
    });
  }

  private demoteToInstance(characterId: number, charState: CharacterRenderState): void {
    // Local characters should never be demoted to instances
    if (charState.isLocal) {
      return;
    }

    const wasLoading = this.loadingCharacters.has(characterId);
    this.loadingCharacters.delete(characterId);

    const loadedChar = this.loadedCharacters.get(characterId);
    if (!loadedChar) {
      return;
    }

    // Cancel loading if in progress
    if (loadedChar.abortController && wasLoading) {
      loadedChar.abortController.abort();
      loadedChar.abortController = undefined;
    }

    // Remove from scene queue
    const queueIndex = this.charactersReadyForScene.findIndex((c) => c.id === characterId);
    if (queueIndex !== -1) {
      this.charactersReadyForScene.splice(queueIndex, 1);
    }

    // Capture real character position
    const realPosition = new Vect3(
      loadedChar.character.position.x,
      loadedChar.character.position.y,
      loadedChar.character.position.z,
    );
    const realRotation = new EulXYZ().setFromQuaternion(
      new Quat(
        loadedChar.character.quaternion.x,
        loadedChar.character.quaternion.y,
        loadedChar.character.quaternion.z,
        loadedChar.character.quaternion.w,
      ),
    );

    // Remove real character
    this.characterGroup.remove(loadedChar.character);
    loadedChar.character.dispose();
    this.loadedCharacters.delete(characterId);

    // Unshadow and position instance
    if (this.characterInstances) {
      this.characterInstances.unshadowInstance(
        characterId,
        realPosition,
        realRotation,
        charState.animationState,
      );
    }
  }
}
