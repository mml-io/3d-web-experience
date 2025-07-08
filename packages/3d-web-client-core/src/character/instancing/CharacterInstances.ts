import { MMLCharacter } from "@mml-io/3d-web-avatar";
import {
  AnimationAction,
  AnimationClip,
  AnimationMixer,
  Color,
  Euler,
  Group,
  Interpolant,
  Matrix4,
  Object3D,
  PropertyMixer,
  Quaternion,
  SkinnedMesh,
  Vector3,
} from "three";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";

import lowPolyLoDModelURL from "../../assets/low-poly-humanoid.glb";
import { CameraManager } from "../../camera/CameraManager";
import { EulXYZ, Vect3 } from "../../math";
import { TimeManager } from "../../time/TimeManager";
import { LoadedAnimations } from "../Character";
import { ColorPartName } from "../CharacterModel";
import { AnimationState } from "../CharacterState";
import { CharacterModelLoader } from "../loading/CharacterModelLoader";

import {
  captureCharacterColorsFromObject3D,
  updateDebugTextureCanvas,
} from "./CharacterColourSamplingUtils";
import { createSingleTimeline, SegmentTime } from "./CharacterInstancingAnimationUtils";
import { mergeSkinnedMeshes, validateAndCleanSkeleton } from "./CharacterInstancingUtils";
import { createInstancedMesh2From, Entity, InstancedMesh2 } from "./vendor";

export type CharacterInstancesConfig = {
  animationsPromise: Promise<LoadedAnimations>;
  characterModelLoader: CharacterModelLoader;
  cameraManager: CameraManager;
  timeManager: TimeManager;
  instanceCount?: number;
  spawnRadius?: number;
  debug?: boolean;
};

export type InstanceData = {
  characterId: number;
  instanceId: number;
  isActive: boolean;
  isShadowed: boolean;

  time: number;
  speed: number;
  offset: number;

  currentAnimationState: string;
  animationTime: number;

  skinColor: Color;
  eyesBlackColor: Color;
  eyesWhiteColor: Color;
  lipsColor: Color;
  hairColor: Color;

  shirtColor: Color;
  pantsColor: Color;
  shoesColor: Color;

  shirtShortColor: Color;
  shirtLongColor: Color;
  pantsShortColor: Color;
  pantsLongColor: Color;

  targetPosition: Vector3;
  targetQuaternion: Quaternion;
  lerpSpeed: number;
  hasNewTarget: boolean;
};

export class CharacterInstances {
  private mixer: AnimationMixer | null = null;
  private action: AnimationAction | null = null;
  private instancedMesh: InstancedMesh2<InstanceData> | null = null;
  private skinnedMesh: SkinnedMesh | null = null;

  private propertyBindings: PropertyMixer[] = [];
  private interpolants: Interpolant[] = [];
  private propertyBindingsLOD: PropertyMixer[] = [];
  private interpolantsLOD: Interpolant[] = [];

  private invMatrixWorld = new Matrix4();
  private cameraLocalPosition = new Vector3();

  private delta = 0;

  private characterScale = 1;

  private currentBindingMode: "full" | "lod" | null = null;
  private instanceCount: number;
  private spawnRadius: number;

  private debug = false;
  private readonly instanceId = Math.random().toString(36).substr(2, 5);

  private immutableColors = {
    skin: [0.8509803921568627, 0.6352941176470588, 0.49411764705882355],
    eyes_black: [0.0, 0.0, 0.0],
    eyes_white: [1.0, 1.0, 1.0],
    lips: [0.788235294117647, 0.43529411764705883, 0.39215686274509803],
    shoes: [0.8666666666666667, 0.8666666666666667, 0.8666666666666667],
  };

  // Single merged animation with time segments
  private animationClip: AnimationClip | null = null;
  private animationSegments: Map<string, SegmentTime> = new Map();

  private startWithHiddenInstances = true;
  private characterIdToInstanceIdMap = new Map<number, number>();

