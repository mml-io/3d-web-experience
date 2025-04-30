import { MMLCharacterDescriptionPart } from "@mml-io/3d-web-avatar";
import * as playcanvas from "playcanvas";

import { CharacterModelLoader } from "./CharacterModelLoader";

export class PlayCanvasMMLCharacter {
  constructor(private characterModelLoader: CharacterModelLoader) {}

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
    group.addChild(rawBodyGltf);
    // const availableBones = new Map<string, Bone>();
    // rawBodyGltf.traverse((child) => {
    //   const asBone = child as Bone;
    //   if (asBone.isBone) {
    //     availableBones.set(child.name, asBone);
    //   }

    //   const asSkinnedMesh = child as SkinnedMesh;
    //   if (asSkinnedMesh.isSkinnedMesh) {
    //     asSkinnedMesh.castShadow = true;
    //     asSkinnedMesh.receiveShadow = true;
    //   }
    // });
    // const foundSkinnedMeshes: Array<SkinnedMesh> = [];
    // rawBodyGltf.traverse((child) => {
    //   const asSkinnedMesh = child as SkinnedMesh;
    //   if (asSkinnedMesh.isSkinnedMesh) {
    //     foundSkinnedMeshes.push(asSkinnedMesh);
    //   }
    // });

    // if (foundSkinnedMeshes.length === 0) {
    //   throw new Error("No skinned mesh in base model file");
    // }
    // if (foundSkinnedMeshes.length > 1) {
    //   console.warn(
    //     "Multiple skinned meshes in base model file. Expected 1. Using first for skeleton.",
    //   );
    // }
    // const skinnedMesh = foundSkinnedMeshes[0];
    // group.add(...foundSkinnedMeshes);
    // const sharedSkeleton = skinnedMesh.skeleton;
    // group.add(skinnedMesh.skeleton.bones[0]);
    // const sharedMatrixWorld = skinnedMesh.matrixWorld;

    for (const loadingAsset of assets) {
      const part = loadingAsset.part;
      const rawGltf = loadingAsset.asset;

      const modelGroup = rawGltf.resource.instantiateRenderEntity();
      // if (part.socket) {
      //   const socketName = part.socket.socket;
      //   let bone = availableBones.get("root");
      //   if (availableBones.has(socketName)) {
      //     bone = availableBones.get(socketName);
      //   } else {
      //     console.warn(
      //       `WARNING: no bone found for [${socketName}] socket. Attatching to Root bone`,
      //     );
      //   }
      //   if (bone) {
      //     bone.add(modelGroup);

      //     modelGroup.position.set(
      //       part.socket.position.x,
      //       part.socket.position.y,
      //       part.socket.position.z,
      //     );

      //     modelGroup.rotation.set(
      //       MathUtils.degToRad(part.socket.rotation.x),
      //       MathUtils.degToRad(part.socket.rotation.y),
      //       MathUtils.degToRad(part.socket.rotation.z),
      //     );

      //     modelGroup.scale.set(part.socket.scale.x, part.socket.scale.y, part.socket.scale.z);
      //   }
      // } else {
        // const skinnedMeshes: Array<playcanvas.SkinnedMesh> = [];
        // modelGroup.traverse((child) => {
        //   const asSkinnedMesh = child as SkinnedMesh;
        //   if (asSkinnedMesh.isSkinnedMesh) {
        //     skinnedMeshes.push(asSkinnedMesh);
        //   }
        // });
        // for (const skinnedMeshPart of skinnedMeshes) {
        //   this.remapBoneIndices(skinnedMeshPart, sharedSkeleton);
        //   skinnedMeshPart.castShadow = true;
        //   skinnedMeshPart.receiveShadow = true;
        //   skinnedMeshPart.bind(sharedSkeleton, sharedMatrixWorld!);
        //   skinnedMeshPart.children = [];
        //   group.add(skinnedMeshPart);
        // }
      // }
      // TODO - remove
      group.addChild(modelGroup);
    }
    return group;
  }
}
