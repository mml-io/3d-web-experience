import { createInstancedMesh2From } from "@three.ez/instanced-mesh";
import {
  AnimationAction,
  AnimationClip,
  AnimationMixer,
  Interpolant,
  Matrix4,
  Object3D,
  PropertyMixer,
  SkinnedMesh,
  Vector3,
} from "three";

import { CameraManager } from "../camera/CameraManager";
import { TimeManager } from "../time/TimeManager";

import { AnimationConfig, CharacterDescription } from "./Character";
import { CharacterModelLoader } from "./CharacterModelLoader";
import { AnimationState } from "./CharacterState";

export type CharacterInstancesConfig = {
  mesh: Object3D;
  animationConfig: AnimationConfig;
  characterModelLoader: CharacterModelLoader;
  cameraManager: CameraManager;
  timeManager: TimeManager;
  instanceCount?: number;
  spawnRadius?: number;
};

export class CharacterInstances {
  private mixer: AnimationMixer | null = null;
  private action: AnimationAction | null = null;
  private instancedMesh: any = null;
  private mainMesh: Object3D | null = null;
  private skinnedMesh: SkinnedMesh | null = null;
  private animationClip: AnimationClip | null = null;

  // anim optimization data
  private propertyBindings: PropertyMixer[] = [];
  private interpolants: Interpolant[] = [];
  private propertyBindingsLOD: PropertyMixer[] = [];
  private interpolantsLOD: Interpolant[] = [];

  // camera frustum culling
  private invMatrixWorld = new Matrix4();
  private cameraLocalPosition = new Vector3();

  private instanceCount: number;
  private spawnRadius: number;

  // bones to exclude from LOD animations
  private excludedBones = new Set([
    // left hand UE5
    "hand_l",
    "thumb_01_l",
    "thumb_02_l",
    "thumb_03_l",
    "thumb_03_l_end",
    "index_metacarpal_l",
    "index_01_l",
    "index_02_l",
    "index_03_l",
    "index_03_l_end",
    "middle_metacarpal_l",
    "middle_01_l",
    "middle_02_l",
    "middle_03_l",
    "middle_03_l_end",
    "ring_metacarpal_l",
    "ring_01_l",
    "ring_02_l",
    "ring_03_l",
    "ring_03_l_end",
    "pinky_metacarpal_l",
    "pinky_01_l",
    "pinky_02_l",
    "pinky_03_l",
    "pinky_03_l_end",

    // right hand UE5
    "hand_r",
    "thumb_01_r",
    "thumb_02_r",
    "thumb_03_r",
    "thumb_03_r_end",
    "index_metacarpal_r",
    "index_01_r",
    "index_02_r",
    "index_03_r",
    "index_03_r_end",
    "middle_metacarpal_r",
    "middle_01_r",
    "middle_02_r",
    "middle_03_r",
    "middle_03_r_end",
    "ring_metacarpal_r",
    "ring_01_r",
    "ring_02_r",
    "ring_03_r",
    "ring_03_r_end",
    "pinky_metacarpal_r",
    "pinky_01_r",
    "pinky_02_r",
    "pinky_03_r",
    "pinky_03_r_end",

    // foot parts (TODO: check if needed. I have no clue so far)
    "ball_l",
    "ball_l_end",
    "ball_r",
    "ball_r_end",

    // IDK what these are TBH
    "lowerarm_twist_01_l",
    "lowerarm_twist_01_l_end",
    "lowerarm_twist_02_l",
    "lowerarm_twist_02_l_end",
    "lowerarm_twist_01_r",
    "lowerarm_twist_01_r_end",
    "lowerarm_twist_02_r",
    "lowerarm_twist_02_r_end",
    "upperarm_twist_01_l",
    "upperarm_twist_01_l_end",
    "upperarm_twist_02_l",
    "upperarm_twist_02_l_end",
    "upperarm_twist_01_r",
    "upperarm_twist_01_r_end",
    "upperarm_twist_02_r",
    "upperarm_twist_02_r_end",
    "thigh_twist_01_l",
    "thigh_twist_01_l_end",
    "thigh_twist_02_l",
    "thigh_twist_02_l_end",
    "thigh_twist_01_r",
    "thigh_twist_01_r_end",
    "thigh_twist_02_r",
    "thigh_twist_02_r_end",
    "calf_twist_01_l",
    "calf_twist_01_l_end",
    "calf_twist_02_l",
    "calf_twist_02_l_end",
    "calf_twist_01_r",
    "calf_twist_01_r_end",
    "calf_twist_02_r",
    "calf_twist_02_r_end",

    // IK prob not needed
    "ik_foot_root",
    "ik_foot_l",
    "ik_foot_l_end",
    "ik_foot_r",
    "ik_foot_r_end",
    "ik_hand_root",
    "ik_hand_gun",
    "ik_hand_l",
    "ik_hand_l_end",
    "ik_hand_r",
    "ik_hand_r_end",

    // ??????
    "interaction",
    "interaction_end",
    "center_of_mass",
    "center_of_mass_end",
  ]);

