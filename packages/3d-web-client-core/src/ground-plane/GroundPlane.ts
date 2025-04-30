import * as playcanvas from "playcanvas";

/**
 * GroundPlane class that creates a checkered plane using PlayCanvas
 */
export class GroundPlane extends playcanvas.Entity {
  private readonly floorSize = 210;
  private readonly floorTexture: playcanvas.Texture | null = null;

  constructor(app: playcanvas.AppBase) {
    super("GroundPlane", app);

    // Create a simple 2x2 checkerboard texture
    const canvas = document.createElement("canvas");
    canvas.width = 2;
    canvas.height = 2;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#e0e0e0";
    ctx.fillRect(0, 0, 2, 2);
    ctx.fillStyle = "#606060";
    ctx.fillRect(0, 0, 1, 1);
    ctx.fillRect(1, 1, 1, 1);

    // Create a texture from the canvas
    this.floorTexture = new playcanvas.Texture(app.graphicsDevice, {
      minFilter: playcanvas.FILTER_LINEAR_MIPMAP_LINEAR,
      magFilter: playcanvas.FILTER_NEAREST,
      addressU: playcanvas.ADDRESS_REPEAT,
      addressV: playcanvas.ADDRESS_REPEAT,
      width: 2,
      height: 2,
    });

    // Upload the canvas data to the texture
    this.floorTexture.setSource(canvas);

    // Create a material
    const material = new playcanvas.StandardMaterial();
    material.diffuse = new playcanvas.Color(1, 1, 1);
    material.diffuseMap = this.floorTexture;
    material.metalness = 0.05;
    material.gloss = 0.05; // Low gloss (0.05) corresponds to high roughness (0.95)

    // Set texture tiling
    const textureRepeat = this.floorSize / 3;
    material.diffuseMapTiling = new playcanvas.Vec2(textureRepeat, textureRepeat);
    material.update();

    // Add a render component with a plane
    this.addComponent("render", {
      type: "plane",
      material: material,
      castShadows: false,
      receiveShadows: true,
    });

    // Set the plane size
    const renderComponent = this.render as playcanvas.RenderComponent;
    if (
      renderComponent &&
      renderComponent.meshInstances &&
      renderComponent.meshInstances.length > 0
    ) {
      const meshInstance = renderComponent.meshInstances[0];
      if (meshInstance && meshInstance.node) {
        meshInstance.node.setLocalScale(this.floorSize, 1, this.floorSize);
      }
    }
  }
}
