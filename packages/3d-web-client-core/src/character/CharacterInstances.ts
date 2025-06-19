import {
  AnimationAction,
  AnimationClip,
  AnimationMixer,
  Bone,
  BufferAttribute,
  BufferGeometry,
  Color,
  Interpolant,
  Material,
  Matrix4,
  NumberKeyframeTrack,
  Object3D,
  PropertyMixer,
  QuaternionKeyframeTrack,
  SkinnedMesh,
  Vector3,
  VectorKeyframeTrack,
} from "three";
import * as BufferGeometryUtils from "three/examples/jsm/utils/BufferGeometryUtils.js";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";

import { CameraManager } from "../camera/CameraManager";
import { TimeManager } from "../time/TimeManager";

import { AnimationConfig } from "./Character";
import { CharacterModelLoader } from "./CharacterModelLoader";
import { createInstancedMesh2From, InstancedMesh2, Entity } from "./instancing";
import { unrealLodBones } from "./unreal-lod-bones";

export type CharacterInstancesConfig = {
  mesh: Object3D;
  animationConfig: AnimationConfig;
  characterModelLoader: CharacterModelLoader;
  cameraManager: CameraManager;
  timeManager: TimeManager;
  instanceCount?: number;
  spawnRadius?: number;
};

export type InstanceData = {
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
};

export class CharacterInstances {
  private mixer: AnimationMixer | null = null;
  private action: AnimationAction | null = null;
  private instancedMesh: InstancedMesh2<InstanceData> | null = null;
  private materialMeshes: Map<string, InstancedMesh2<InstanceData>> = new Map();
  private mainMesh: Object3D | null = null;
  private skinnedMesh: SkinnedMesh | null = null;
  private animationClip: AnimationClip | null = null;

  private propertyBindings: PropertyMixer[] = [];
  private interpolants: Interpolant[] = [];
  private propertyBindingsLOD: PropertyMixer[] = [];
  private interpolantsLOD: Interpolant[] = [];

  private invMatrixWorld = new Matrix4();
  private cameraLocalPosition = new Vector3();

  private delta = 0;
  private total = 0;

  private characterScale = 1;

  private currentBindingMode: "full" | "lod" | null = null;
  private instanceCount: number;
  private spawnRadius: number;

  private excludedBones = new Set(unrealLodBones);

  // frustum culling tracking
  private visibleInstancesThisFrame = new Set<number>();
  private lastFrameVisibleCount = 0;
  private updateCallCount = 0;

  // debug
  private readonly instanceId = Math.random().toString(36).substr(2, 5);

  private immutableColors = {
    skin: [0.8509803921568627, 0.6352941176470588, 0.49411764705882355],
    eyes_black: [0.0, 0.0, 0.0],
    eyes_white: [1.0, 1.0, 1.0],
    lips: [0.788235294117647, 0.43529411764705883, 0.39215686274509803],
    shoes: [0.8666666666666667, 0.8666666666666667, 0.8666666666666667],
  };

  // MEGA-timeline (single merged animation with time segments)
  private megaAnimationClip: AnimationClip | null = null;
  private animationSegments: Map<string, { startTime: number; endTime: number; duration: number }> =
    new Map();

  constructor(private config: CharacterInstancesConfig) {
    this.instanceCount = config.instanceCount || 100;
    this.spawnRadius = config.spawnRadius || 50;
    console.log(`CharacterInstances created with ID: ${this.instanceId}`);
  }

