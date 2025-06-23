import {
  AmbientLight,
  Bone,
  Box3,
  Camera,
  Color,
  Object3D,
  OrthographicCamera,
  Scene,
  SkinnedMesh,
  Vector2,
  Vector3,
  WebGLRenderer,
  WebGLRenderTarget,
} from "three";

import { SquareDataTexture } from "./instancing";

function listAllBoneNames(obj: SkinnedMesh): string[] {
  const boneNames: string[] = [];
  if (!obj) {
    console.log("no main mesh available");
    return boneNames;
  }
  for (const bone of obj.skeleton.bones) {
    boneNames.push(bone.name);
  }
  return boneNames;
}
export function captureCharacterColors(characterMesh: SkinnedMesh): Map<string, Color> {
  console.log("starting character color capture");
  console.log("characterMesh provided:", !!characterMesh);

  // temporary scene for rendering the character
  const scene = new Scene();
  scene.add(characterMesh.clone());
  scene.add(new AmbientLight(0xffffff, 5));

  // camera in front of the character
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);
  const box = new Box3().setFromObject(characterMesh);
  const center = box.getCenter(new Vector3());
  const size = box.getSize(new Vector3());

  camera.position.set(center.x, center.y + size.y * 0.1, center.z + size.z * 2);
  camera.lookAt(center);

  // temporary renderer
  const canvas = document.createElement("canvas");
  const renderer = new WebGLRenderer({
    canvas,
    preserveDrawingBuffer: true,
    alpha: true,
  });

  const renderSize = 512;
  renderer.setSize(renderSize, renderSize);

  // render target to capture pixels
  const renderTarget = new WebGLRenderTarget(renderSize, renderSize);

  const sampledColors = new Map<string, Color>();
  try {
    renderer.setRenderTarget(renderTarget);
    renderer.render(scene, camera);
    const pixels = new Uint8Array(renderSize * renderSize * 4);
    renderer.readRenderTargetPixels(renderTarget, 0, 0, renderSize, renderSize, pixels);

    const flippedPixels = new Uint8Array(pixels.length);

    for (let y = 0; y < renderSize; y++) {
      for (let x = 0; x < renderSize; x++) {
        const srcIndex = (y * renderSize + x) * 4;
        const dstY = renderSize - y - 1;
        const dstIndex = (dstY * renderSize + x) * 4;

        flippedPixels[dstIndex] = pixels[srcIndex];
        flippedPixels[dstIndex + 1] = pixels[srcIndex + 1];
        flippedPixels[dstIndex + 2] = pixels[srcIndex + 2];
        flippedPixels[dstIndex + 3] = pixels[srcIndex + 3];
      }
    }

    pixels.set(flippedPixels);

    const boneRegions = getBoneRegionsForColorSampling(characterMesh, camera, renderSize);
    createDebugCanvas(pixels, renderSize, "Character Screenshot", boneRegions);

    console.log(`found ${boneRegions.length} bone regions to sample`);

    for (const region of boneRegions) {
      const avgColor = sampleCircularRegion(pixels, region.screenPos, region.radius, renderSize);
      console.log(
        `${region.name} at (${region.screenPos.x}, ${region.screenPos.y}): rgb(${avgColor.r}, ${avgColor.g}, ${avgColor.b}) - #${avgColor.r.toString(16).padStart(2, "0")}${avgColor.g.toString(16).padStart(2, "0")}${avgColor.b.toString(16).padStart(2, "0")}`,
      );

      const materialColor = new Color().setRGB(
        avgColor.r / 255,
        avgColor.g / 255,
        avgColor.b / 255,
      );

      if (region.name === "Hair/Head Top") {
        sampledColors.set("hair", materialColor);
      } else if (region.name === "Face/Chin") {
        sampledColors.set("skin", materialColor);
        // slightly darker for lips???
        sampledColors.set("lips", materialColor.clone().multiplyScalar(0.8));
      } else if (region.name === "Chest") {
        sampledColors.set("shirt_short", materialColor);
        sampledColors.set("shirt_long", materialColor);
      } else if (region.name === "Left Thigh" || region.name === "Right Thigh") {
        if (!sampledColors.has("pants_short")) {
          sampledColors.set("pants_short", materialColor);
        }
      } else if (region.name === "Left Shin" || region.name === "Right Shin") {
        if (!sampledColors.has("pants_long")) {
          sampledColors.set("pants_long", materialColor);
        }
      } else if (region.name === "Left Foot" || region.name === "Right Foot") {
        if (!sampledColors.has("shoes")) {
          sampledColors.set("shoes", materialColor);
        }
      }
    }
  } catch (error) {
    console.error("error capturing character colors:", error);
  } finally {
    renderer.setRenderTarget(null);
    renderTarget.dispose();
    renderer.dispose();
    scene.remove(characterMesh);
  }

  console.log("character color capture completed!");
  return sampledColors;
}

