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