  private animationStateToSegmentName(state: AnimationState): string {
    switch (state) {
      case AnimationState.idle:
        return "idle";
      case AnimationState.walking:
        return "walking";
      case AnimationState.running:
        return "running";
      case AnimationState.air:
        return "air";
      case AnimationState.doubleJump:
        return "doubleJump";
      default:
        console.warn(`Unknown AnimationState: ${state}, defaulting to idle`);
        return "idle";
    }
  }

  constructor(private config: CharacterInstancesConfig) {
    this.instanceCount = config.instanceCount || 100;
    this.spawnRadius = config.spawnRadius || 50;
    this.debug = config.debug || false;
    if (this.debug) {
      console.log(`CharacterInstances created with ID: ${this.instanceId}`);
    }
  }

  public async initialize(): Promise<Object3D | null> {
    try {
      if (this.debug) {
        console.log("lowPolyLoDModelURL", lowPolyLoDModelURL);
      }
      const lowPolyModel = await MMLCharacter.load(lowPolyLoDModelURL, [], {
        load: async (url: string, abortController?: AbortController) => {
          const model = await this.config.characterModelLoader.loadModel(url, 32, abortController);
          if (!model) {
            return null;
          }
          return {
            group: new Group().add(model as Object3D),
            animations: [],
          };
        },
      });
      if (!lowPolyModel) {
        throw new Error(`Failed to load model from file ${lowPolyLoDModelURL}`);
      }
      this.setMainMesh(lowPolyModel);

      if (!this.skinnedMesh) {
        console.error("Failed to set character mesh for instancing");
        return null;
      }

      // prepare the single animation clip combining all animations
      await this.loadAnimation();

      if (!this.animationClip) {
        console.error("Failed to load animation for instancing");
        return null;
      }

      // create the instanced mesh
      await this.createInstancedMesh();
      this.setupAnimationOptimization();
      this.addInstances();
      this.initializeSkeletonData();

      return this.instancedMesh;
    } catch (error) {
      console.error("Failed to initialize CharacterInstances:", error);
      return null;
    }
  }

  public spawnInstanceWithCachedColors(
    characterId: number,
    colors: Map<ColorPartName, Color>,
    position: Vect3,
    rotation: EulXYZ,
    animationState: AnimationState,
  ) {
    const animationSegmentName = this.animationStateToSegmentName(animationState);
    this.spawnInstanceWithColors(characterId, colors, position, rotation, animationSegmentName);
  }

  private spawnInstanceWithColors(
    characterId: number,
    colors: Map<ColorPartName, Color>,
    position: Vect3,
    rotation: EulXYZ,
    animationState: string,
  ) {
    if (!this.instancedMesh) {
      throw new Error("CharacterInstances: Cannot spawn instance, mesh not initialized.");
    }

    if (this.characterIdToInstanceIdMap.has(characterId)) {
      throw new Error(
        `CharacterInstances: Character ${characterId} already spawned, ignoring duplicate spawn`,
      );
    }

    const instances = this.instancedMesh.instances!;
    let assigned = false;
    let index = -1;

    const activeCount = instances.filter((inst) => inst.isActive).length;

    for (let i = 0; i < instances.length; i++) {
      const instance = instances[i];

      if (!instance.isActive) {
        instance.position.copy(position);
        instance.position.y -= 0.45;
        instance.quaternion.setFromEuler(new Euler(rotation.x, rotation.y, rotation.z));
        instance.isActive = true;
        instance.isShadowed = false;
        instance.visible = true;

        instance.characterId = characterId;
        this.characterIdToInstanceIdMap.set(characterId, i);

        instance.time = 0;
        instance.animationTime = 0;
        instance.offset = Math.random() * 0.5; // slight time offset to avoid synchronicity
        instance.speed = 1.0;
        instance.currentAnimationState = animationState; // Use provided animation state instead of defaulting to "idle"

        instance.updateMatrix();
        this.updateInstancedMeshBounds();

        assigned = true;
        index = i;
        break;
      }
    }

    if (index !== -1) {
      this.instancedMesh.setMaterialColorsAt(index, {
        hair: colors.get("hair"),
        shirt_short: colors.get("shirt_short"),
        shirt_long: colors.get("shirt_long"),
        pants_short: colors.get("pants_short"),
        pants_long: colors.get("pants_long"),
        shoes: colors.get("shoes"),
        skin: colors.get("skin"),
        lips: colors.get("lips"),
      });
      if (this.instancedMesh.materialColorsTexture) {
        this.instancedMesh.materialColorsTexture.needsUpdate = true;
        this.instancedMesh.materialsNeedsUpdate();
      }
    }

    if (!assigned) {
      throw new Error(
        `CharacterInstances: Failed to spawn instance for character ${characterId}. ${activeCount}/${instances.length} instances active. All instances are in use!`,
      );
    }
  }