function findBoneCenter(bone: Bone): Vector3 {
  const boneStart = new Vector3();
  bone.getWorldPosition(boneStart);

  // if bone has child bones we'll use the first child as the end point
  const childBones = bone.children.filter((child) => child instanceof Bone) as Bone[];
  if (childBones.length > 0) {
    const boneEnd = new Vector3();
    childBones[0].getWorldPosition(boneEnd);

    // midpoint between start and end
    return boneStart.clone().add(boneEnd).multiplyScalar(0.5);
  }

  // leaf bone, so all we can do is to return the start position
  return boneStart;
}

function getBoneRegionsForColorSampling(
  characterMesh: SkinnedMesh,
  camera: Camera,
  renderSize: number,
): Array<{ name: string; screenPos: Vector2; radius: number }> {
  const regions: Array<{ name: string; screenPos: Vector2; radius: number }> = [];

  console.log("Available bones:");
  console.table(listAllBoneNames(characterMesh));

  const boneTargets = [
    { name: "Face/Chin", boneName: "head" },
    { name: "Chest", boneName: "spine_04" },
    { name: "Left Forearm", boneName: "lowerarm_l" },
    { name: "Right Forearm", boneName: "lowerarm_r" },
    { name: "Left Thigh", boneName: "thigh_l" },
    { name: "Right Thigh", boneName: "thigh_r" },
    { name: "Left Shin", boneName: "calf_l" },
    { name: "Right Shin", boneName: "calf_r" },
    { name: "Left Hand", boneName: "hand_l" },
    { name: "Right Hand", boneName: "hand_r" },
    { name: "Left Foot", boneName: "foot_l" },
    { name: "Right Foot", boneName: "foot_r" },
    { name: "Hair/Head Top", boneName: "head" },
  ];

  const screenPos = new Vector3();

  for (const target of boneTargets) {
    const bone: Bone | undefined = characterMesh.skeleton.bones.find(
      (child) => child.name === target.boneName,
    );

    if (bone) {
      const worldPos = findBoneCenter(bone);
      screenPos.copy(worldPos);
      screenPos.project(camera);

      const x = Math.round((screenPos.x * 0.5 + 0.5) * renderSize);
      const y = Math.round((screenPos.y * -0.5 + 0.5) * renderSize);

      if (x >= 0 && x < renderSize && y >= 0 && y < renderSize) {
        regions.push({
          name: target.name,
          screenPos: new Vector2(x, y),
          radius: 8, // pixels
        });
      }
    } else {
      console.warn(`Bone not found: ${target.boneName}`);
    }
  }

  return regions;
}

function sampleCircularRegion(
  pixels: Uint8Array,
  center: Vector2,
  radius: number,
  imageWidth: number,
): { r: number; g: number; b: number } {
  let totalR = 0,
    totalG = 0,
    totalB = 0;
  let sampleCount = 0;

  const radiusSquared = radius * radius;
  const minX = Math.max(0, Math.floor(center.x - radius));
  const maxX = Math.min(imageWidth - 1, Math.ceil(center.x + radius));
  const minY = Math.max(0, Math.floor(center.y - radius));
  const maxY = Math.min(imageWidth - 1, Math.ceil(center.y + radius));

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const dx = x - center.x;
      const dy = y - center.y;
      const distSquared = dx * dx + dy * dy;

      if (distSquared <= radiusSquared) {
        const pixelIndex = (y * imageWidth + x) * 4;
        totalR += pixels[pixelIndex];
        totalG += pixels[pixelIndex + 1];
        totalB += pixels[pixelIndex + 2];
        sampleCount++;
      }
    }
  }

  if (sampleCount === 0) {
    return { r: 0, g: 0, b: 0 };
  }

  return {
    r: Math.round(totalR / sampleCount),
    g: Math.round(totalG / sampleCount),
    b: Math.round(totalB / sampleCount),
  };
}

