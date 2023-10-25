export type BodyPartTypes = "head" | "upperBody" | "lowerBody" | "feet";

export type AssetDescription = {
  name: string;
  asset: string;
  thumb: string;
};

export type CollectionDataType = {
  head: AssetDescription[];
  upperBody: AssetDescription[];
  lowerBody: AssetDescription[];
  feet: AssetDescription[];
};

export type CharacterComposition = {
  head: AssetDescription;
  upperBody: AssetDescription;
  lowerBody: AssetDescription;
  feet: AssetDescription;
};
