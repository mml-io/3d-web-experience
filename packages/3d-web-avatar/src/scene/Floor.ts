import { CircleGeometry, FrontSide, Mesh, MeshStandardMaterial, Texture } from "three";

import { CheckerTexture } from "./CheckerTexture";

export class Floor {
  public mesh: Mesh;
  private floorGeometry: CircleGeometry | null = null;
  private floorMaterial: MeshStandardMaterial | null = null;
  private floorTexture: Texture | null = null;

  constructor(private size: number) {
    this.floorGeometry = new CircleGeometry(this.size, this.size * 5);
    this.floorMaterial = new MeshStandardMaterial({
      color: 0xffffff,
      side: FrontSide,
      metalness: 0.1,
      roughness: 0.5,
    });
    this.floorTexture = new CheckerTexture(this.size / 1.5, this.size / 1.5).texture;
    this.floorMaterial.map = this.floorTexture;
    this.floorMaterial.needsUpdate = true;
    this.mesh = new Mesh(this.floorGeometry, this.floorMaterial);
    this.mesh.rotation.x = Math.PI * -0.5;
    this.mesh.receiveShadow = true;
  }
}