  public despawnInstance(characterId: number): void {
    const instanceId = this.characterIdToInstanceIdMap.get(characterId);
    if (this.instancedMesh && instanceId !== undefined) {
      this.instancedMesh.instances![instanceId].isActive = false;
      this.instancedMesh.instances![instanceId].visible = false;
      this.instancedMesh.instances![instanceId].isShadowed = false;
      this.instancedMesh.instances![instanceId].characterId = -1;
      this.instancedMesh.instances![instanceId].instanceId = -1;
      this.instancedMesh.instances![instanceId].updateMatrix();
      this.updateInstancedMeshBounds();
    }
    this.characterIdToInstanceIdMap.delete(characterId);
  }

  /**
   * Shadows an instance instead of fully despawning it. This keeps the instance data
   * intact (including colors) while hiding it when a real character is promoted.
   * This avoids texture updates when the character is later demoted back to an instance.
   */
  public shadowInstance(characterId: number): void {
    const instanceId = this.characterIdToInstanceIdMap.get(characterId);
    if (this.instancedMesh && instanceId !== undefined) {
      const instance = this.instancedMesh.instances![instanceId];
      instance.isShadowed = true;
      instance.visible = false;
      instance.updateMatrix();
      this.updateInstancedMeshBounds();
    }
  }

  /**
   * Reactivates a previously shadowed instance. This is used when a real character
   * is demoted back to an instance, allowing us to reuse the existing instance data
   * and avoid texture updates from creating a new instance.
   */
  public unshadowInstance(characterId: number) {
    const instanceId = this.characterIdToInstanceIdMap.get(characterId);
    if (!this.instancedMesh || instanceId === undefined) {
      throw new Error(
        `CharacterInstances: Cannot unshadow instance for character ${characterId}: not found`,
      );
    }

    const instance = this.instancedMesh.instances![instanceId];
    if (!instance || !instance.isActive) {
      throw new Error(
        `CharacterInstances: Cannot unshadow instance for character ${characterId}: not shadowed`,
      );
    }

    instance.isShadowed = false;
    instance.visible = true;
    instance.updateMatrix();
    this.updateInstancedMeshBounds();
  }

  public getInstanceInfo(): { active: number; total: number; available: number } {
    if (!this.instancedMesh?.instances) {
      return { active: 0, total: 0, available: 0 };
    }

    const active = this.instancedMesh.instances.filter(
      (inst) => inst.isActive && !inst.isShadowed,
    ).length;
    const total = this.instancedMesh.instances.length;
    const available = total - this.instancedMesh.instances.filter((inst) => inst.isActive).length;

    return { active, total, available };
  }

