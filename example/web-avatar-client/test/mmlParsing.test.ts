/**
 * @jest-environment jsdom
 */

import collectionData from "../src/collection.json";
import { findAssetsInCollection } from "../src/findAssetsInCollection";
import { parseMMLDescription } from "../src/parseMMLDescription";

import {
  threeNestedMCharacters,
  threeRogueMModels,
  twoInvalidlyWrappedMModel,
  twoInvalidlyWrappedMModelOnInvalidMCharacterWith2ValidMModels,
  twoRedundantMCharacterswithThreeMModelsEach,
  validMCharacter,
  validMCharacterWithOneInvalidMModel,
  validMCharacterWithTwoInvalidMModels,
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
    const [, errors] = parseMMLDescription(validMCharacter);
    expect(errors).toHaveLength(0);
  });
  test("empty MML document should return one 'no valid tag found' error", async () => {
    const emptyDocument = "";
    const [, errors] = parseMMLDescription(emptyDocument);
    expect(errors).toHaveLength(1);
    expect(
      errors[0].includes("No valid <m-character> tag was found in the provided document."),
    ).toBe(true);
  });
  test("2 redundant <m-character> tags with 3 <m-model> tags each", async () => {
    const [, errors] = parseMMLDescription(twoRedundantMCharacterswithThreeMModelsEach);
    expect(errors).toHaveLength(2);
    expect(extractNumberFromErrorMessage(errors[0])).toBe(2);
    expect(extractNumberFromErrorMessage(errors[1])).toBe(6);
  });
  test("3 nested <m-character> tags with 2 <m-model> tags each", async () => {
    const [, errors] = parseMMLDescription(threeNestedMCharacters);
    expect(errors).toHaveLength(2);
    expect(extractNumberFromErrorMessage(errors[0])).toBe(3);
    expect(extractNumberFromErrorMessage(errors[1])).toBe(6);
  });
  test("3 rogue <m-model> tags", async () => {
    const [, errors] = parseMMLDescription(threeRogueMModels);
    expect(errors).toHaveLength(1);
    expect(errors[0].includes("<m-model> tags must be children of a valid <m-character> tag")).toBe(
      true,
    );
    expect(extractNumberFromErrorMessage(errors[0])).toBe(3);
  });
  test("2 invalidly wrapped <m-model> tags in a valid <m-character> tag", async () => {
    const [, errors] = parseMMLDescription(twoInvalidlyWrappedMModel);
    expect(errors).toHaveLength(1);
    expect(extractNumberFromErrorMessage(errors[0])).toBe(2);
  });
  test("2 invalidly wrapped <m-model> tags in an invalid <m-character> tag", async () => {
    const [, errors] = parseMMLDescription(
      twoInvalidlyWrappedMModelOnInvalidMCharacterWith2ValidMModels,
    );
    expect(errors).toHaveLength(2);
    expect(errors[0].includes("only the first one is valid")).toBe(true);
    expect(extractNumberFromErrorMessage(errors[1])).toBe(4);
  });
});

describe("Check <m-character> against collection", () => {
  test("valid <m-character> tag with 1 invalid <m-model> asset", async () => {
    const [characterDescription, parsingErrors] = parseMMLDescription(
      validMCharacterWithOneInvalidMModel,
    );
    expect(parsingErrors).toHaveLength(0);
    const checkCollection = findAssetsInCollection(
      collectionData,
      characterDescription,
      parsingErrors,
    );
    expect(checkCollection.accumulatedErrors).toHaveLength(1);
  });
  test("valid <m-character> tag with 2 invalid <m-model> asset", async () => {
    const [characterDescription, parsingErrors] = parseMMLDescription(
      validMCharacterWithTwoInvalidMModels,
    );
    expect(parsingErrors).toHaveLength(0);
    const checkCollection = findAssetsInCollection(
      collectionData,
      characterDescription,
      parsingErrors,
    );
    expect(checkCollection.accumulatedErrors).toHaveLength(2);
  });
});
