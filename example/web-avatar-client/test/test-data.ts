export const validMCharacter = `
<m-character src="/assets/avatar/parts/SK_Outfit_Body_Male.glb">
  <m-model src="/assets/avatar/parts/SK_Outfit_Hat_02.glb"></m-model>
  <m-model src="/assets/avatar/parts/SK_Outfit_Two_Long_Coat_with_Collared_Shirt_01.glb"></m-model>
  <m-model src="/assets/avatar/parts/SK_Outfit_Three_Tight_Jeans_with_Chain_01.glb"></m-model>
  <m-model src="/assets/avatar/parts/SK_Outfit_One_High_Tops_01.glb"></m-model>
</m-character>
`;

export const threeNestedMCharacters = `
<m-character src="/assets/avatar/parts/SK_Outfit_Body_Male.glb">
  <m-model src="/assets/avatar/parts/SK_Outfit_Hat_02.glb"></m-model>
  <m-model src="/assets/avatar/parts/SK_Outfit_Two_Long_Coat_with_Collared_Shirt_01.glb"></m-model>
  <m-model src="/assets/avatar/parts/SK_Outfit_Three_Tight_Jeans_with_Chain_01.glb"></m-model>
  <m-model src="/assets/avatar/parts/SK_Outfit_One_High_Tops_01.glb"></m-model>

  <m-character src="/assets/avatar/parts/SK_Outfit_Body_Male.glb">
    <m-model src="/assets/avatar/parts/SK_Outfit_Hat_02.glb"></m-model>
    <m-model src="/assets/avatar/parts/SK_Outfit_One_High_Tops_01.glb"></m-model>
  </m-character>

  <m-character src="/assets/avatar/parts/SK_Outfit_Body_Male.glb">
    <m-model src="/assets/avatar/parts/SK_Outfit_Hat_02.glb"></m-model>
    <m-model src="/assets/avatar/parts/SK_Outfit_One_High_Tops_01.glb"></m-model>
  </m-character>

  <m-character src="/assets/avatar/parts/SK_Outfit_Body_Male.glb">
    <m-model src="/assets/avatar/parts/SK_Outfit_Hat_02.glb"></m-model>
    <m-model src="/assets/avatar/parts/SK_Outfit_One_High_Tops_01.glb"></m-model>
  </m-character>
</m-character>
`;

export const threeNestedMCharactersExpectedData = {
  base: { url: "/assets/avatar/parts/SK_Outfit_Body_Male.glb" },
  parts: [
    { url: "/assets/avatar/parts/SK_Outfit_Hat_02.glb" },
    {
      url: "/assets/avatar/parts/SK_Outfit_Two_Long_Coat_with_Collared_Shirt_01.glb",
    },
    {
      url: "/assets/avatar/parts/SK_Outfit_Three_Tight_Jeans_with_Chain_01.glb",
    },
    { url: "/assets/avatar/parts/SK_Outfit_One_High_Tops_01.glb" },
  ],
};

export const threeRogueMModels = `
<m-character src="/assets/avatar/parts/SK_Outfit_Body_Male.glb">
  <m-model src="/assets/avatar/parts/SK_Outfit_Hat_02.glb"></m-model>
  <m-model src="/assets/avatar/parts/SK_Outfit_Two_Long_Coat_with_Collared_Shirt_01.glb"></m-model>
  <m-model src="/assets/avatar/parts/SK_Outfit_Three_Tight_Jeans_with_Chain_01.glb"></m-model>
  <m-model src="/assets/avatar/parts/SK_Outfit_One_High_Tops_01.glb"></m-model>
</m-character>
<m-model src="/assets/avatar/parts/SK_Outfit_One_High_Tops_01.glb"></m-model>
<m-model src="/assets/avatar/parts/SK_Outfit_One_High_Tops_01.glb"></m-model>
<m-model src="/assets/avatar/parts/SK_Outfit_One_High_Tops_01.glb"></m-model>
`;

export const threeRogueMModelsExpectedData = {
  base: { url: "/assets/avatar/parts/SK_Outfit_Body_Male.glb" },
  parts: [
    { url: "/assets/avatar/parts/SK_Outfit_Hat_02.glb" },
    {
      url: "/assets/avatar/parts/SK_Outfit_Two_Long_Coat_with_Collared_Shirt_01.glb",
    },
    {
      url: "/assets/avatar/parts/SK_Outfit_Three_Tight_Jeans_with_Chain_01.glb",
    },
    { url: "/assets/avatar/parts/SK_Outfit_One_High_Tops_01.glb" },
  ],
};

export const twoRedundantMCharacterswithThreeMModelsEach = `
<m-character src="/assets/avatar/parts/SK_Outfit_Body_Male.glb">
  <m-model src="/assets/avatar/parts/SK_Outfit_Hat_02.glb"></m-model>
  <m-model src="/assets/avatar/parts/SK_Outfit_Two_Long_Coat_with_Collared_Shirt_01.glb"></m-model>
  <m-model src="/assets/avatar/parts/SK_Outfit_Three_Tight_Jeans_with_Chain_01.glb"></m-model>
  <m-model src="/assets/avatar/parts/SK_Outfit_One_High_Tops_01.glb"></m-model>
</m-character>
<m-character src="/assets/avatar/parts/SK_Outfit_Body_Male.glb">
  <m-model src="/assets/avatar/parts/SK_Outfit_Two_Long_Coat_with_Collared_Shirt_01.glb"></m-model>
  <m-model src="/assets/avatar/parts/SK_Outfit_Three_Tight_Jeans_with_Chain_01.glb"></m-model>
  <m-model src="/assets/avatar/parts/SK_Outfit_One_High_Tops_01.glb"></m-model>
</m-character>
<m-character src="/assets/avatar/parts/SK_Outfit_Body_Male.glb">
  <m-model src="/assets/avatar/parts/SK_Outfit_Two_Long_Coat_with_Collared_Shirt_01.glb"></m-model>
  <m-model src="/assets/avatar/parts/SK_Outfit_Three_Tight_Jeans_with_Chain_01.glb"></m-model>
  <m-model src="/assets/avatar/parts/SK_Outfit_One_High_Tops_01.glb"></m-model>
</m-character>
`;

