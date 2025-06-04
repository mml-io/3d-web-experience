import { MMLCharacterDescriptionPart } from "@mml-io/3d-web-avatar";
import * as playcanvas from "playcanvas";

import { CharacterModelLoader } from "./CharacterModelLoader";

export class PlayCanvasMMLCharacter {
  private boneGraphNodes: Map<string, playcanvas.GraphNode> = new Map();
  constructor(private characterModelLoader: CharacterModelLoader) {}

  // recursion everywhere
  private findBoneByName(graphNode: pc.GraphNode, name: string): pc.GraphNode | null {
    if (graphNode.name === name) return graphNode;

    for (let i = 0; i < graphNode.children.length; i++) {
      const child = graphNode.children[i];
      const result = this.findBoneByName(child, name);
      if (result) return result;
    }

    return null;
  }

  /**
  in pc bones are not Entities, but rather part of an internal GraphNode hierarchy
  used by SkinInstance. To achieve parity with ThreeJS we prob need to extract the
  SkinInstance ( https://api.playcanvas.com/engine/classes/SkinInstance.html ),
  then traverse the hierarchy starting from the root bone (made of GraphNodes?)

  pc apparently doesn't have a thing to identify that something is a bone???

  Then we can probably attach a mesh or entity to the bone by addding as child to the
  GraphNode that represents the bone. I hate the opaqueness of the PlayCanvas's API
   */
  private getSkinInstanceFromEntity(entity: playcanvas.Entity): playcanvas.SkinInstance | null {
    const render = entity.render;

    if (render && render.meshInstances) {
      for (const mi of render.meshInstances) {
        if (mi.skinInstance) {
          return mi.skinInstance;
        }
      }
    }

    // If no SkinInstance found in the render, check children
    for (const child of entity.children) {
      const skinInstance = this.getSkinInstanceFromEntity(child as playcanvas.Entity);
      if (skinInstance) return skinInstance;
    }
    return null;
  }

  public async mergeBodyParts(
    fullBodyURL: string,
    bodyParts: Array<MMLCharacterDescriptionPart>,
  ): Promise<playcanvas.Entity> {
    const group = new playcanvas.Entity();

    const fullBodyAssetPromise = this.characterModelLoader.load(fullBodyURL);

    const assetPromises: Array<
      Promise<{ asset: playcanvas.Asset; part: MMLCharacterDescriptionPart }>
    > = bodyParts.map((part) => {
      return new Promise((resolve) => {
        this.characterModelLoader.load(part.url).then((asset) => {
          resolve({ asset, part });
        });
      });
    });

    const fullBodyAsset = await fullBodyAssetPromise;

    const assets = await Promise.all(assetPromises);

    const rawBodyGltf = fullBodyAsset.resource.instantiateRenderEntity();

    const rawBodySkinInstance = this.getSkinInstanceFromEntity(rawBodyGltf);
    if (!rawBodySkinInstance) {
      throw new Error("rawBodyGltf does not contain a SkinInstance");
    }

    const bones = rawBodySkinInstance.bones;
    if (!bones || bones.length === 0) {
      throw new Error("rawBodyGltf does not contain any bones");
    }

    // ok we finally have the dammed bones
    bones.forEach((bone) => {
      const boneName = bone.name;
      const boneGraphNode = this.findBoneByName(rawBodyGltf, boneName);

      if (!this.boneGraphNodes.has(boneName) && boneGraphNode instanceof playcanvas.GraphNode) {
        this.boneGraphNodes.set(boneName, boneGraphNode);
        console.log(`Bone ${boneName} added to boneGraphNodes`);
      }

      if (!boneGraphNode) {
        throw new Error(`Bone ${boneName} not found in rawBodyGltf`);
      }
    });

    group.addChild(rawBodyGltf);

    for (const loadingAsset of assets) {
      const part = loadingAsset.part;
      const rawGltf = loadingAsset.asset;
      const modelGroup = rawGltf.resource.instantiateRenderEntity();

      if (part.socket) {
        const socketName = part.socket.socket;
        const boneNode = this.boneGraphNodes.get(socketName) || this.boneGraphNodes.get("root");

        if (!boneNode) {
          console.warn(
            `No matching bone for socket '${socketName}', and no 'root' fallback. Skipping.`,
          );
          continue;
        }

        // create an intermediate GraphNode to apply transform offsets
        const name = `socket_${socketName}`;
        const socketTransformNode = new playcanvas.GraphNode(name);

        socketTransformNode.setLocalPosition(
          part.socket.position.x,
          part.socket.position.y,
          part.socket.position.z,
        );
        socketTransformNode.setLocalEulerAngles(
          part.socket.rotation.x,
          part.socket.rotation.y,
          part.socket.rotation.z,
        );
        socketTransformNode.setLocalScale(
          part.socket.scale.x,
          part.socket.scale.y,
          part.socket.scale.z,
        );

        boneNode.addChild(socketTransformNode);
        group.addChild(modelGroup);
        modelGroup.reparent(socketTransformNode); // attach entire entity to bone
      } else {
        const skinInstance = this.getSkinInstanceFromEntity(modelGroup);
        if (!skinInstance) {
          console.warn("Part has no socket and no skin instance; skipping.");
          continue;
        }

        // rebind skinInstance to main skeleton
        const mainSkinInstance = this.getSkinInstanceFromEntity(rawBodyGltf);
        if (!mainSkinInstance) throw new Error("No main skin instance found in base model");

        const sharedSkin = mainSkinInstance.skin;
        const sharedRootBone = mainSkinInstance.rootBone;

        const render = modelGroup.render;
        if (!render || !render.meshInstances) {
          console.warn("Part has no render component with meshInstances; skipping.");
          continue;
        }

        for (const mi of render.meshInstances) {
          mi.skinInstance = new playcanvas.SkinInstance(sharedSkin);
          mi.skinInstance.rootBone = sharedRootBone;
        }

        group.addChild(modelGroup);
      }
    }
    return group;
  }
}
