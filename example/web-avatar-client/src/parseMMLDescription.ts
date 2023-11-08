import { MMLCharacterDescription, MMLCharacterDescriptionPart } from "./AvatarEditor";

export const parseMMLDescription = (mmlDescription: string): MMLCharacterDescription => {
  const parser: DOMParser = new DOMParser();
  const doc = parser.parseFromString(mmlDescription, "text/html");

  const tag = (count: number) => {
    return count > 1 ? "tags" : "tag";
  };

  const characters = Array.from(doc.body.children).filter(
    (child) => child.tagName.toLowerCase() === "m-character",
  );
  const validCharacter = characters.shift();

  if (characters.length > 0) {
    const tagStr = tag(characters.length);
    console.warn(
      `ignoring ${characters.length} extra <m-character> ${tagStr} found in the root of the document (only the first one is valid).`,
    );
  }

  const nestedCharacters = doc.querySelectorAll("body * m-character");
  if (nestedCharacters.length > 0) {
    const tagStr = tag(nestedCharacters.length);
    console.warn(
      `ignoring ${nestedCharacters.length} nested <m-character> ${tagStr} found within other tags. A valid <m-character> tag must be at the root of the document.`,
    );
  }

  const rootModels = Array.from(doc.body.children).filter(
    (child) => child.tagName.toLowerCase() === "m-model",
  );
  if (rootModels.length > 0) {
    const tagStr = tag(rootModels.length);
    console.warn(
      `ignoring ${rootModels.length} <m-model> ${tagStr} were found at the root of the document (<m-model> tags must be children of a valid <m-character> tag).`,
    );
  }

  let base: MMLCharacterDescriptionPart = { url: "" };
  let parts: MMLCharacterDescriptionPart[] = [];

  if (validCharacter) {
    const baseSrc = validCharacter.getAttribute("src") ?? "";
    base = { url: baseSrc };

    const directModelChildren = Array.from(validCharacter.children).filter(
      (child) => child.tagName.toLowerCase() === "m-model",
    );
    parts = directModelChildren.map((model) => {
      const partSrc = model.getAttribute("src") ?? "";
      return { url: partSrc };
    });

    const wrappedModelTags = Array.from(doc.querySelectorAll("m-character m-model")).filter(
      (model) => !directModelChildren.includes(model),
    );
    if (wrappedModelTags.length > 0) {
      const tagStr = tag(wrappedModelTags.length);
      console.warn(
        `ignoring ${wrappedModelTags.length} <m-model> ${tagStr} that were found wrapped inside tags other than a valid <m-character> tag.`,
      );
    }
  } else {
    console.warn(`No valid <m-character> tag was found in the provided document.`);
  }

  const characterDescription: MMLCharacterDescription = {
    base: base,
    parts: parts,
  };

  return characterDescription;
};
