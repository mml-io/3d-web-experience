import { MMLCharacterDescription } from "./parseMMLDescription";

export const createMMLCharacterString = (characterDescription: MMLCharacterDescription): string => {
  const base = characterDescription.base.url;

  const partsTags = characterDescription.parts.map(
    (part) => `<m-model src="${part.url}"></m-model>`,
  );

  return `<m-character src="${base}">
  ${partsTags.join("\n  ")}
</m-character>`;
};
