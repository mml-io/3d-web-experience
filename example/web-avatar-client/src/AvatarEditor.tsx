import { type LoadingErrors, type MMLCharacterDescription } from "@mml-io/3d-web-avatar";
import { findAssetsInCollection } from "@mml-io/3d-web-avatar-editor-ui";
import {
  AvatarVisualizer,
  CharacterPartsSelector,
  CollectionDataType,
  Character,
  ModelLoader,
  CharacterComposition,
} from "@mml-io/3d-web-standalone-avatar-editor";
import React, { useState, useCallback, useEffect } from "react";
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

export function AvatarEditor<C extends CollectionDataType>(props: {
  collectionData: C;
  currentCharacter: MMLCharacterDescription | null;
  loadingErrors: LoadingErrors | null;
  showMirror: boolean;
}) {
  const [characterMesh, setCharacterMesh] = useState<Object3D | null>(null);
  const [character] = useState(new Character(new ModelLoader()));
  const [selectedPart, setSelectedPart] = useState<BodyPartTypes>("fullBody");
  const [errors, setErrors] = useState(props.loadingErrors);

  const [showErrors, setShowErrors] = useState<boolean>(true);
  const hasCurrentCharacter = props.currentCharacter !== null;

  const handleCloseErrors = () => setShowErrors(false);

  const checkAgainstCollection = useCallback(
    (collectionData: C, currentCharacter: MMLCharacterDescription) => {
      const { hasBase, hasParts, accumulatedErrors } = findAssetsInCollection(
        collectionData,
        currentCharacter,
        errors,
      );
      // Set the errors state once with all accumulated errors
      if (accumulatedErrors.length > (errors || []).length) {
        setErrors(accumulatedErrors);
      }

      return hasBase && hasParts;
    },
    [errors],
  );

  const onComposedCharacter = useCallback(
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

  useEffect(() => {
    if (hasCurrentCharacter && props.currentCharacter) {
      const assetsExist = checkAgainstCollection(props.collectionData, props.currentCharacter);
      if (assetsExist) {
        const characterComposition: CharacterComposition<C> = {
          fullBody: props.currentCharacter.base,
          parts: props.currentCharacter.parts.reduce(
            (acc, part) => {
              const partKey = Object.keys(props.collectionData).find((key) =>
                props.collectionData[key].some((asset) => asset.asset === part.url),
              );
              if (partKey) {
                acc[partKey as keyof C] = { url: part.url };
              }
              return acc;
            },
            {} as Record<keyof C, { url: string }>,
          ),
        };

        onComposedCharacter(characterComposition);
      }
    }
  }, [
    props.collectionData,
    props.currentCharacter,
    hasCurrentCharacter,
    onComposedCharacter,
    checkAgainstCollection,
  ]);

  const partEntry = partToCameraOffset.get(selectedPart)!;

  const hasErrorsToShow = errors && errors.length > 0 && showErrors;

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
          showMirror={props.showMirror}
        />
      )}
      {hasErrorsToShow && (
        <div id="loading_errors" className="avatar-loading-errors">
          <button onClick={handleCloseErrors} className="close-errors">
            X
          </button>
          <ul>
            {errors.map((error, idx) => (
              <li key={idx}>{error}</li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