  public async initialize(): Promise<Object3D | null> {
    try {
      this.setMainMesh(this.config.mesh);

      if (!this.mainMesh || !this.skinnedMesh) {
        console.error("Failed to set character mesh for instancing");
        return null;
      }

      await this.loadAnimation();

      if (!this.animationClip) {
        console.error("Failed to load animation for instancing");
        return null;
      }

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

    try {
      this.mainMesh = SkeletonUtils.clone(mesh);

      let clonedSkinnedMeshes = 0;
      const clonedMaterials: any[] = [];

      this.mainMesh.traverse((child) => {
        if (child instanceof SkinnedMesh) {
          clonedSkinnedMeshes++;
          if (Array.isArray(child.material)) {
            clonedMaterials.push(...child.material);
          } else {
            clonedMaterials.push(child.material);
          }
        }
      });

      console.log(
        `SkeletonUtils clone: ${clonedSkinnedMeshes} SkinnedMeshes, ${clonedMaterials.length} materials`,
      );

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
      this.mainMesh = mesh.clone();
    }

    this.characterScale = mesh.scale.x;

    this.mainMesh.position.set(0, 0, 0);
    this.mainMesh.rotation.set(0, 0, 0);
    this.mainMesh.scale.set(1, 1, 1);

    // merge all skinnedMeshes
    const skinnedMeshes: SkinnedMesh[] = [];
    this.mainMesh.traverse((child) => {
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
      console.log(`Merging ${skinnedMeshes.length} SkinnedMeshes into one...`);
      this.skinnedMesh = this.mergeSkinnedMeshes(skinnedMeshes);
    }

    this.validateAndCleanSkeleton();
  }

  private mergeSkinnedMeshes(skinnedMeshes: SkinnedMesh[]): SkinnedMesh {
    const geometries: BufferGeometry[] = [];
    const materials: Material[] = [];
    const skeleton = skinnedMeshes[0].skeleton;

    for (const skinnedMesh of skinnedMeshes) {
      const geometry = skinnedMesh.geometry.clone();

      const materialIndex = materials.length;
      if (Array.isArray(skinnedMesh.material)) {
        materials.push(...skinnedMesh.material);
        for (let i = 0; i < skinnedMesh.material.length; i++) {
          geometry.addGroup(
            0,
            geometry.index ? geometry.index.count : geometry.attributes.position.count,
            materialIndex + i,
          );
        }
      } else {
        materials.push(skinnedMesh.material);
        geometry.addGroup(
          0,
          geometry.index ? geometry.index.count : geometry.attributes.position.count,
          materialIndex,
        );
      }

      geometries.push(geometry);
    }

    const mergedGeometry = BufferGeometryUtils.mergeGeometries(geometries, true);

    if (!mergedGeometry) {
      throw new Error("Failed to merge geometries");
    }

    const mergedMesh = new SkinnedMesh(mergedGeometry, materials);
    mergedMesh.skeleton = skeleton;
    mergedMesh.bindMatrix.copy(skinnedMeshes[0].bindMatrix);
    mergedMesh.bindMatrixInverse.copy(skinnedMeshes[0].bindMatrixInverse);
    mergedMesh.bind(skeleton, mergedMesh.bindMatrix);

    console.log(`Merged into single mesh with ${materials.length} materials`);

    this.addVertexColorsToGeometry(mergedGeometry, materials);

    return mergedMesh;
  }

  private validateAndCleanSkeleton(): void {
    if (!this.skinnedMesh || !this.skinnedMesh.skeleton) {
      throw new Error("No skeleton found in SkinnedMesh");
    }

    const skeleton = this.skinnedMesh.skeleton;
    const nullBoneIndices: number[] = [];
    for (let i = 0; i < skeleton.bones.length; i++) {
      if (!skeleton.bones[i]) {
        nullBoneIndices.push(i);
      }
    }
    if (nullBoneIndices.length > 0) {
      skeleton.bones = skeleton.bones.filter((bone) => bone !== null && bone !== undefined);
      skeleton.update();
    }
  }

  private addVertexColorsToGeometry(geometry: BufferGeometry, materials: Material[]): void {
    const positionAttribute = geometry.getAttribute("position");

    if (!positionAttribute) {
      console.error("No position attribute found in geometry");
      return;
    }

    const vertexCount = positionAttribute.count;
    console.log(`Geometry has ${vertexCount} vertices`);

    const colors = new Float32Array(vertexCount * 3);

    for (let i = 0; i < vertexCount; i++) {
      colors[i * 3] = 1.0; // R
      colors[i * 3 + 1] = 1.0; // G
      colors[i * 3 + 2] = 1.0; // B
    }

    const materialColorCodes = {
      // bin material IDs to be replaced by the final colors on the GPU
      hair: [0.0, 0.0, 0.0],
      shirt_short: [0.0, 0.0, 1.0],
      shirt_long: [0.0, 1.0, 0.0],
      pants_short: [0.0, 1.0, 1.0],
      pants_long: [1.0, 0.0, 0.0],
      shoes: [1.0, 0.0, 1.0],
      skin: [1.0, 1.0, 0.0],
      lips: [1.0, 1.0, 1.0],
      eyes_black: [0.5, 0.0, 0.0],
      eyes_white: [0.0, 0.5, 0.0],
    };

    console.log("Geometry groups:", geometry.groups);
    console.log(
      "Materials:",
      materials.map((m: any) => m.name),
    );

    // apply colors based on groups
    if (geometry.groups && geometry.groups.length > 0) {
      geometry.groups.forEach((group, groupIndex) => {
        const material = materials[group.materialIndex || groupIndex];
        const materialName = material?.name || `material_${groupIndex}`;

        console.log(
          `Processing group ${groupIndex}: material "${materialName}", start: ${group.start}, count: ${group.count}`,
        );

        const materialColor = materialColorCodes[
          materialName as keyof typeof materialColorCodes
        ] || [1.0, 1.0, 1.0];
        console.log(
          `Using ID color [${materialColor.join(", ")}] for material "${materialName}" (${materialColor[0] === 1.0 && materialColor[1] === 1.0 && materialColor[2] === 0.0 ? "YELLOW=SKIN" : materialColor[0] === 0.0 && materialColor[1] === 0.0 && materialColor[2] === 1.0 ? "BLUE=SHIRT" : "OTHER"})`,
        );

        const indexAttribute = geometry.getIndex();
        if (indexAttribute) {
          for (let i = group.start; i < group.start + group.count; i++) {
            const vertexIndex = indexAttribute.getX(i);
            colors[vertexIndex * 3] = materialColor[0];
            colors[vertexIndex * 3 + 1] = materialColor[1];
            colors[vertexIndex * 3 + 2] = materialColor[2];
          }
        } else {
          const startVertex = group.start / 3;
          const vertexCount = group.count / 3;
          for (let i = 0; i < vertexCount; i++) {
            const vertexIndex = startVertex + i;
            colors[vertexIndex * 3] = materialColor[0];
            colors[vertexIndex * 3 + 1] = materialColor[1];
            colors[vertexIndex * 3 + 2] = materialColor[2];
          }
        }
      });
    } else {
      console.warn("No geometry groups found, using single material coloring");
    }

    geometry.setAttribute("color", new BufferAttribute(colors, 3));
    console.log(`Added per-material vertex colors to ${vertexCount} vertices`);
  }

  private createMegaTimeline(individualClips: Map<string, AnimationClip>): void {
    const segments: Array<{
      name: string;
      clip: AnimationClip;
      startTime: number;
      endTime: number;
      duration: number;
    }> = [];
    let currentTime = 0;

    // small gap between animations to prevent (maybe we'd have blending issues?)
    const gap = 0.1;

    // segments for each animation
    for (const [name, clip] of individualClips.entries()) {
      const startTime = currentTime;
      const duration = clip.duration;
      const endTime = startTime + duration;

      segments.push({ name, clip, startTime, endTime, duration });
      this.animationSegments.set(name, { startTime, endTime, duration });

      currentTime = endTime + gap;
    }

    // create the tracks
    const megaTracks: any[] = [];
    const totalDuration = currentTime - gap;

    // name 'em all from the respective clips
    const allTrackNames = new Set<string>();
    for (const segment of segments) {
      for (const track of segment.clip.tracks) {
        allTrackNames.add(track.name);
      }
    }

    // create a merged track for each
    for (const trackName of allTrackNames) {
      const mergedTimes: number[] = [];
      const mergedValues: number[] = [];
      let valueSize = 0;

      for (const segment of segments) {
        // find the track in this segment's clip
        const track = segment.clip.tracks.find((t) => t.name === trackName);

        if (track) {
          valueSize = track.getValueSize();

          // add track's keyframes, offset by the segment's start time
          for (let i = 0; i < track.times.length; i++) {
            const offsetTime = track.times[i] + segment.startTime;
            mergedTimes.push(offsetTime);

            // copy the values for the keyframe
            for (let j = 0; j < valueSize; j++) {
              mergedValues.push(track.values[i * valueSize + j]);
            }
          }
        } else {
          // here the track doesn't exist in the segment, so we'll use identity/default
          // values
          const defaultValues = this.getDefaultTrackValues(trackName, valueSize || 3);

          // start of segment
          mergedTimes.push(segment.startTime);
          mergedValues.push(...defaultValues);
          // end of segment
          mergedTimes.push(segment.endTime);
          mergedValues.push(...defaultValues);
        }
      }

      // create the merged track
      if (mergedTimes.length > 0 && valueSize > 0) {
        const TrackType = this.getTrackTypeFromName(trackName);
        const mergedTrack = new TrackType(trackName, mergedTimes, mergedValues);
        megaTracks.push(mergedTrack);
      }
    }
    // create the MEGA animation clip (everything is cooler when you call it mega-something)
    this.megaAnimationClip = new AnimationClip("MegaTimeline", totalDuration, megaTracks);
  }

  private getDefaultTrackValues(trackName: string, valueSize: number): number[] {
    const [, property] = trackName.split(".");
    if (property === "position") {
      return [0, 0, 0];
    } else if (property === "quaternion") {
      return [0, 0, 0, 1];
    } else if (property === "scale") {
      return [1, 1, 1];
    }
    return new Array(valueSize).fill(0);
  }

  private getTrackTypeFromName(trackName: string): any {
    const [, property] = trackName.split(".");
    if (property === "position") {
      return VectorKeyframeTrack;
    } else if (property === "quaternion") {
      return QuaternionKeyframeTrack;
    } else if (property === "scale") {
      return VectorKeyframeTrack;
    }
    return NumberKeyframeTrack;
  }

  public listAllBoneNames(): string[] {
    const boneNames: string[] = [];
    if (!this.mainMesh) {
      console.log("no main mesh available");
      return boneNames;
    }
    this.mainMesh.traverse((child) => {
      if (child.type === "Bone") {
        boneNames.push(child.name);
      }
    });
    return boneNames;
  }

  private async loadAnimation(): Promise<void> {
    if (!this.mainMesh) return;

    const animationConfigs = {
      idle: this.config.animationConfig.idleAnimationFileUrl,
      walking: this.config.animationConfig.jogAnimationFileUrl,
      running: this.config.animationConfig.sprintAnimationFileUrl,
      air: this.config.animationConfig.airAnimationFileUrl,
      doubleJump: this.config.animationConfig.doubleJumpAnimationFileUrl,
    };

    const individualClips: Map<string, AnimationClip> = new Map();

    for (const [stateName, url] of Object.entries(animationConfigs)) {
      try {
        const clip = (await this.config.characterModelLoader.load(
          url,
          "animation",
        )) as AnimationClip;
        if (clip) {
          individualClips.set(stateName, clip);
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

    // create the MEGAtimeline by merging all animations
    this.createMegaTimeline(individualClips);

    if (this.megaAnimationClip && this.mainMesh) {
      // filter tracks for available bones
      const availableBones = new Set<string>();
      this.mainMesh.traverse((child) => {
        const asBone = child as Bone;
        if (asBone.isBone) {
          availableBones.add(child.name);
        }
      });

      this.megaAnimationClip.tracks = this.megaAnimationClip.tracks.filter((track) => {
        const [trackName, trackProperty] = track.name.split(".");

        if (trackName === "root" && trackProperty === "position") {
          return availableBones.has("root");
        }

        return availableBones.has(trackName) && !this.excludedBones.has(trackName);
      });

      this.mixer = new AnimationMixer(this.mainMesh);
      this.action = this.mixer.clipAction(this.megaAnimationClip);
      this.action.play();
      this.animationClip = this.megaAnimationClip;

      console.log(`Created mega-timeline with ${this.animationSegments.size} animation segments:`);
      for (const [name, segment] of this.animationSegments.entries()) {
        console.log(
          `  ${name}: ${segment.startTime.toFixed(3)}s - ${segment.endTime.toFixed(3)}s (${segment.duration.toFixed(3)}s)`,
        );
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
          console.log(`Original color for ${material.name}: #${material.color.getHexString()} `);
          material.color.setHex(0xffffff);
          console.log(`Set material color to white for clothing: ${material.name}`);
        } else {
          console.log(`Keeping original color for non-clothing material: ${material.name}`);
        }
        material.vertexColors = true;
        material.needsUpdate = true;
      }
    });
  }

  private setupAnimationOptimization(): void {
    if (!this.action || !this.mixer) return;

    this.propertyBindings = ((this.action as any)._propertyBindings as PropertyMixer[]) || [];
    this.interpolants = ((this.action as any)._interpolants as Interpolant[]) || [];

    this.propertyBindingsLOD = [];
    this.interpolantsLOD = [];

    for (let i = 0; i < this.propertyBindings.length; i++) {
      const binding = this.propertyBindings[i];
      if (binding && binding.binding && binding.binding.node) {
        const boneName = binding.binding.node.name as string;

        if (!this.excludedBones.has(boneName)) {
          this.propertyBindingsLOD.push(this.propertyBindings[i]);
          this.interpolantsLOD.push(this.interpolants[i]);
        }
      }
    }

    console.log(`${this.propertyBindings.length} bindings (bones to animate)`);
  }

  private addInstances(): void {
    if (!this.instancedMesh) return;

    const rnd = () => Math.random() * 2 - 1;
    const randomColor = () => new Color().setRGB(Math.random(), Math.random(), Math.random());

    this.instancedMesh.addInstances(
      this.instanceCount,
      (obj: Entity<InstanceData>, index: number) => {
        obj.position
          .set(rnd() * this.spawnRadius, 0, rnd() * this.spawnRadius)
          .divideScalar(this.characterScale);

        obj.time = 0;
        obj.offset = Math.random() * 5;
        obj.speed = 1.0;
        obj.currentAnimationState = "idle";
        obj.animationTime = 0;

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

    if (this.instancedMesh.materialColorsTexture) {
      this.addTextureToDOM(this.instancedMesh.materialColorsTexture);
    } else {
      console.error("MaterialColorsTexture was NOT created!");
    }

    // TODO: remove this stupid test before pushing to the rem branch!!!!
    setTimeout(() => this.testPerInstanceColoring(), 3000);

    // test MEGAtimeline animation switching
    setTimeout(() => this.testMegaTimelineAnimations(), 500);
  }

  private initializeSkeletonData(): void {
    if (!this.instancedMesh || !this.mixer || !this.instancedMesh.instances) return;

    for (const instance of this.instancedMesh.instances) {
      this.mixer.setTime(instance.offset);
      (instance as any).updateBones();
    }
  }

  public update(deltaTime: number, totalTime: number): void {
    if (!this.instancedMesh || !this.mixer || !this.action) return;

    this.updateCallCount++;

    if (this.updateCallCount % 120 === 0) {
      const instancesString = `visibleInstances: ${this.lastFrameVisibleCount}/${this.instanceCount}`;
      const percentString = `(${Math.round((this.lastFrameVisibleCount / this.instanceCount) * 100)}%)`;
      console.log(`Frustum Culling ${instancesString} ${percentString}`);
    }

    this.delta = deltaTime;
    this.total = totalTime;

    const camera = this.config.cameraManager.camera;
    camera.updateMatrixWorld();

    this.invMatrixWorld.copy(this.instancedMesh.matrixWorld).invert();
    this.cameraLocalPosition
      .setFromMatrixPosition(camera.matrixWorld)
      .applyMatrix4(this.invMatrixWorld);

    this.lastFrameVisibleCount = this.visibleInstancesThisFrame.size;
    this.visibleInstancesThisFrame.clear();
  }

  public setupFrustumCulling(): void {
    if (!this.instancedMesh || !this.mixer || !this.action) return;

    console.log(`Setting up frustum culling for ${this.instanceCount} instances`);

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

      this.visibleInstancesThisFrame.add(index);

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

          // absolute time in the mega-timeline
          const megaTimelineTime = segment.startTime + instance.animationTime + instance.offset;

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
            this.mixer.setTime(megaTimelineTime);
            (instance as any).updateBones();
          } else {
            if (this.currentBindingMode !== "lod") {
              (this.mixer as any)._bindings = this.propertyBindingsLOD;
              (this.mixer as any)._nActiveBindings = this.propertyBindingsLOD.length;
              (this.action as any)._propertyBindings = this.propertyBindingsLOD;
              (this.action as any)._interpolants = this.interpolantsLOD;
              this.currentBindingMode = "lod";
            }
            this.mixer.setTime(megaTimelineTime);
            (instance as any).updateBones(true, this.excludedBones);
          }
        }
      }

      return true;
    };
  }

  private testPerInstanceColoring(): void {
    if (!this.instancedMesh) {
      console.warn("Cannot test per-instance coloring: instancedMesh not initialized");
      return;
    }

    if (this.instancedMesh.instances && this.instancedMesh.instances.length > 0) {
      this.instancedMesh.setMaterialColorsAt(0, {
        hair: new Color(1, 0, 0),
        shirt_short: new Color(0, 1, 0),
        pants_short: new Color(0, 0, 1),
        shoes: new Color(1, 1, 0),
        skin: new Color(1, 0, 0),
        lips: new Color(...this.immutableColors.lips),
      });
    }

    if (this.instancedMesh.instances && this.instancedMesh.instances.length > 1) {
      this.instancedMesh.setMaterialColorsAt(1, {
        hair: new Color(0, 0, 1),
        shirt_short: new Color(1, 0, 1),
        pants_short: new Color(1, 0.5, 0),
        shoes: new Color(0, 1, 1),
        skin: new Color(...this.immutableColors.skin),
        lips: new Color(...this.immutableColors.lips),
      });
    }

    if (this.instancedMesh.instances && this.instancedMesh.instances.length > 2) {
      this.instancedMesh.setMaterialColorsAt(2, {
        hair: new Color(0.5, 0.3, 0.1),
        shirt_short: new Color(1, 1, 1),
        pants_short: new Color(0.2, 0.2, 0.8),
        shoes: new Color(0.1, 0.1, 0.1),
        skin: new Color(...this.immutableColors.skin),
        lips: new Color(...this.immutableColors.lips),
      });
    }

    this.verifyMaterialColors();
  }

  private verifyMaterialColors(): void {
    if (!this.instancedMesh) return;
    for (let i = 0; i < Math.min(3, this.instancedMesh.instancesCount); i++) {
      const colors = this.instancedMesh.getMaterialColorsAt(i);
      if (colors) {
        console.log(`Instance ${i} material colors:`, {
          hair: colors.hair.getHexString(),
          shirt_short: colors.shirt_short.getHexString(),
          pants_short: colors.pants_short.getHexString(),
          shoes: colors.shoes.getHexString(),
          skin: colors.skin.getHexString(),
          lips: colors.lips.getHexString(),
        });
      } else {
        console.error(`Could not retrieve colors for instance ${i}`);
      }
    }
  }

  private testMegaTimelineAnimations(): void {
    if (!this.instancedMesh?.instances) {
      console.warn("Cannot test mega-timeline animations: instancedMesh not initialized");
      return;
    }
    console.log("Testing mega-timeline animation switching...");
    console.log("Available animation segments:", Array.from(this.animationSegments.keys()));
    const testInstances = Math.min(5, this.instancedMesh.instances.length);

    for (let i = 0; i < testInstances; i++) {
      const animations = ["idle", "walking", "running", "air"];
      const randomAnimation = animations[i % animations.length];

      console.log(`Setting instance ${i} to animation: ${randomAnimation}`);
      this.setInstanceAnimationState(i, randomAnimation);
    }

    // scheduling more changes to check runtime switching
    setTimeout(() => {
      console.log("Switching animations again...");
      for (let i = 0; i < testInstances; i++) {
        const animations = ["running", "air", "idle", "walking"];
        const newAnimation = animations[i % animations.length];

        console.log(`Switching instance ${i} to: ${newAnimation}`);
        this.setInstanceAnimationState(i, newAnimation);
      }
    }, 10000);
  }

  public setInstanceAnimationState(instanceIndex: number, animationState: string): void {
    if (!this.instancedMesh?.instances || instanceIndex >= this.instancedMesh.instances.length) {
      console.warn(`Invalid instance index: ${instanceIndex}`);
      return;
    }

    if (!this.animationSegments.has(animationState)) {
      console.warn(
        `Unknown animation state: ${animationState}. Available: ${Array.from(this.animationSegments.keys()).join(", ")}`,
      );
      return;
    }

    const instance = this.instancedMesh.instances[instanceIndex];
    if (instance.currentAnimationState !== animationState) {
      instance.currentAnimationState = animationState;
      instance.animationTime = 0; // Reset animation time when changing states
      console.log(`Instance ${instanceIndex} animation changed to: ${animationState}`);
    }
  }

  public getInstanceAnimationState(instanceIndex: number): string | null {
    if (!this.instancedMesh?.instances || instanceIndex >= this.instancedMesh.instances.length) {
      return null;
    }
    return this.instancedMesh.instances[instanceIndex].currentAnimationState;
  }

  public getAvailableAnimationStates(): string[] {
    return Array.from(this.animationSegments.keys());
  }

  public getAnimationSegments(): Map<
    string,
    { startTime: number; endTime: number; duration: number }
  > {
    return new Map(this.animationSegments);
  }

  private addTextureToDOM(texture: any): void {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    if (!ctx) {
      console.error("could not get canvas context");
      return;
    }

    const size = texture.image.width;
    canvas.width = size;
    canvas.height = size;

    const imageData = ctx.createImageData(size, size);
    const data = texture._data;

    for (let i = 0; i < data.length; i += 4) {
      const pixelIndex = i;
      imageData.data[pixelIndex] = Math.floor(data[i] * 255); // R
      imageData.data[pixelIndex + 1] = Math.floor(data[i + 1] * 255); // G
      imageData.data[pixelIndex + 2] = Math.floor(data[i + 2] * 255); // B
      imageData.data[pixelIndex + 3] = Math.floor(data[i + 3] * 255); // A
    }

    ctx.putImageData(imageData, 0, 0);

    const container = document.createElement("div");
    container.style.position = "fixed";
    container.style.top = "10px";
    container.style.left = "10px";
    container.style.zIndex = "99999999";
    container.style.background = "rgba(0,0,0,0.8)";
    container.style.padding = "10px";
    container.style.borderRadius = "5px";
    container.style.border = "2px solid #00ff00";

    const title = document.createElement("div");
    title.textContent = `LoD impostors texture (${texture.image.width}x${texture.image.height})`;
    title.style.color = "white";
    title.style.fontSize = "12px";
    title.style.marginBottom = "5px";
    title.style.fontFamily = "monospace";

    const legend = document.createElement("div");
    legend.innerHTML = `
      <div style="color: white; font-size: 10px; font-family: monospace;">
        texture packing: 46 instances per row. 8 pixels per instance<br/>
        Order: Hair, Shirt_S, Shirt_L, Pants_S, Pants_L, Shoes, Skin, Lips
      </div>
    `;

    canvas.style.imageRendering = "pixelated";
    canvas.style.width = `${size * 2}px`;
    canvas.style.height = `${size * 2}px`;
    canvas.style.border = "1px solid #666";

    container.appendChild(title);
    container.appendChild(legend);
    container.appendChild(canvas);

    const closeBtn = document.createElement("button");
    closeBtn.textContent = "✕";
    closeBtn.style.position = "absolute";
    closeBtn.style.top = "5px";
    closeBtn.style.right = "5px";
    closeBtn.style.background = "#ff0000";
    closeBtn.style.color = "white";
    closeBtn.style.border = "none";
    closeBtn.style.borderRadius = "3px";
    closeBtn.style.cursor = "pointer";
    closeBtn.style.fontSize = "12px";
    closeBtn.style.width = "20px";
    closeBtn.style.height = "20px";
    closeBtn.onclick = () => container.remove();

    container.appendChild(closeBtn);
    document.body.appendChild(container);
  }

  public dispose(): void {
    if (this.instancedMesh) {
      this.instancedMesh = null;
    }
    if (this.mixer) {
      this.mixer.stopAllAction();
      this.mixer = null;
    }
    this.mainMesh = null;
    this.skinnedMesh = null;
  }
}
