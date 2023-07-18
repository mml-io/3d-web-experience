import { AnimationState } from "@mml-playground/character-network";










import { CharacterDescription } from "./Character";
import { CharacterMaterial } from "./CharacterMaterial";
import { ModelLoader } from "./ModelLoader";





  public material: CharacterMaterial = new CharacterMaterial();



  public currentAnimation: AnimationState = AnimationState.idle;

  constructor(private readonly characterDescription: CharacterDescription) {}

  public async init(): Promise<void> {
    await this.loadMainMesh();
    await this.setAnimationFromFile(
      this.characterDescription.idleAnimationFileUrl,
      AnimationState.idle,
    );
    await this.setAnimationFromFile(
      this.characterDescription.jogAnimationFileUrl,
      AnimationState.walking,
    );
    await this.setAnimationFromFile(
      this.characterDescription.sprintAnimationFileUrl,
      AnimationState.running,
    );
    this.applyMaterialToAllSkinnedMeshes(this.material);


  public updateAnimation(targetAnimation: AnimationState, deltaTime: number) {
    if (this.currentAnimation !== targetAnimation) {
      this.transitionToAnimation(targetAnimation);
    }
    this.animationMixer?.update(deltaTime);


  public hideMaterialByMeshName(meshName: any): void {












  private setShadows(
    mesh: Object3D,
    castShadow: boolean = true,
    receiveShadow: boolean = true,
  ): void {
    mesh.traverse((child: Object3D) => {
      if (child.type === "SkinnedMesh") {
        child.castShadow = castShadow;
        child.receiveShadow = receiveShadow;
      }
    });
  }

  private applyMaterialToAllSkinnedMeshes(material: any): void {








  private initAnimationMixer() {




  private async loadMainMesh(): Promise<void> {
















  private async setAnimationFromFile(

    animationType: AnimationState,







        if (animationType === AnimationState.idle) {
          this.animations[animationType].play();
        }







  private transitionToAnimation(
    targetAnimation: AnimationState,
    transitionDuration: number = 0.21,
  ): void {





















