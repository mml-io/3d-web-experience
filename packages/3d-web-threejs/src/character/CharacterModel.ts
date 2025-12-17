import {
  MMLCharacter,
  type MMLCharacterDescription,
  parseMMLDescription,
} from "@mml-io/3d-web-avatar";
import {
  AnimationState,
  AnimationWeights,
  AnimationTimes,
  CharacterDescription,
} from "@mml-io/3d-web-client-core";
import {
  AnimationAction,
  AnimationClip,
  AnimationMixer,
  Bone,
  Color,
  Group,
  LoopRepeat,
  Material,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Skeleton,
  SkinnedMesh,
  Texture,
  Vector3,
} from "three";

import { ThreeJSCameraManager } from "../camera/ThreeJSCameraManager";

import { LoadedAnimations } from "./Character";
import { CharacterMaterial } from "./CharacterMaterial";
import { captureCharacterColorsFromObject3D } from "./instancing/CharacterColourSamplingUtils";
import { CharacterModelLoader } from "./loading/CharacterModelLoader";

export const colorPartNamesIndex = [
  "hair",
  "shirt_short",
  "shirt_long",
  "pants_short",
  "pants_long",
  "shoes",
  "skin",
  "lips",
] as const;

export type ColorPartName = (typeof colorPartNamesIndex)[number];

export function colorsToColorArray(
  colors: Map<ColorPartName, Color>,
): Array<[number, number, number]> {
  const colorArray: Array<[number, number, number]> = [];
  for (const partName of colorPartNamesIndex) {
    const color = colors.get(partName);
    if (color) {
      colorArray.push([
        Math.round(color.r * 255),
        Math.round(color.g * 255),
        Math.round(color.b * 255),
      ]);
    }
  }
  return colorArray;
}

export function colorArrayToColors(
  colorArray: Array<[number, number, number]>,
): Map<ColorPartName, Color> {
  const colors = new Map<ColorPartName, Color>();
  for (let i = 0; i < colorPartNamesIndex.length; i++) {
    const color = colorArray[i];
    if (color) {
      colors.set(colorPartNamesIndex[i], new Color(color[0] / 255, color[1] / 255, color[2] / 255));
    }
  }
  return colors;
}

const tempVector = new Vector3();

function disposeMaterialTextures(material: Material): void {
  // Iterate over all enumerable properties (including inherited) to find textures dynamically
  // This catches all texture properties without needing a hardcoded list
  const textureKeys: string[] = [];

  // First pass: find and dispose textures
  for (const key in material) {
    const value = (material as any)[key];
    if (value instanceof Texture) {
      textureKeys.push(key);
      value.dispose();
    }
  }

  // Second pass: clear texture references so Three.js stops counting them
  for (const key of textureKeys) {
    (material as any)[key] = null;
  }
}

function getSimpleHeight(mesh: Object3D): number {
  let maxY = -Infinity;
  let minY = Infinity;

  mesh.traverse((child) => {
    const asMesh = child as Mesh;
    if (asMesh.geometry) {
      const positionAttribute = asMesh.geometry.getAttribute("position");
      for (let i = 0; i < positionAttribute.count; i++) {
        const y = positionAttribute.getY(i);
        maxY = Math.max(maxY, y);
        minY = Math.min(minY, y);
      }
    }
  });
  if (maxY === -Infinity || minY === Infinity) {
    console.warn("No valid vertices found in the mesh to calculate height.");
    return 0;
  }
  return maxY - minY;
}

export type CharacterModelConfig = {
  characterDescription: CharacterDescription;
  animationsPromise: Promise<LoadedAnimations>;
  characterModelLoader: CharacterModelLoader;
  cameraManager: ThreeJSCameraManager;
  characterId: number;
  isLocal: boolean;
  abortController?: AbortController;
};

const remoteMaxTextureSize = 128;
const localMaxTextureSize = 1024;

export class CharacterModel {
  public mesh: Object3D | null = null;
  public headBone: Bone | null = null;
  public characterHeight: number | null = null;

  private materials: Map<string, CharacterMaterial> = new Map();

  public animations: Record<string, AnimationAction> = {};
  public animationMixer: AnimationMixer | null = null;
  public currentAnimation: AnimationState = AnimationState.idle;

  public mmlCharacterDescription: MMLCharacterDescription;

  private isPostDoubleJump = false;

  private colors: Array<[number, number, number]> | null = null;

  constructor(private config: CharacterModelConfig) {}