  constructor(private config: CharacterInstancesConfig) {
    this.instanceCount = config.instanceCount || 100;
    this.spawnRadius = config.spawnRadius || 50;
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
    this.mainMesh = mesh;
    this.mainMesh.traverse((child) => {
      if (child instanceof SkinnedMesh && !this.skinnedMesh) {
        this.skinnedMesh = child;
      }
    });
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
    this.animationClip =
      ((await this.config.characterModelLoader.load(
        this.config.animationConfig.idleAnimationFileUrl,
        "animation",
      )) as AnimationClip) || null;

    if (this.animationClip && this.mainMesh) {
      this.mixer = new AnimationMixer(this.mainMesh);
      this.action = this.mixer.clipAction(this.animationClip);
      this.action.play();
    }
  }

  private async createInstancedMesh(): Promise<void> {
    if (!this.skinnedMesh) return;

    this.instancedMesh = createInstancedMesh2From<{
      time: number;
      speed: number;
      offset: number;
    }>(this.skinnedMesh, {
      capacity: this.instanceCount,
      createEntities: true,
    });

    if (this.instancedMesh.boneTexture) {
      this.instancedMesh.boneTexture.partialUpdate = false;
    }
  }

  private setupAnimationOptimization(): void {
    if (!this.action || !this.mixer) return;

    // get animation bindings for optimization
    this.propertyBindings = ((this.action as any)._propertyBindings as PropertyMixer[]) || [];
    this.interpolants = ((this.action as any)._interpolants as Interpolant[]) || [];

    // simplified bindings removing excluded bones will go here
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

    console.log(
      `
CharacterInstances:
${this.propertyBindings.length} bindings
${this.propertyBindingsLOD.length} LOD bindings
      `,
    );
  }

  private addInstances(): void {
    if (!this.instancedMesh) return;

    this.instancedMesh.addInstances(this.instanceCount, (obj: any, index: number) => {
      // random pos within spawn radius
      obj.position.set(
        (Math.random() * 2 - 1) * this.spawnRadius,
        0,
        (Math.random() * 2 - 1) * this.spawnRadius,
      );

      obj.color = `hsl(${Math.random() * 360}, 50%, 75%)`;
      obj.time = 0;
      obj.offset = Math.random() * 5;
      obj.speed = 0.5 + Math.random() * 3;
    });
  }

  private initializeSkeletonData(): void {
    if (!this.instancedMesh || !this.mixer) return;

    // skeleton data for each instance
    for (const instance of this.instancedMesh.instances) {
      this.mixer.setTime(instance.offset);
      instance.updateBones();
    }
  }

  public update(deltaTime: number, totalTime: number): void {
    if (!this.instancedMesh || !this.mixer || !this.action) return;

    this.updateCameraPosition();

    // frustum culling and animation updates will be handled by the onFrustumEnter cb
    // it is set when the instanced mesh is added to the scene
  }

  private updateCameraPosition(): void {
    if (!this.instancedMesh) return;

    const camera = this.config.cameraManager.camera;
    camera.updateMatrixWorld();

    this.invMatrixWorld.copy(this.instancedMesh.matrixWorld).invert();
    this.cameraLocalPosition
      .setFromMatrixPosition(camera.matrixWorld)
      .applyMatrix4(this.invMatrixWorld);
  }

  public setupFrustumCulling(): void {
    if (!this.instancedMesh || !this.mixer || !this.action) return;

    const maxFps = 60;
    const minFps = 5;
    const timeManager = this.config.timeManager;

    this.instancedMesh.onFrustumEnter = (
      index: number,
      camera: any,
      cameraLOD: any,
      LODindex: number,
    ) => {
      const instance = this.instancedMesh.instances[index];
      const cameraDistance = this.cameraLocalPosition.distanceTo(instance.position);

      // adjust FPS based on distance
      const fps = Math.min(maxFps, Math.max(minFps, 70 - cameraDistance));
      instance.time += timeManager.deltaTime;

      if (instance.time >= 1 / fps) {
        instance.time %= 1 / fps;

        if (LODindex === 0) {
          // full anim
          (this.mixer as any)._bindings = this.propertyBindings;
          (this.mixer as any)._nActiveBindings = this.propertyBindings.length;
          (this.action as any)._propertyBindings = this.propertyBindings;
          (this.action as any)._interpolants = this.interpolants;
          this.mixer!.setTime(timeManager.time * instance.speed + instance.offset);
          instance.updateBones();
        } else {
          // light anim
          (this.mixer as any)._bindings = this.propertyBindingsLOD;
          (this.mixer as any)._nActiveBindings = this.propertyBindingsLOD.length;
          (this.action as any)._propertyBindings = this.propertyBindingsLOD;
          (this.action as any)._interpolants = this.interpolantsLOD;
          this.mixer!.setTime(timeManager.time * instance.speed + instance.offset);
          instance.updateBones(true, this.excludedBones);
        }
      }

      return true;
    };
  }

  public getInstancedMesh(): Object3D | null {
    return this.instancedMesh;
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
