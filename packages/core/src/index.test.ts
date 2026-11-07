import { describe, expect, it } from "vitest";
import * as core from "./index.js";

describe("@mycollections/core public surface", () => {
  it("exports the expected symbols", () => {
    const keys = new Set(Object.keys(core));
    for (const name of [
      "PLUGIN_API_VERSION",
      "ITEM_STATUSES",
      "ItemStatusSchema",
      "BUILT_IN_FIELD_TYPES",
      "FieldDefinitionSchema",
      "CollectionSchema",
      "TARGET_COUNT_MAX",
      "COLLECTION_NAME_MAX",
      "COLLECTION_DESCRIPTION_MAX",
      "collectionProgress",
      "ItemCountsSchema",
      "ItemSchema",
      "MediaSchema",
    ]) {
      expect(keys.has(name)).toBe(true);
    }
  });
});
