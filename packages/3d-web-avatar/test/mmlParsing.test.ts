/**
 * @jest-environment jsdom
 */

import { parseMMLDescription } from "../src";
import { createMMLCharacterString } from "../src/helpers/createMMLCharacterString";
import { MMLCharacterDescription } from "../src/helpers/parseMMLDescription";

import {
  semanticallyInvalidString,
  threeNestedMCharacters,
  threeNestedMCharactersExpectedData,
  threeRogueMModels,
  threeRogueMModelsExpectedData,
  twoInvalidlyWrappedMModel,
  twoInvalidlyWrappedMModelExpectedData,
  twoInvalidlyWrappedMModelOnInvalidMCharacterWith2ValidMModels,
  twoInvalidlyWrappedMModelOnInvalidMCharacterWith2ValidMModelsExpectedData,
  twoRedundantMCharacterswithThreeMModelsEach,
  twoRedundantMCharacterswithThreeMModelsEachExpectedData,
  validMCharacter,
  validMCharacterWithHostRelativeUrl,
  validMCharacterWithHostRelativeUrlExpectedData,
  validMCharacterWithNoSocket,
  validMCharacterWithNoSocketExpectedData,
  validMCharacterWithPathRelativeUrl,
  validMCharacterWithPathRelativeUrlExpectedData,
  validMCharacterWithRedundantMCharacterClosingTag,
  validMCharacterWithRedundantMCharacterClosingTagExpectedData,
  validMCharacterWithRedundantMModelClosingTag,
  validMCharacterWithRedundantMModelClosingTagExpectedData,
  validMCharacterWithSocketAndPosition,
  validMCharacterWithSocketAndPositionExpectedData,
  validMCharacterWithSocketAndRotationInOneAxis,
  validMCharacterWithSocketAndRotationInOneAxisExpectedData,
  validMCharacterWithSocketAttributes,
  validMCharacterWithSocketAttributesExpectedData,
} from "./test-data";
import { extractNumberFromErrorMessage } from "./test-utils";

describe("WebAvatarClient Test Utils", () => {
  it("extractNumberFromErrorMessage should extract the number correctly from the error message", () => {
    let err = "ignoring 1 <m-model> tag that were found..";
    expect(extractNumberFromErrorMessage(err)).toBe(1);
    err = "ignoring 4 <m-model> tags that were found..";
    expect(extractNumberFromErrorMessage(err)).toBe(4);
    err = "ignoring 8 <m-character> tags that were found...";
    expect(extractNumberFromErrorMessage(err)).toBe(8);
  });
});

