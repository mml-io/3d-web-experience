import {
  AvatarVisualizer,
  CharacterPartsSelector,
  CollectionDataType,
  CharacterComposition,
  Character,
  ModelLoader,
} from "@mml-io/3d-web-standalone-avatar-editor";
import React from "react";
import { Object3D } from "three";

import idleAnimationURL from "../../assets/avatar/anims/AS_Andor_Stand_Idle.glb";
import hdrURL from "../../assets/hdr/industrial_sunset_2k.hdr";

export function AvatarEditor(props: { collectionData: CollectionDataType }) {
  const [characterMesh, setCharacterMesh] = React.useState<Object3D | null>(null);
  const [character] = React.useState(new Character(new ModelLoader()));

  const onComposedCharacter = React.useCallback(
    async (characterParts: CharacterComposition) => {
      const { fullBody, head, upperBody, lowerBody, feet } = characterParts;

      const obj3d = await character.mergeBodyParts(
        fullBody.asset,
        head.asset,
        upperBody.asset,
        lowerBody.asset,
        feet.asset,
      );
      setCharacterMesh(obj3d);
    },
    [character],
  );

  return (
    <>
      <CharacterPartsSelector
        onComposedCharacter={onComposedCharacter}
        collectionData={props.collectionData}
      />
      {characterMesh && (
        <AvatarVisualizer
          characterMesh={characterMesh}
          hdrURL={hdrURL}
          idleAnimationURL={idleAnimationURL}
        />
      )}
    </>
  );
}
