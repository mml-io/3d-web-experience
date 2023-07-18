import { PerspectiveCamera, Vector3 } from "three";




  public readonly camera: PerspectiveCamera;
  private dragging: boolean = false;
  private target: Vector3 = new Vector3(0, 1.55, 0);
  private targetDistance: number;
  private maxTargetDistance: number = 20;
  private distance: number;
  private targetPhi: number | null = Math.PI / 2;
  private phi: number | null = Math.PI / 2;
  private targetTheta: number | null = -Math.PI / 2;
  private theta: number | null = -Math.PI / 2;
  private hadTarget: boolean = false;












    window.addEventListener("resize", this.onResize.bind(this));


  private onResize(): void {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();


  private onMouseDown(_event: MouseEvent): void {
    this.dragging = true;


  private onMouseUp(_event: MouseEvent): void {
    this.dragging = false;
  }

  private onMouseMove(event: MouseEvent): void {
    if (!this.dragging) {
      return;
    }
    if (this.targetTheta === null || this.targetPhi === null) {
      return;
    }






  private onMouseWheel(event: WheelEvent): void {






  public setTarget(target: THREE.Vector3): void {

    if (!this.hadTarget) {
      this.hadTarget = true;
      this.reverseUpdateFromPositions();
    }


  private reverseUpdateFromPositions(): void {












  public update(): void {
    if (this.target === null) {
      return;
    }







      this.distance = Math.min(this.distance, this.maxTargetDistance);