  public updateInstance(
    characterId: number,
    position: Vect3,
    rotation: EulXYZ,
    animationState: AnimationState,
  ): void {
    if (!this.instancedMesh) {
      console.error("CharacterInstances: Cannot update instance, mesh not initialized.");
      return;
    }

    const instanceId = this.characterIdToInstanceIdMap.get(characterId);
    if (instanceId === undefined) {
      console.warn(`CharacterInstances: Instance not found for character ${characterId}`);
      return;
    }

    const instance = this.instancedMesh.instances![instanceId];
    if (!instance || !instance.isActive) {
      console.warn(
        `CharacterInstances: Instance ${instanceId} is not active for character ${characterId}`,
      );
      return;
    }

    // Skip updates for shadowed instances as they're hidden by real characters
    if (instance.isShadowed) {
      return;
    }

    instance.targetPosition.copy(position);
    instance.targetPosition.y -= 0.45;
    instance.targetQuaternion.setFromEuler(new Euler(rotation.x, rotation.y, rotation.z));
    instance.hasNewTarget = true;
    instance.lerpSpeed = 15.0;

    const animationSegmentName = this.animationStateToSegmentName(animationState);

    if (instance.currentAnimationState !== animationSegmentName) {
      if (this.animationSegments.has(animationSegmentName)) {
        instance.currentAnimationState = animationSegmentName;
        instance.animationTime = 0;

        if (this.debug) {
          console.log(
            `Updated character ${characterId} animation from ${instance.currentAnimationState} to ${animationSegmentName}`,
          );
        }
      } else {
        console.warn(
          `CharacterInstances: Unknown animation state: ${animationSegmentName}. Available: ${Array.from(this.animationSegments.keys()).join(", ")}`,
        );
        return;
      }
    }
  }

  public updateInstanceColors(characterId: number, colors: Map<string, Color>) {
    if (!this.instancedMesh) {
      throw new Error("CharacterInstances: Cannot update instance colors, mesh not initialized.");
    }

    const instanceId = this.characterIdToInstanceIdMap.get(characterId);
    if (instanceId === undefined) {
      throw new Error(`CharacterInstances: Instance not found for character ${characterId}`);
    }

    const instance = this.instancedMesh.instances![instanceId];
    if (!instance) {
      throw new Error(
        `CharacterInstances: Instance ${instanceId} is not active for character ${characterId}`,
      );
    }

    // Update the colors using the existing setMaterialColorsAt method
    this.instancedMesh.setMaterialColorsAt(instanceId, {
      hair: colors.get("hair"),
      shirt_short: colors.get("shirt_short"),
      shirt_long: colors.get("shirt_long"),
      pants_short: colors.get("pants_short"),
      pants_long: colors.get("pants_long"),
      shoes: colors.get("shoes"),
      skin: colors.get("skin"),
      lips: colors.get("lips"),
    });

    // Force texture update
    if (this.instancedMesh.materialColorsTexture) {
      this.instancedMesh.materialColorsTexture.needsUpdate = true;
      this.instancedMesh.materialsNeedsUpdate();
    }
  }

  private updateInstancedMeshBounds(): void {
    if (!this.instancedMesh) return;

    try {
      if (this.instancedMesh.geometry) {
        this.instancedMesh.geometry.computeBoundingBox();
        this.instancedMesh.geometry.computeBoundingSphere();
      }

      this.instancedMesh.computeBoundingBox();
      this.instancedMesh.computeBoundingSphere();
      this.instancedMesh.instanceMatrix.needsUpdate = true;
    } catch (error) {
      console.warn("Error updating bounds:", error);
    }
  }

