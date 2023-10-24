import { useEffect, useState } from "react";

import { type CharacterComposition } from "../AvatarUI";
import { useFetch, type CollectionDataType } from "../hooks/useFetch";

import { PartsSelectorComponent } from "./PartsSelectorComponent";

type AvatarUIComponentProps = {
  collectionURL: string;
  composedCharacterPartsCB: (characterParts: CharacterComposition) => void;
};

export const AvatarUIComponent = (props: AvatarUIComponentProps) => {
  const [collectionData, loading, loadingError] = useFetch(props.collectionURL);
  const [showError, setShowError] = useState(false);
  const [hasData, setHasData] = useState(false);

  useEffect(() => {
    setShowError(!loading && loadingError !== null);
    setHasData(!loading && collectionData !== null && collectionData !== undefined);
  }, [collectionData, hasData, loading, loadingError]);

  const renderError = () => {
    return (
      <div className="avatar-ui-error">
        <span className="error">Error:</span>
        {loadingError as string}
      </div>
    );
  };

  const renderPartsSelector = () => {
    return collectionData !== null ? (
      <PartsSelectorComponent
        composedCharacterPartsCB={props.composedCharacterPartsCB}
        collectionData={collectionData as CollectionDataType}
        onGLBSelected={(glb: string) => {
          console.log(glb);
        }}
      />
    ) : null;
  };

  return (
    <div className="avatar-ui-component">
      {showError && renderError()}
      {hasData && renderPartsSelector()}
    </div>
  );
};