describe("WebAvatarClient MML Parsing", () => {
  test("valid <m-character> tag", async () => {
    const [, errors] = parseMMLDescription(validMCharacter, null);
    expect(errors).toHaveLength(0);
  });

  test("empty MML document should return one 'no valid tag found' error", async () => {
    const emptyDocument = "";
    const expectedData = { base: { url: "" }, parts: [] };
    const [parsedData, errors] = parseMMLDescription(emptyDocument, null);
    expect(errors).toHaveLength(1);
    expect(
      errors[0].includes("No valid <m-character> tag was found in the provided document."),
    ).toBe(true);
    expect(parsedData).toStrictEqual(expectedData);
  });

  test("2 redundant <m-character> tags with 3 <m-model> tags each", async () => {
    const [parsedData, errors] = parseMMLDescription(
      twoRedundantMCharacterswithThreeMModelsEach,
      null,
    );
    expect(errors).toHaveLength(2);
    expect(extractNumberFromErrorMessage(errors[0])).toBe(2);
    expect(extractNumberFromErrorMessage(errors[1])).toBe(6);
    expect(parsedData).toStrictEqual(twoRedundantMCharacterswithThreeMModelsEachExpectedData);
  });

  test("3 nested <m-character> tags with 2 <m-model> tags each", async () => {
    const [parsedData, errors] = parseMMLDescription(threeNestedMCharacters, null);
    expect(errors).toHaveLength(2);
    expect(extractNumberFromErrorMessage(errors[0])).toBe(3);
    expect(extractNumberFromErrorMessage(errors[1])).toBe(6);
    expect(parsedData).toStrictEqual(threeNestedMCharactersExpectedData);
  });

  test("3 rogue <m-model> tags", async () => {
    const [parsedData, errors] = parseMMLDescription(threeRogueMModels, null);
    expect(errors).toHaveLength(1);
    expect(errors[0].includes("<m-model> tags must be children of a valid <m-character> tag")).toBe(
      true,
    );
    expect(extractNumberFromErrorMessage(errors[0])).toBe(3);
    expect(parsedData).toStrictEqual(threeRogueMModelsExpectedData);
  });

  test("2 invalidly wrapped <m-model> tags in a valid <m-character> tag", async () => {
    const [parsedData, errors] = parseMMLDescription(twoInvalidlyWrappedMModel, null);
    expect(errors).toHaveLength(1);
    expect(extractNumberFromErrorMessage(errors[0])).toBe(2);
    expect(parsedData).toStrictEqual(twoInvalidlyWrappedMModelExpectedData);
  });

  test("2 invalidly wrapped <m-model> tags in an invalid <m-character> tag", async () => {
    const [parsedData, errors] = parseMMLDescription(
      twoInvalidlyWrappedMModelOnInvalidMCharacterWith2ValidMModels,
      null,
    );
    expect(errors).toHaveLength(2);
    expect(errors[0].includes("only the first one is valid")).toBe(true);
    expect(extractNumberFromErrorMessage(errors[1])).toBe(4);
    expect(parsedData).toStrictEqual(
      twoInvalidlyWrappedMModelOnInvalidMCharacterWith2ValidMModelsExpectedData,
    );
  });

  test("valid <m-character> but with redundant <m-model> closing tag", async () => {
    const [parsedData, errors] = parseMMLDescription(
      validMCharacterWithRedundantMModelClosingTag,
      null,
    );
    expect(errors).toHaveLength(0);
    expect(parsedData).toStrictEqual(validMCharacterWithRedundantMModelClosingTagExpectedData);
  });

  test("valid <m-character> but with redundant <m-character> closing tag", async () => {
    const [parsedData, errors] = parseMMLDescription(
      validMCharacterWithRedundantMCharacterClosingTag,
      null,
    );
    expect(errors).toHaveLength(0);
    expect(parsedData).toStrictEqual(validMCharacterWithRedundantMCharacterClosingTagExpectedData);
  });

  test("semantically invalid string should return one 'no valid tag found' error", async () => {
    const [parsedData, errors] = parseMMLDescription(semanticallyInvalidString, null);
    const expectedData = { base: { url: "" }, parts: [] };
    expect(errors).toHaveLength(1);
    expect(
      errors[0].includes("No valid <m-character> tag was found in the provided document."),
    ).toBe(true);
    expect(parsedData).toStrictEqual(expectedData);
  });
});

describe("Check <m-character> with socketed <m-model> objects", () => {
  test("valid <m-character> tag with <m-model> socket attributes", async () => {
    const [parsedData, errors] = parseMMLDescription(validMCharacterWithSocketAttributes, null);
    expect(errors).toHaveLength(0);
    expect(parsedData).toStrictEqual(validMCharacterWithSocketAttributesExpectedData);
  });
  test("valid <m-character> with only position attributes", async () => {
    const [parsedData, errors] = parseMMLDescription(validMCharacterWithSocketAndPosition, null);
    expect(errors).toHaveLength(0);
    expect(parsedData).toStrictEqual(validMCharacterWithSocketAndPositionExpectedData);
  });

  test("valid <m-character> with rotation in only one axis", async () => {
    const [parsedData, errors] = parseMMLDescription(
      validMCharacterWithSocketAndRotationInOneAxis,
      null,
    );
    expect(errors).toHaveLength(0);
    expect(parsedData).toStrictEqual(validMCharacterWithSocketAndRotationInOneAxisExpectedData);
  });

  test("valid <m-character> with no socket attribute", async () => {
    const [parsedData, errors] = parseMMLDescription(validMCharacterWithNoSocket, null);
    expect(errors).toHaveLength(0);
    expect(parsedData).toStrictEqual(validMCharacterWithNoSocketExpectedData);
  });

  test("valid <m-character> with host relative URL", async () => {
    const [parsedData, errors] = parseMMLDescription(
      validMCharacterWithHostRelativeUrl,
      "https://example.com",
    );
    expect(errors).toHaveLength(0);
    expect(parsedData).toStrictEqual(validMCharacterWithHostRelativeUrlExpectedData);
  });

  test("valid <m-character> with path relative URL", async () => {
    const [parsedData, errors] = parseMMLDescription(
      validMCharacterWithPathRelativeUrl,
      "https://example.com/foo/bar.html",
    );
    expect(errors).toHaveLength(0);
    expect(parsedData).toStrictEqual(validMCharacterWithPathRelativeUrlExpectedData);
  });
});

