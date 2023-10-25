import React, { useCallback, useEffect, useState } from "react";

import { AssetDescription, BodyPartTypes, CharacterComposition, CollectionDataType } from "./types";

type PartsSelectorComponentProps = {
  collectionData: CollectionDataType;
  composedCharacterPartsCB: (characterParts: CharacterComposition) => void;
};

export const PartsSelectorComponent: React.FC<PartsSelectorComponentProps> = ({
  collectionData,
  composedCharacterPartsCB,
}) => {
  const [selectedPart, setSelectedPart] = useState<BodyPartTypes | null>(null);
  const [currentSelection, setCurrentSelection] = useState({
    head: collectionData.head[0],
    upperBody: collectionData.upperBody[0],
    lowerBody: collectionData.lowerBody[0],
    feet: collectionData.feet[0],
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

  const handleModalThumbnailClick = (part: BodyPartTypes, item: AssetDescription) => {
    const selectedData = item;
    setCurrentSelection((prev) => ({ ...prev, [part]: selectedData }));
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
        {collectionData[selectedPart].map((item: AssetDescription) => (
          <img
            key={item.asset}
            src={item.thumb}
            alt={item.name}
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
