/**
 * @jest-environment jsdom
 */

import { parseMMLDescription } from "@mml-io/3d-web-avatar";

import { findAssetsInCollection } from "../src";

import collectionData from "./collection.json";
import {
  validMCharacterWithOneInvalidMModel,
  validMCharacterWithTwoInvalidMModels,
} from "./test-data";

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