  private setMainMesh(mesh: Object3D): void {
    let originalSkinnedMeshes = 0;
    const originalMaterials: any[] = [];

    mesh.traverse((child) => {
      if (child instanceof SkinnedMesh) {
        originalSkinnedMeshes++;
        if (Array.isArray(child.material)) {
          originalMaterials.push(...child.material);
        } else {
          originalMaterials.push(child.material);
        }
      }
    });

    let mainMesh;
    try {
      mainMesh = SkeletonUtils.clone(mesh);
      let clonedSkinnedMeshes = 0;
      const clonedMaterials: any[] = [];

      mainMesh.traverse((child) => {
        if (child instanceof SkinnedMesh) {
          clonedSkinnedMeshes++;
          if (Array.isArray(child.material)) {
            clonedMaterials.push(...child.material);
          } else {
            clonedMaterials.push(child.material);
          }
        }
      });

      if (this.debug) {
        console.log(
          `SkeletonUtils clone:
          ${clonedSkinnedMeshes} SkinnedMeshes
          ${clonedMaterials.length} materials`,
        );
      }

      if (
        clonedSkinnedMeshes !== originalSkinnedMeshes ||
        clonedMaterials.length !== originalMaterials.length
      ) {
        throw new Error(
          `SkeletonUtils.clone lost parts: ${originalSkinnedMeshes}->${clonedSkinnedMeshes} meshes, ${originalMaterials.length}->${clonedMaterials.length} materials`,
        );
      }
    } catch (error) {
      console.error("SkeletonUtils.clone failed:", error);
      mainMesh = mesh.clone();
    }

    this.characterScale = mesh.scale.x;

    mainMesh.position.set(0, 0, 0);
    mainMesh.rotation.set(0, 0, 0);
    mainMesh.scale.set(1, 1, 1);

    // merge all skinnedMeshes
    const skinnedMeshes: SkinnedMesh[] = [];
    mainMesh.traverse((child) => {
      if (child instanceof SkinnedMesh) {
        skinnedMeshes.push(child);
      }
    });

    if (skinnedMeshes.length === 0) {
      throw new Error("No SkinnedMeshes found after cloning");
    }

    if (skinnedMeshes.length === 1) {
      // single mesh we're done here
      this.skinnedMesh = skinnedMeshes[0];
    } else {
      if (this.debug) {
        console.log(`Merging ${skinnedMeshes.length} SkinnedMeshes into one...`);
      }
      this.skinnedMesh = mergeSkinnedMeshes(skinnedMeshes);
    }

    validateAndCleanSkeleton(this.skinnedMesh);
  }

  private async loadAnimation(): Promise<void> {
    const animationConfig = await this.config.animationsPromise;
    const animationConfigs = {
      idle: animationConfig.idleAnimation,
      walking: animationConfig.jogAnimation,
      running: animationConfig.sprintAnimation,
      air: animationConfig.airAnimation,
      doubleJump: animationConfig.doubleJumpAnimation,
    };

    const individualClips: Map<string, AnimationClip> = new Map();

    for (const [stateName, clip] of Object.entries(animationConfigs)) {
      try {
        individualClips.set(stateName, clip);
        if (this.debug) {
          console.log(`Loaded ${stateName} animation: ${clip.duration.toFixed(3)}s`);
        }
      } catch (error) {
        console.warn(`Failed to load animation ${stateName}:`, error);
      }
    }

    if (individualClips.size === 0) {
      console.error("No animations loaded!");
      return;
    }

    // create a single animation by merging all animations
    const [segments, singleAnimationClip] = createSingleTimeline(individualClips);
    this.animationSegments = segments;
    this.animationClip = singleAnimationClip;

    if (this.animationClip && this.skinnedMesh) {
      // filter tracks for available bones
      const availableBones = new Set<string>();
      for (const bone of this.skinnedMesh.skeleton.bones) {
        availableBones.add(bone.name);
      }

      this.animationClip.tracks = this.animationClip.tracks.filter((track) => {
        const [trackName, trackProperty] = track.name.split(".");

        if (trackName === "root" && trackProperty === "position") {
          return availableBones.has("root");
        }

        return availableBones.has(trackName);
      });

      this.mixer = new AnimationMixer(this.skinnedMesh);
      this.action = this.mixer.clipAction(this.animationClip);
      this.action.play();
      this.animationClip = this.animationClip;

      if (this.debug) {
        console.log(
          `Created single animation timeline with ${this.animationSegments.size} animation segments:`,
        );
        for (const [name, segment] of this.animationSegments.entries()) {
          console.log(
            `  ${name}: ${segment.startTime.toFixed(3)}s - ${segment.endTime.toFixed(3)}s (${segment.duration.toFixed(3)}s)`,
          );
        }
      }
    }
  }

