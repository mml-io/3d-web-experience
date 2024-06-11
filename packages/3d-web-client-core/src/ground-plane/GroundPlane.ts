import {
  CanvasTexture,
  FrontSide,
  Group,
  LinearMipMapLinearFilter,
  Mesh,
  MeshStandardMaterial,
  NearestFilter,
  PlaneGeometry,
  RepeatWrapping,
  Texture,
} from "three";

// Create a simple 2x2 checkerboard image
const canvas = document.createElement("canvas");
canvas.width = 2;
canvas.height = 2;
const ctx = canvas.getContext("2d")!;
ctx.fillStyle = "#e0e0e0";
ctx.fillRect(0, 0, 2, 2);
ctx.fillStyle = "#606060";
ctx.fillRect(0, 0, 1, 1);
ctx.fillRect(1, 1, 1, 1);

export class GroundPlane extends Group {
  private readonly floorSize = 210;
  private readonly floorTexture: Texture | null = null;
  private readonly floorGeometry = new PlaneGeometry(this.floorSize, this.floorSize, 1, 1);
  private readonly floorMaterial: MeshStandardMaterial;
  private readonly floorMesh: Mesh | null = null;

  constructor() {
    super();

    this.floorMaterial = new MeshStandardMaterial({
      color: 0xffffff,
      side: FrontSide,
      metalness: 0.05,
      roughness: 0.95,
    });
    this.floorMesh = new Mesh(this.floorGeometry, this.floorMaterial);
    this.floorMesh.receiveShadow = true;
    this.floorMesh.rotation.x = Math.PI * -0.5;
    this.add(this.floorMesh);

    this.floorTexture = new CanvasTexture(canvas);
    this.floorTexture!.wrapS = RepeatWrapping;
    this.floorTexture!.wrapT = RepeatWrapping;
    this.floorTexture!.magFilter = NearestFilter;
    this.floorTexture!.minFilter = LinearMipMapLinearFilter;
    this.floorTexture!.repeat.set(this.floorSize / 1.5, this.floorSize / 1.5);
    this.floorMaterial.map = this.floorTexture;
    this.floorMaterial.needsUpdate = true;
  }
}