describe("createMMLCharacterString round-trip", () => {
  test("basic round-trip with base and 2 parts", () => {
    const description: MMLCharacterDescription = {
      base: { url: "https://example.com/base.glb" },
      parts: [{ url: "https://example.com/hair.glb" }, { url: "https://example.com/shoes.glb" }],
    };

    const mmlString = createMMLCharacterString(description);
    const [parsed, errors] = parseMMLDescription(mmlString, null);

    expect(errors).toHaveLength(0);
    expect(parsed.base.url).toBe("https://example.com/base.glb");
    expect(parsed.parts).toHaveLength(2);
    expect(parsed.parts[0].url).toBe("https://example.com/hair.glb");
    expect(parsed.parts[1].url).toBe("https://example.com/shoes.glb");
  });

  test("round-trip with type attribute (type is not preserved by parser)", () => {
    const description: MMLCharacterDescription = {
      base: { url: "https://example.com/base.glb" },
      parts: [{ url: "https://example.com/hat.glb", type: "accessory" }],
    };

    const mmlString = createMMLCharacterString(description);
    // Verify the generated string contains the type attribute
    expect(mmlString).toContain('type="accessory"');

    const [parsed, errors] = parseMMLDescription(mmlString, null);

    expect(errors).toHaveLength(0);
    expect(parsed.base.url).toBe("https://example.com/base.glb");
    expect(parsed.parts).toHaveLength(1);
    expect(parsed.parts[0].url).toBe("https://example.com/hat.glb");
    // parseMMLDescription does not extract the type attribute, so it is lost
    expect(parsed.parts[0].type).toBeUndefined();
  });

  test("generation without parts", () => {
    const description: MMLCharacterDescription = {
      base: { url: "https://example.com/character.glb" },
      parts: [],
    };

    const mmlString = createMMLCharacterString(description);
    const [parsed, errors] = parseMMLDescription(mmlString, null);

    expect(errors).toHaveLength(0);
    expect(parsed.base.url).toBe("https://example.com/character.glb");
    expect(parsed.parts).toHaveLength(0);
  });

  test("round-trip with multiple parts", () => {
    const description: MMLCharacterDescription = {
      base: { url: "https://example.com/base.glb" },
      parts: [
        { url: "https://example.com/hair.glb" },
        { url: "https://example.com/jacket.glb" },
        { url: "https://example.com/pants.glb" },
        { url: "https://example.com/boots.glb" },
      ],
    };

    const mmlString = createMMLCharacterString(description);
    const [parsed, errors] = parseMMLDescription(mmlString, null);

    expect(errors).toHaveLength(0);
    expect(parsed.base.url).toBe("https://example.com/base.glb");
    expect(parsed.parts).toHaveLength(4);
    expect(parsed.parts[0].url).toBe("https://example.com/hair.glb");
    expect(parsed.parts[1].url).toBe("https://example.com/jacket.glb");
    expect(parsed.parts[2].url).toBe("https://example.com/pants.glb");
    expect(parsed.parts[3].url).toBe("https://example.com/boots.glb");
  });

  test("direct generation produces expected MML markup", () => {
    const description: MMLCharacterDescription = {
      base: { url: "https://example.com/base.glb" },
      parts: [
        { url: "https://example.com/hair.glb" },
        { url: "https://example.com/hat.glb", type: "accessory" },
      ],
    };

    const mmlString = createMMLCharacterString(description);

    expect(mmlString).toContain('<m-character src="https://example.com/base.glb">');
    expect(mmlString).toContain('<m-model src="https://example.com/hair.glb"></m-model>');
    expect(mmlString).toContain(
      '<m-model src="https://example.com/hat.glb" type="accessory"></m-model>',
    );
    expect(mmlString).toContain("</m-character>");
  });
});