  private async createInstancedMesh(): Promise<void> {
    if (!this.skinnedMesh) return;

    this.instancedMesh = createInstancedMesh2From<InstanceData>(this.skinnedMesh, {
      capacity: this.instanceCount,
      createEntities: true,
    });

    if (this.instancedMesh.boneTexture) {
      this.instancedMesh.boneTexture.partialUpdate = false;
    }

    const materials = Array.isArray(this.instancedMesh.material)
      ? this.instancedMesh.material
      : [this.instancedMesh.material];

    const clonedMaterials = materials.map((material: any) => {
      if (material) {
        const clonedMaterial = material.clone();
        clonedMaterial.name = material.name;
        return clonedMaterial;
      }
      return material;
    });

    if (Array.isArray(this.instancedMesh.material)) {
      this.instancedMesh.material = clonedMaterials;
    } else {
      this.instancedMesh.material = clonedMaterials[0];
    }

    clonedMaterials.forEach((material: any) => {
      if (material) {
        const isClothing = [
          "shirt_short",
          "shirt_long",
          "pants_short",
          "pants_long",
          "shoes",
          "hair",
        ].includes(material.name);

        if (material.color && isClothing) {
          if (this.debug) {
            console.log(`Original color for ${material.name}: #${material.color.getHexString()} `);
            console.log(`Set material color to white for clothing: ${material.name}`);
          }
          material.color.setHex(0xffffff);
        } else {
          if (this.debug) {
            console.log(`Keeping original color for non-clothing material: ${material.name}`);
          }
        }
        material.vertexColors = true;
        material.needsUpdate = true;
      }
    });
  }

  private setupAnimationOptimization(): void {
    this.propertyBindings = ((this.action as any)._propertyBindings as PropertyMixer[]) || [];
    this.interpolants = ((this.action as any)._interpolants as Interpolant[]) || [];

    this.propertyBindingsLOD = [];
    this.interpolantsLOD = [];

    for (let i = 0; i < this.propertyBindings.length; i++) {
      const binding = this.propertyBindings[i];
      if (binding && binding.binding && binding.binding.node) {
        this.propertyBindingsLOD.push(this.propertyBindings[i]);
        this.interpolantsLOD.push(this.interpolants[i]);
      }
    }

    if (this.debug) {
      console.log(`${this.propertyBindings.length} bindings (bones to animate)`);
    }
  }

  private addInstances(): void {
    const rnd = () => Math.random() * 2 - 1;
    const randomColor = () => new Color().setRGB(Math.random(), Math.random(), Math.random());

    this.instancedMesh!.addInstances(
      this.instanceCount,
      (obj: Entity<InstanceData>, index: number) => {
        if (this.startWithHiddenInstances) {
          obj.visible = false;
        } else {
          obj.position
            .set(rnd() * this.spawnRadius, 0, rnd() * this.spawnRadius)
            .divideScalar(this.characterScale);
        }

        obj.time = 0; // animation time
        obj.offset = Math.random() * 0.5; // animation track offset (prevents synchronicity)
        // we should keep it small to avoid boundary issues
        obj.speed = 1.0; // animation speed multiplier
        obj.currentAnimationState = "idle"; // initial animation state
        obj.animationTime = 0; // animation time within the segment

        obj.isActive = !this.startWithHiddenInstances;
        obj.isShadowed = false; // Initialize shadowed state
        obj.characterId = -1; // -1 means no character is assigned yet
        obj.instanceId = index; // instance ID

        obj.skinColor = new Color(...this.immutableColors.skin);
        obj.eyesBlackColor = new Color(...this.immutableColors.eyes_black);
        obj.eyesWhiteColor = new Color(...this.immutableColors.eyes_white);
        obj.lipsColor = new Color(...this.immutableColors.lips);
        obj.hairColor = randomColor();
        obj.shirtColor = randomColor();
        obj.pantsColor = randomColor();
        obj.shoesColor = new Color(...this.immutableColors.shoes);
        obj.shirtShortColor = obj.shirtColor;
        obj.shirtLongColor = obj.shirtColor;
        obj.pantsShortColor = obj.pantsColor;
        obj.pantsLongColor = obj.pantsColor;

        obj.targetPosition = new Vector3();
        obj.targetQuaternion = new Quaternion();
        obj.lerpSpeed = 15.0;
        obj.hasNewTarget = false;

        if (this.instancedMesh) {
          this.instancedMesh.setMaterialColorsAt(index, {
            hair: obj.hairColor,
            shirt_short: obj.shirtShortColor,
            shirt_long: obj.shirtLongColor,
            pants_short: obj.pantsShortColor,
            pants_long: obj.pantsLongColor,
            shoes: obj.shoesColor,
            skin: obj.skinColor,
            lips: obj.lipsColor,
          });
        }
      },
    );
  }

