import { AnimationState, CharacterNetworkClientUpdate } from "@mml-playground/character-network";
import {
  AnimationAction,
  AnimationClip,
  AnimationMixer,
  LoadingManager,
  Object3D,
  Quaternion,
  Vector3,
} from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

import { Character } from "./Character";

export class RemoteController {

  private loadManager: LoadingManager = new LoadingManager();


  private animations = new Map<AnimationState, AnimationAction>();
  public currentAnimation: AnimationState = AnimationState.idle;




  public networkState: CharacterNetworkClientUpdate = {

    position: { x: 0, y: 0, z: 0 },
    rotation: { quaternionY: 0, quaternionW: 0 },



  constructor(public readonly character: Character, public readonly id: number) {
    this.characterModel = this.character.model!.mesh!;



  public update(clientUpdate: CharacterNetworkClientUpdate, time: number, deltaTime: number): void {
    if (!this.character) return;
    this.character.update(time);
    this.updateFromNetwork(clientUpdate);
    this.animationMixer.update(deltaTime);
  }

  public setAnimationFromFile(animationType: AnimationState, fileName: string): void {











          const animationAction = this.animationMixer.clipAction(animation);
          this.animations.set(animationType, animationAction);
          if (animationType === AnimationState.idle) {
            animationAction.play();
          }


        (error) => console.error(`Error loading ${animationFile}: ${error}`),






          const animationAction = this.animationMixer.clipAction(animation);
          this.animations.set(animationType, animationAction);
          if (animationType === AnimationState.idle) {
            animationAction.play();
          }


        (error) => console.error(`Error loading ${animationFile}: ${error}`),




  private transitionToAnimation(
    targetAnimation: AnimationState,
    transitionDuration: number = 0.21,
  ): void {


    const currentAction = this.animations.get(this.currentAnimation);
    const targetAction = this.animations.get(targetAnimation);





      targetAction
        .reset()
        .setEffectiveTimeScale(1)
        .setEffectiveWeight(1)
        .fadeIn(transitionDuration)
        .play();








  private updateFromNetwork(clientUpdate: CharacterNetworkClientUpdate): void {

    const { position, rotation, state } = clientUpdate;
    this.characterModel.position.lerp(new Vector3(position.x, position.y, position.z), 0.2);
    const rotationQuaternion = new Quaternion(0, rotation.quaternionY, 0, rotation.quaternionW);
    this.characterModel.quaternion.slerp(rotationQuaternion, 0.2);





