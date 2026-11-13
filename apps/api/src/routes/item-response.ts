import type { Item } from "@mycollections/core";
import type { DatabaseHandle } from "@mycollections/db";

/** What a row needs to show an item's primary image without another request. */
export interface PrimaryMedia {
  id: string;
  width: number;
  height: number;
}

export type ItemResponse = Item & { primaryMedia: PrimaryMedia | null };

/**
 * Adds each item's primary image to an item response (#37). Every route that
 * answers with an item goes through here: the web patches its list cache from
 * a PATCH response, so one route answering without the field would make a
 * status change wipe the row's thumbnail.
 *
 * An API response shape, deliberately not part of `Item`: the repository's
 * items feed the JSON export, which must not gain an unversioned key.
 */
export async function withPrimaryMedia(db: DatabaseHandle, items: readonly Item[]): Promise<ItemResponse[]> {
  const primaries = await db.media.primaryForItems(items.map((item) => item.id));
  return items.map((item) => {
    const media = primaries.get(item.id);
    return { ...item, primaryMedia: media ? { id: media.id, width: media.width, height: media.height } : null };
  });
}

export async function oneWithPrimaryMedia(db: DatabaseHandle, item: Item): Promise<ItemResponse> {
  const [response] = await withPrimaryMedia(db, [item]);
  return response as ItemResponse;
}