export const twoRedundantMCharacterswithThreeMModelsEachExpectedData = {
  base: { url: "/assets/avatar/parts/SK_Outfit_Body_Male.glb" },
  parts: [
    { url: "/assets/avatar/parts/SK_Outfit_Hat_02.glb" },
    {
      url: "/assets/avatar/parts/SK_Outfit_Two_Long_Coat_with_Collared_Shirt_01.glb",
    },
    {
      url: "/assets/avatar/parts/SK_Outfit_Three_Tight_Jeans_with_Chain_01.glb",
    },
    { url: "/assets/avatar/parts/SK_Outfit_One_High_Tops_01.glb" },
  ],
};

export const twoInvalidlyWrappedMModel = `
<m-character src="/assets/avatar/parts/SK_Outfit_Body_Male.glb">
  <m-model src="/assets/avatar/parts/SK_Outfit_Hat_02.glb"></m-model>
  <m-model src="/assets/avatar/parts/SK_Outfit_Two_Long_Coat_with_Collared_Shirt_adsfadsfasdfda01.glb"></m-model>
  <div>
    <m-model src="/assets/avatar/parts/SK_Outfit_Three_Tight_Jeans_with_Chain_01.glb"></m-model>
    <m-model src="/assets/avatar/parts/SK_Outfit_Three_Tight_Jeans_with_Chain_01.glb"></m-model>
  </div>
  <m-model src="/assets/avatar/parts/SK_Outfit_Three_Tight_Jeans_with_Chain_01.glb"></m-model>
</m-character>
`;

export const twoInvalidlyWrappedMModelExpectedData = {
  base: { url: "/assets/avatar/parts/SK_Outfit_Body_Male.glb" },
  parts: [
    { url: "/assets/avatar/parts/SK_Outfit_Hat_02.glb" },
    {
      url: "/assets/avatar/parts/SK_Outfit_Two_Long_Coat_with_Collared_Shirt_adsfadsfasdfda01.glb",
    },
    {
      url: "/assets/avatar/parts/SK_Outfit_Three_Tight_Jeans_with_Chain_01.glb",
    },
  ],
};

export const twoInvalidlyWrappedMModelOnInvalidMCharacterWith2ValidMModels = `
<m-character src="/assets/avatar/parts/SK_Outfit_Body_Male.glb">
  <m-model src="/assets/avatar/parts/SK_Outfit_Hat_02.glb"></m-model>
  <m-model src="/assets/avatar/parts/SK_Outfit_Two_Long_Coat_with_Collared_Shirt_adsfadsfasdfda01.glb"></m-model>
  <m-model src="/assets/avatar/parts/SK_Outfit_Three_Tight_Jeans_with_Chain_01.glb"></m-model>
  <m-model src="/assets/avatar/parts/SK_Outfit_Three_Tight_Jeans_with_Chain_01.glb"></m-model>
</m-character>

<m-character src="/assets/avatar/parts/SK_Outfit_Body_Male.glb">
  <m-model src="/assets/avatar/parts/SK_Outfit_Hat_02.glb"></m-model>
  <div>
    <m-model src="/assets/avatar/parts/SK_Outfit_Three_Tight_Jeans_with_Chain_01.glb"></m-model>
    <m-model src="/assets/avatar/parts/SK_Outfit_Three_Tight_Jeans_with_Chain_01.glb"></m-model>
  </div>
  <m-model src="/assets/avatar/parts/SK_Outfit_Two_Long_Coat_with_Collared_Shirt_adsfadsfasdfda01.glb"></m-model>
</m-character>
`;

export const twoInvalidlyWrappedMModelOnInvalidMCharacterWith2ValidMModelsExpectedData = {
  base: { url: "/assets/avatar/parts/SK_Outfit_Body_Male.glb" },
  parts: [
    { url: "/assets/avatar/parts/SK_Outfit_Hat_02.glb" },
    {
      url: "/assets/avatar/parts/SK_Outfit_Two_Long_Coat_with_Collared_Shirt_adsfadsfasdfda01.glb",
    },
    {
      url: "/assets/avatar/parts/SK_Outfit_Three_Tight_Jeans_with_Chain_01.glb",
    },
    {
      url: "/assets/avatar/parts/SK_Outfit_Three_Tight_Jeans_with_Chain_01.glb",
    },
  ],
};

export const validMCharacterWithOneInvalidMModel = `
<m-character src="/assets/avatar/parts/SK_Outfit_Body_Male.glb">
  <m-model src="/assets/avatar/parts/SK_Outfit_Hat_02.glb"></m-model>
  <m-model src="/assets/avatar/parts/abcdefg0123456_invalid_asset.glb"></m-model>
</m-character>
`;

export const validMCharacterWithTwoInvalidMModels = `
<m-character src="/assets/avatar/parts/SK_Outfit_Body_Male.glb">
  <m-model src="/assets/avatar/parts/SK_Outfit_Hat_02.glb"></m-model>
  <m-model src="/assets/avatar/parts/abcdefg0123456_invalid_asset.glb"></m-model>
  <m-model src="/assets/avatar/parts/hijklmn7890123_invalid_asset.glb"></m-model>
</m-character>
`;
