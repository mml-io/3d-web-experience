import {
  AvatarVisualizer,
  CharacterPartsSelector,
  CollectionDataType,
  Character,
  ModelLoader,
  CharacterComposition,
} from "@mml-io/3d-web-standalone-avatar-editor";
import React from "react";
import { Object3D } from "three";

import idleAnimationURL from "../../assets/avatar/anims/AS_Andor_Stand_Idle.glb";
import hdrURL from "../../assets/hdr/industrial_sunset_2k.hdr";

type BodyPartTypes = "fullBody" | "head" | "upperBody" | "lowerBody" | "feet";

const partToCameraOffset = new Map<
  BodyPartTypes,
  {
    offset: { x: number; y: number; z: number };
    targetDistance: number;
  }
>([
  ["head", { offset: { x: 0, y: 1.616079270843859, z: 0 }, targetDistance: 0.8 }],
  ["lowerBody", { offset: { x: 0, y: 0.6694667063220178, z: 0 }, targetDistance: 1.3 }],
  ["feet", { offset: { x: 0, y: 0.2194667063220177, z: 0 }, targetDistance: 0.9 }],
  ["fullBody", { offset: { x: 0, y: 1.079590141424593, z: 0 }, targetDistance: 2.5 }],
  ["upperBody", { offset: { x: 0, y: 1.199837285184325, z: 0 }, targetDistance: 1.2 }],
]);

export function AvatarEditor<C extends CollectionDataType>(props: { collectionData: C }) {
  const [characterMesh, setCharacterMesh] = React.useState<Object3D | null>(null);
  const [character] = React.useState(new Character(new ModelLoader()));
  const [selectedPart, setSelectedPart] = React.useState<BodyPartTypes>("fullBody");

  const onComposedCharacter = React.useCallback(
    async (characterParts: CharacterComposition<C>) => {
      const { fullBody, parts } = characterParts;

      // The character parts picker provides the full body separately from the parts that are then layered onto it
      const obj3d = await character.mergeBodyParts(
        fullBody.url,
        Object.values(parts).map((part) => part.url),
      );
      setCharacterMesh(obj3d);
      setSelectedPart("fullBody");
    },
    [character],
  );

  const onSelectingPart = (part: BodyPartTypes) => {
    if (selectedPart !== part) {
      setSelectedPart(part);
    }
  };

  const partEntry = partToCameraOffset.get(selectedPart)!;

  return (
    <>
      <CharacterPartsSelector
        onSelectingPart={onSelectingPart}
        fullBodyKey="fullBody"
        collectionData={props.collectionData}
        onComposedCharacter={onComposedCharacter}
      />
      {characterMesh && (
        <AvatarVisualizer
          characterMesh={characterMesh}
          hdrURL={hdrURL}
          idleAnimationURL={idleAnimationURL}
          cameraTargetDistance={partEntry.targetDistance}
          cameraTargetOffset={partEntry.offset}
        />
      )}
    </>
  );
}
