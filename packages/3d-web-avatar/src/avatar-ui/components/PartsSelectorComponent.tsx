import React, { useCallback, useEffect, useState } from "react";

import { BodyPartTypes, type CharacterComposition } from "../AvatarUI";
import { type CollectionDataType } from "../hooks/useFetch";

type PartsSelectorComponentProps = {
  collectionData: CollectionDataType;
  onGLBSelected: (glb: string) => void;
  composedCharacterPartsCB: (characterParts: CharacterComposition) => void;
};

export const PartsSelectorComponent: React.FC<PartsSelectorComponentProps> = ({
  collectionData,
  onGLBSelected,
  composedCharacterPartsCB,
}) => {
  const [selectedPart, setSelectedPart] = useState<BodyPartTypes | null>(null);
  const [currentSelection, setCurrentSelection] = useState({
    head: collectionData.head[0][Object.keys(collectionData.head[0])[0]],
    upperBody: collectionData.upperBody[0][Object.keys(collectionData.upperBody[0])[0]],
    lowerBody: collectionData.lowerBody[0][Object.keys(collectionData.lowerBody[0])[0]],
    feet: collectionData.feet[0][Object.keys(collectionData.feet[0])[0]],
  });

  const createMMLDescription = useCallback(() => {
    const description = `<m-character src="/assets/avatar/cylinderman.glb">
  <m-model src="${currentSelection.head.asset}"></m-model>
  <m-model src="${currentSelection.upperBody.asset}"></m-model>
  <m-model src="${currentSelection.lowerBody.asset}"></m-model>
  <m-model src="${currentSelection.feet.asset}"></m-model>
</m-character>
    `;
    console.log(description);
  }, [currentSelection]);

  useEffect(() => {
    composedCharacterPartsCB({
      head: currentSelection.head,
      upperBody: currentSelection.upperBody,
      lowerBody: currentSelection.lowerBody,
      feet: currentSelection.feet,
    });
    createMMLDescription();
  }, [
    composedCharacterPartsCB,
    currentSelection.head,
    currentSelection.upperBody,
    currentSelection.lowerBody,
    currentSelection.feet,
    createMMLDescription,
  ]);

  const handleThumbnailClick = (part: BodyPartTypes) => {
    setSelectedPart(part);
  };

  const handleModalThumbnailClick = (part: BodyPartTypes, item: any) => {
    const selectedData = item[Object.keys(item)[0]];
    setCurrentSelection((prev) => ({ ...prev, [part]: selectedData }));
    onGLBSelected(selectedData.asset);
    createMMLDescription();
    setSelectedPart(null);
  };

  const renderThumbnails = () => {
    return (
      <div className="left-thumbnails">
        {["head", "upperBody", "lowerBody", "feet"].map((part) => (
          <img
            key={part}
            src={currentSelection[part as BodyPartTypes].thumb}
            alt={part}
            onClick={() => handleThumbnailClick(part as BodyPartTypes)}
          />
        ))}
      </div>
    );
  };

  const renderModal = () => {
    if (!selectedPart) return null;

    return (
      <div className="modal">
        {collectionData[selectedPart].map((item) => (
          <img
            key={Object.keys(item)[0]}
            src={item[Object.keys(item)[0]].thumb}
            alt={item[Object.keys(item)[0]].name}
            onClick={() => handleModalThumbnailClick(selectedPart, item)}
          />
        ))}
      </div>
    );
  };

  return (
    <div className="parts-selector-component">
      <div id="avatar-canvas-container" className="avatar-canvas-container"></div>
      {renderThumbnails()}
      {renderModal()}
    </div>
  );
};

export default PartsSelectorComponent;