function createDebugCanvas(
  pixels: Uint8Array,
  size: number,
  title: string,
  boneRegions?: Array<{ name: string; screenPos: Vector2; radius: number }>,
): void {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");

  if (!ctx) {
    console.error("Could not get canvas context for debug display");
    return;
  }

  canvas.width = size;
  canvas.height = size;

  const imageData = ctx.createImageData(size, size);
  imageData.data.set(pixels);
  ctx.putImageData(imageData, 0, 0);

  if (boneRegions) {
    boneRegions.forEach((region, index) => {
      ctx.beginPath();
      ctx.arc(region.screenPos.x, region.screenPos.y, region.radius, 0, 2 * Math.PI);
      ctx.strokeStyle = index % 2 === 0 ? "#ff0000" : "#00ff00"; // Alternate red/green
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(region.screenPos.x, region.screenPos.y, 2, 0, 2 * Math.PI);
      ctx.fillStyle = ctx.strokeStyle;
      ctx.fill();

      ctx.fillStyle = "#ffffff";
      ctx.font = "10px monospace";
      ctx.strokeStyle = "#000000";
      ctx.lineWidth = 3;
      const labelX = region.screenPos.x + region.radius + 5;
      const labelY = region.screenPos.y;
      ctx.strokeText(region.name, labelX, labelY);
      ctx.fillText(region.name, labelX, labelY);
    });
  }

  const container = document.createElement("div");
  container.style.position = "fixed";
  container.style.top = "10px";
  container.style.right = "10px";
  container.style.zIndex = "99999999";
  container.style.background = "rgba(0,0,0,0.8)";
  container.style.padding = "10px";
  container.style.borderRadius = "5px";

  const titleElement = document.createElement("div");
  titleElement.textContent = title;
  titleElement.style.color = "white";
  titleElement.style.fontSize = "12px";
  titleElement.style.marginBottom = "5px";
  titleElement.style.fontFamily = "monospace";

  canvas.style.imageRendering = "pixelated";
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;
  canvas.style.border = "1px solid #666";

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

  container.appendChild(titleElement);
  container.appendChild(canvas);
  container.appendChild(closeBtn);
  document.body.appendChild(container);

  console.log(`📸 Debug canvas created: ${title} (${size}x${size})`);
}

export function updateDebugTextureCanvas(): void {
  if (!this.instancedMesh?.materialColorsTexture) {
    console.warn("No material colors texture to update debug canvas");
    return;
  }

  // Find existing debug texture canvas container
  const existingContainer = document.querySelector(
    '[data-debug-texture="material-colors"]',
  ) as HTMLElement;
  if (!existingContainer) {
    console.warn("No existing debug texture canvas found to update");
    return;
  }

  // Find the canvas inside the container
  const canvas = existingContainer.querySelector("canvas") as HTMLCanvasElement;
  if (!canvas) {
    console.warn("No canvas found in debug texture container");
    return;
  }

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    console.error("Could not get canvas context for texture update");
    return;
  }

  const texture = this.instancedMesh.materialColorsTexture;
  const size = texture.image.width;

  // Update canvas size if needed
  if (canvas.width !== size || canvas.height !== size) {
    canvas.width = size;
    canvas.height = size;
  }

  const imageData = ctx.createImageData(size, size);
  const data = texture._data;

  // Update the image data with new texture data
  for (let i = 0; i < data.length; i += 4) {
    const pixelIndex = i;
    imageData.data[pixelIndex] = Math.floor(data[i] * 255); // R
    imageData.data[pixelIndex + 1] = Math.floor(data[i + 1] * 255); // G
    imageData.data[pixelIndex + 2] = Math.floor(data[i + 2] * 255); // B
    imageData.data[pixelIndex + 3] = Math.floor(data[i + 3] * 255); // A
  }

  ctx.putImageData(imageData, 0, 0);
  console.log("🔄 Debug texture canvas updated with new material colors");
}

export function addTextureToDOM(texture: SquareDataTexture): void {
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
  container.setAttribute("data-debug-texture", "material-colors");
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