  private initializeSkeletonData(): void {
    if (!this.instancedMesh || !this.mixer || !this.instancedMesh.instances) return;

    for (const instance of this.instancedMesh.instances) {
      this.mixer.setTime(instance.offset);
      instance.updateBones();
    }
  }

  public getPositionForInstance(characterId: number): Vect3 | null {
    const instanceId = this.characterIdToInstanceIdMap.get(characterId);
    if (instanceId === undefined || !this.instancedMesh || !this.instancedMesh.instances) {
      console.warn("CharacterInstances: Mesh or instances not initialized.");
      return null;
    }

    const instance = this.instancedMesh.instances[instanceId];
    if (!instance || !instance.isActive) {
      console.warn(`CharacterInstances: Instance ${instanceId} is not active.`);
      return null;
    }

    return new Vect3(instance.position.x, instance.position.y, instance.position.z);
  }

  private updateAllInstanceLerping(): void {
    if (!this.instancedMesh?.instances) return;

    for (const instance of this.instancedMesh.instances) {
      if (instance.isActive && instance.hasNewTarget) {
        const lerpFactor = Math.min(this.delta * instance.lerpSpeed, 1.0);

        instance.position.lerp(instance.targetPosition, lerpFactor);
        instance.quaternion.slerp(instance.targetQuaternion, lerpFactor);

        if (lerpFactor >= 0.99) {
          instance.hasNewTarget = false;
        }

        instance.updateMatrix();
      }
    }

    this.updateInstancedMeshBounds();
  }

  public update(deltaTime: number, totalTime: number): void {
    if (!this.instancedMesh || !this.mixer || !this.action) return;

    this.delta = deltaTime;

    const camera = this.config.cameraManager.camera;
    camera.updateMatrixWorld();

    this.invMatrixWorld.copy(this.instancedMesh.matrixWorld).invert();
    this.cameraLocalPosition
      .setFromMatrixPosition(camera.matrixWorld)
      .applyMatrix4(this.invMatrixWorld);

    this.updateAllInstanceLerping();
  }

