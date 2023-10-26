export type BodyPartTypes = "fullBody" | "head" | "upperBody" | "lowerBody" | "feet";

export type AssetDescription = {
  name: string;
  asset: string;
  thumb: string;
};

export type CollectionDataType = Record<BodyPartTypes, Array<AssetDescription>>;

export type CharacterComposition = Record<BodyPartTypes, AssetDescription>;