  public async init(): Promise<void> {
    // Check if operation was canceled before starting
    if (this.config.abortController?.signal.aborted) {
      console.log(`CharacterModel init canceled for ${this.config.characterId}`);
      return;
    }

    let mainMesh: Object3D | null = null;
    try {
      mainMesh = await this.loadCharacterFromDescription();
    } catch (error) {
      if (this.config.abortController?.signal.aborted) {
        return;
      }
      console.error("Failed to load character from description", error);
    }
    if (this.config.abortController?.signal.aborted) {
      return;
    }

    if (mainMesh) {
      this.mesh = mainMesh;
      this.mesh.position.set(0, -0.01, 0);
      this.mesh.traverse((child: Object3D) => {
        if (child.type === "SkinnedMesh") {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });
      this.animationMixer = new AnimationMixer(this.mesh);
    }

    // Check if operation was canceled after mesh loading
    if (this.config.abortController?.signal.aborted) {
      console.log(`CharacterModel init canceled after mesh loading for ${this.config.characterId}`);
      return;
    }

    if (this.mesh) {
      const animationConfig = await this.config.animationsPromise;

      // Check if operation was canceled after animation loading
      if (this.config.abortController?.signal.aborted) {
        return;
      }

      this.setAnimationFromFile(animationConfig.idleAnimation, AnimationState.idle, true);
      this.setAnimationFromFile(animationConfig.jogAnimation, AnimationState.walking, true);
      this.setAnimationFromFile(animationConfig.sprintAnimation, AnimationState.running, true);
      this.setAnimationFromFile(animationConfig.airAnimation, AnimationState.air, true);
      this.setAnimationFromFile(
        animationConfig.doubleJumpAnimation,
        AnimationState.doubleJump,
        false,
        1.45,
      );
      this.characterHeight = getSimpleHeight(this.mesh);
      if (this.config.isLocal) {
        // Capture the colors before applying custom materials
        this.getColors();
      }
      this.applyCustomMaterials();
    }
  }

  private applyCustomMaterials(): void {
    if (!this.mesh) {
      return;
    }

    const originalMaterialsToDispose: MeshStandardMaterial[] = [];

    this.mesh.traverse((child: Object3D) => {
      const asBone = child as Bone;
      if (asBone.isBone) {
        if (child.name === "head") {
          const worldPosition = new Vector3();
          this.headBone = child as Bone;
          this.headBone.getWorldPosition(worldPosition);
        }
      }
      const asMesh = child as SkinnedMesh;
      if (asMesh.isMesh || asMesh.isSkinnedMesh) {
        const originalMaterial = asMesh.material as MeshStandardMaterial;
        if (this.materials.has(originalMaterial.name)) {
          asMesh.material = this.materials.get(originalMaterial.name)!;
        } else {
          const material = new CharacterMaterial({
            isLocal: this.config.isLocal,
            cameraManager: this.config.cameraManager,
            characterId: this.config.characterId,
            originalMaterial,
            colorOverride: originalMaterial.color,
          });

          originalMaterialsToDispose.push(originalMaterial);
          this.materials.set(originalMaterial.name, material);
          asMesh.material = material;
        }
      }
    });

    // Dispose original materials after replacing them
    // CharacterMaterial.copy() copies texture references (not clones), so textures are shared.
    // When we dispose the original material, it will try to dispose the textures, but that's okay
    // because texture.dispose() is safe to call multiple times. The textures will be disposed
    // again when CharacterMaterial is disposed, but Three.js handles that gracefully.
    for (const originalMaterial of originalMaterialsToDispose) {
      originalMaterial.dispose();
    }
  }

  public updateAnimation(targetAnimation: AnimationState) {
    if (this.isPostDoubleJump) {
      if (targetAnimation === AnimationState.doubleJump) {
        // Double jump is requested, but we're in the post double jump state so we play air instead
        targetAnimation = AnimationState.air;
      } else {
        // Reset the post double jump flag if something other than double jump is requested
        this.isPostDoubleJump = false;
      }
    }
    if (this.currentAnimation !== targetAnimation) {
      this.transitionToAnimation(targetAnimation);
    }
  }

  public applyAnimationWeights(weights: AnimationWeights): void {
    if (!this.mesh || !this.animationMixer) {
      return;
    }

    // Apply weights to all animation states
    // Iterate through all AnimationState enum values
    for (const stateValue of [
      AnimationState.idle,
      AnimationState.walking,
      AnimationState.running,
      AnimationState.jumpToAir,
      AnimationState.air,
      AnimationState.airToGround,
      AnimationState.doubleJump,
    ]) {
      const action = this.animations[stateValue];
      if (action) {
        const weight = weights[stateValue] || 0;
        action.setEffectiveWeight(weight);

        // Ensure action is playing if it has weight
        if (weight > 0 && !action.isRunning()) {
          action.play();
        }
      }
    }

    // Update current animation to the one with highest weight for tracking purposes
    let maxWeight = 0;
    let primaryState = this.currentAnimation;
    for (const stateValue of [
      AnimationState.idle,
      AnimationState.walking,
      AnimationState.running,
      AnimationState.jumpToAir,
      AnimationState.air,
      AnimationState.airToGround,
      AnimationState.doubleJump,
    ]) {
      const weight = weights[stateValue] || 0;
      if (weight > maxWeight) {
        maxWeight = weight;
        primaryState = stateValue;
      }
    }
    this.currentAnimation = primaryState;
  }

  public applyAnimationTimes(times: AnimationTimes): void {
    if (!this.animationMixer) {
      return;
    }

    // Set the time for each animation action based on its individual time
    for (const stateValue of [
      AnimationState.idle,
      AnimationState.walking,
      AnimationState.running,
      AnimationState.jumpToAir,
      AnimationState.air,
      AnimationState.airToGround,
      AnimationState.doubleJump,
    ]) {
      const action = this.animations[stateValue];
      if (action) {
        action.time = times[stateValue];
      }
    }
  }

  private async composeMMLCharacter(
    mmlCharacterDescription: MMLCharacterDescription,
  ): Promise<Object3D | null> {
    if (mmlCharacterDescription.base?.url.length === 0) {
      throw new Error(
        "ERROR: An MML Character Description was provided, but it's not a valid <m-character> string, or a valid URL",
      );
    }

    let mergedCharacter: Object3D | null = null;
    if (mmlCharacterDescription) {
      const characterBase = mmlCharacterDescription.base?.url || null;
      if (characterBase) {
        this.mmlCharacterDescription = mmlCharacterDescription;
        mergedCharacter = await MMLCharacter.load(
          characterBase,
          mmlCharacterDescription.parts,
          {
            load: async (url: string, abortController?: AbortController) => {
              const model = await this.config.characterModelLoader.loadModel(
                url,
                this.config.isLocal ? localMaxTextureSize : remoteMaxTextureSize,
                abortController,
              );
              if (this.config.abortController?.signal.aborted) {
                return null;
              }
              if (!model) {
                return null;
              }
              return {
                group: new Group().add(model),
                animations: [],
              };
            },
          },
          this.config.abortController,
        );
        if (mergedCharacter) {
          return mergedCharacter;
        }
      }
    }
    return null;
  }

  private async loadCharacterFromDescription(): Promise<Object3D | null> {
    if (this.config.characterDescription.meshFileUrl) {
      return (
        (await this.config.characterModelLoader.loadModel(
          this.config.characterDescription.meshFileUrl,
          this.config.isLocal ? localMaxTextureSize : remoteMaxTextureSize,
          this.config.abortController,
        )) || null
      );
    }

    let mmlCharacterSource: string;
    let mmlCharacterUrl: string | null = null;
    if (this.config.characterDescription.mmlCharacterUrl) {
      mmlCharacterUrl = this.config.characterDescription.mmlCharacterUrl;
      const res = await fetch(mmlCharacterUrl, {
        signal: this.config.abortController?.signal,
      });
      mmlCharacterSource = await res.text();
    } else if (this.config.characterDescription.mmlCharacterString) {
      mmlCharacterSource = this.config.characterDescription.mmlCharacterString;
    } else {
      throw new Error(
        "ERROR: No Character Description was provided. Specify one of meshFileUrl, mmlCharacterUrl or mmlCharacterString",
      );
    }

    const parsedMMLDescription = parseMMLDescription(mmlCharacterSource, mmlCharacterUrl);
    const mmlCharacterDescription = parsedMMLDescription[0];
    if (parsedMMLDescription[1].length > 0) {
      console.warn("Errors parsing MML Character Description: ", parsedMMLDescription[1]);
    }
    const mmlCharacterBody = await this.composeMMLCharacter(mmlCharacterDescription);
    if (mmlCharacterBody) {
      return mmlCharacterBody;
    }
    return null;
  }

  public getColors(): Array<[number, number, number]> {
    if (!this.mesh) {
      return [];
    }
    if (this.colors) {
      return this.colors;
    }
    const colors = captureCharacterColorsFromObject3D(this.mesh, {
      circularSamplingRadius: 12,
      topDownSamplingSize: { width: 5, height: 150 },
      debug: false, // Reduced debug spam
    });
    this.colors = colorsToColorArray(colors);
    return this.colors;
  }

  private cleanAnimationClips(
    skeletalMesh: Object3D | null,
    animationClip: AnimationClip,
    keepRootBonePositionAnimation: boolean,
  ): AnimationClip {
    const availableBones = new Set<string>();
    if (skeletalMesh) {
      skeletalMesh.traverse((child) => {
        const asBone = child as Bone;
        if (asBone.isBone) {
          availableBones.add(child.name);
        }
      });
    }
    animationClip.tracks = animationClip.tracks.filter((track) => {
      const [trackName, trackProperty] = track.name.split(".");
      if (keepRootBonePositionAnimation && trackName === "root" && trackProperty === "position") {
        return true;
      }
      const shouldAnimate =
        availableBones.has(trackName) && trackProperty !== "position" && trackProperty !== "scale";
      return shouldAnimate;
    });
    return animationClip;
  }

  private setAnimationFromFile(
    animation: AnimationClip,
    animationType: AnimationState,
    loop: boolean = true,
    playbackSpeed: number = 1.0,
  ) {
    const cleanAnimation = this.cleanAnimationClips(this.mesh, animation, true);
    this.animations[animationType] = this.animationMixer!.clipAction(cleanAnimation);
    this.animations[animationType].timeScale = playbackSpeed;

    // For weight-based blending, all animations should be playing simultaneously
    // The weight system will control which ones are visible
    this.animations[animationType].play();
    this.animations[animationType].enabled = true;

    // Set initial weight based on whether this is the idle animation
    if (animationType === AnimationState.idle) {
      this.animations[animationType].setEffectiveWeight(1.0);
    } else {
      this.animations[animationType].setEffectiveWeight(0.0);
    }

    if (!loop) {
      this.animations[animationType].setLoop(LoopRepeat, 1); // Ensure non-looping
      this.animations[animationType].clampWhenFinished = true;
    }
  }

  private transitionToAnimation(
    targetAnimation: AnimationState,
    transitionDuration: number = 0.15,
  ): void {
    if (!this.mesh) {
      return;
    }

    const currentAction = this.animations[this.currentAnimation];
    const targetAction = this.animations[targetAnimation];

    if (!targetAction) {
      return;
    }
    this.currentAnimation = targetAnimation;

    if (currentAction) {
      currentAction.fadeOut(transitionDuration);
    }

    targetAction.reset();
    if (!targetAction.isRunning()) {
      targetAction.play();
    }

    if (targetAnimation === AnimationState.doubleJump) {
      targetAction.getMixer().addEventListener("finished", (_event) => {
        if (this.currentAnimation === AnimationState.doubleJump) {
          this.isPostDoubleJump = true;
          // This triggers the transition to the air animation because the double jump animation is done
          this.updateAnimation(AnimationState.doubleJump);
        }
      });
    }

    targetAction.enabled = true;
    targetAction.fadeIn(transitionDuration);
  }

  update(time: number) {
    if (this.animationMixer) {
      this.animationMixer.update(time);
      this.materials.forEach((material) => material.update());
    }
  }

  dispose() {
    if (this.animationMixer) {
      this.animationMixer.stopAllAction();
      this.animationMixer.uncacheRoot(this.mesh as SkinnedMesh);
      this.animationMixer = null;
    }
    const processedMaterials = new Set<Material>();

    this.materials.forEach((material) => {
      disposeMaterialTextures(material);
      material.dispose();
      processedMaterials.add(material);
    });
    this.materials.clear();

    const processedSkeletons = new Set<Skeleton>();

    this.mesh?.traverse((child: Object3D) => {
      const asMesh = child as Mesh;
      if (asMesh.isMesh) {
        if (asMesh.geometry) {
          asMesh.geometry.dispose();
        }
        if (asMesh.material) {
          if (Array.isArray(asMesh.material)) {
            asMesh.material.forEach((material) => {
              if (!processedMaterials.has(material)) {
                disposeMaterialTextures(material);
                processedMaterials.add(material);
              }
              material.dispose();
            });
          } else {
            if (!processedMaterials.has(asMesh.material)) {
              disposeMaterialTextures(asMesh.material);
              processedMaterials.add(asMesh.material);
            }
            asMesh.material.dispose();
          }
        }

        const asSkinnedMesh = child as SkinnedMesh;
        if (asSkinnedMesh.isSkinnedMesh) {
          const skeleton = asSkinnedMesh.skeleton;
          if (skeleton && !processedSkeletons.has(skeleton)) {
            processedSkeletons.add(skeleton);
            skeleton.dispose();
          }
        }
      }
    });

    this.mesh = null;
    this.headBone = null;
    this.characterHeight = null;
    this.animations = {};
    this.colors = null;
  }
}
