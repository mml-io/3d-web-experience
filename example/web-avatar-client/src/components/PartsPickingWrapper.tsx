import { PartsSelectorComponent } from "@mml-io/3d-web-avatar-editor-ui";
import { CharacterComposition, CollectionDataType } from "@mml-io/3d-web-standalone-avatar-editor";
import React from "react";

type PartPickingWrapperType = {
  composedCharacterPartsCB: (characterParts: CharacterComposition) => void;
  collectionData: CollectionDataType;
};

export class PartPickingWrapper extends React.Component<PartPickingWrapperType> {
  render() {
    return (
      <PartsSelectorComponent
        composedCharacterPartsCB={this.props.composedCharacterPartsCB}
        collectionData={this.props.collectionData}
      />
    );
  }
}
