import {
  CircleGeometry,
  DataTexture,
  FrontSide,
  Group,
  LinearMipmapLinearFilter,
  Mesh,
  MeshStandardMaterial,
  MeshStandardMaterialParameters,
  NearestFilter,
  RGBAFormat,
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
  private tileXSize = this.floorSize / 5;
  private tileYSize = this.floorSize / 5;
  private readonly textureFactory = new CheckerTexture(this.tileXSize, this.tileYSize, 2, 30, 8);
  private readonly floorTexture: Texture = this.textureFactory.texture;
  private readonly floorNormalTexture: Texture = this.textureFactory.normalMapTexture;
  private readonly floorGeometry = new CircleGeometry(this.floorSize, this.floorSize);
  private readonly floorMaterial: MeshStandardMaterial;
  private readonly floorMesh: Mesh | null = null;

  constructor() {
    super();

    this.floorMaterial = new RandomizedTileMaterial(this.tileXSize, this.tileYSize, {
      color: 0xffffff,
      side: FrontSide,
      metalness: 0.4,
      roughness: 0.6,
      map: this.floorTexture,
      metalnessMap: this.floorTexture,
      normalMap: this.floorNormalTexture,
    });
    this.floorMesh = new Mesh(this.floorGeometry, this.floorMaterial);
    this.floorMesh.receiveShadow = true;
    this.floorMesh.rotation.x = Math.PI * -0.5;
    this.add(this.floorMesh);
  }
}