  public setupFrustumCulling(): void {
    if (!this.instancedMesh || !this.mixer || !this.action) return;

    if (this.debug) {
      console.log(`Setting up frustum culling for ${this.instanceCount} instances`);
    }

    const maxFps = 60;
    const minFps = 10;

    this.instancedMesh.onFrustumEnter = (
      index: number,
      camera: any,
      cameraLOD: any,
      LODindex: number,
    ) => {
      if (!this.instancedMesh?.instances) return false;
      const instance = this.instancedMesh.instances[index];

      const cameraDistance =
        this.cameraLocalPosition.distanceTo(instance.position) * this.characterScale;

      const fps = Math.min(maxFps, Math.max(minFps, 60 - cameraDistance * 2));

      instance.time += this.delta;

      // for very close instances (dist < 5), update every frame for smoothness
      const shouldUpdate = cameraDistance < 5 || instance.time >= 1 / fps;

      if (shouldUpdate) {
        // calculate delta since last update for this instance
        const timeSinceLastUpdate = cameraDistance >= 5 ? 1 / fps : this.delta;

        if (cameraDistance >= 5) {
          instance.time %= 1 / fps;
        }

        // get animation segment for instance's current state
        const segment = this.animationSegments.get(instance.currentAnimationState);

        if (segment && this.mixer) {
          // update instance's animation time within the segment
          // all instances have to animate at the same speed regardless of distance
          // they get stuttery when far tho, but that'sok
          instance.animationTime += timeSinceLastUpdate * instance.speed;

          // segment looping
          if (instance.animationTime >= segment.duration) {
            instance.animationTime %= segment.duration;
          }

          // apply offset within the segment duration to prevent leaking into other animations
          const offsetAnimationTime = (instance.animationTime + instance.offset) % segment.duration;

          // absolute time in the single timeline (offset is now contained within the segment)
          const singleTimelineTime = segment.startTime + offsetAnimationTime;

          // hysteresis to prevent rapid switching at boundaries
          const currentMode = this.currentBindingMode;
          const useFullAnimation =
            currentMode === "full"
              ? cameraDistance < 12 // stay in full until distance > 12
              : cameraDistance < 8; // switch to full when distance < 8

          if (useFullAnimation) {
            if (this.currentBindingMode !== "full") {
              (this.mixer as any)._bindings = this.propertyBindings;
              (this.mixer as any)._nActiveBindings = this.propertyBindings.length;
              (this.action as any)._propertyBindings = this.propertyBindings;
              (this.action as any)._interpolants = this.interpolants;
              this.currentBindingMode = "full";
            }
            this.mixer.setTime(singleTimelineTime);
            instance.updateBones();
          } else {
            if (this.currentBindingMode !== "lod") {
              (this.mixer as any)._bindings = this.propertyBindingsLOD;
              (this.mixer as any)._nActiveBindings = this.propertyBindingsLOD.length;
              (this.action as any)._propertyBindings = this.propertyBindingsLOD;
              (this.action as any)._interpolants = this.interpolantsLOD;
              this.currentBindingMode = "lod";
            }
            this.mixer.setTime(singleTimelineTime);
            instance.updateBones(true);
          }
        }
      }

      return true;
    };
  }

  public dispose(): void {
    if (this.instancedMesh) {
      this.instancedMesh = null;
    }
    if (this.mixer) {
      this.mixer.stopAllAction();
      this.mixer = null;
    }
    this.skinnedMesh = null;
  }

  /**
   * Immediately sets an instance position without lerping. Used when unshadowing
   * instances to position them at the real character's last known position.
   */
  public setInstancePositionImmediate(
    characterId: number,
    position: Vect3,
    rotation: EulXYZ,
    animationState: AnimationState,
  ): boolean {
    if (!this.instancedMesh) {
      console.error("CharacterInstances: Cannot set instance position, mesh not initialized.");
      return false;
    }

    const instanceId = this.characterIdToInstanceIdMap.get(characterId);
    if (instanceId === undefined) {
      console.warn(`CharacterInstances: Instance not found for character ${characterId}`);
      return false;
    }

    const instance = this.instancedMesh.instances![instanceId];
    if (!instance || !instance.isActive) {
      console.warn(
        `CharacterInstances: Instance ${instanceId} is not active for character ${characterId}`,
      );
      return false;
    }

    instance.position.copy(position);
    instance.position.y -= 0.45;
    instance.quaternion.setFromEuler(new Euler(rotation.x, rotation.y, rotation.z));
    instance.targetPosition.copy(instance.position); // Set target to current to prevent lerping
    instance.targetQuaternion.copy(instance.quaternion);
    instance.hasNewTarget = false; // No lerping needed

    // Update animation state
    const animationSegmentName = this.animationStateToSegmentName(animationState);
    if (instance.currentAnimationState !== animationSegmentName) {
      if (this.animationSegments.has(animationSegmentName)) {
        instance.currentAnimationState = animationSegmentName;
        instance.animationTime = 0;

        if (this.debug) {
          console.log(
            `Set character ${characterId} animation to ${animationSegmentName} (immediate)`,
          );
        }
      } else {
        console.warn(
          `CharacterInstances: Unknown animation state: ${animationSegmentName}. Available: ${Array.from(this.animationSegments.keys()).join(", ")}`,
        );
      }
    }

    instance.updateMatrix();
    this.updateInstancedMeshBounds();

    return true;
  }
}
