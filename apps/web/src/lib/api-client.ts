import type {
  Collection,
  CollectionWithItemCount,
  DeletedItem,
  FieldDefinition,
  Item,
  ItemCounts,
  ItemStatus,
  ItemView,
  Media,
} from "@mycollections/core";
import { getToken } from "./token.js";

export interface CreateCollectionInput {
  name: string;
  description?: string;
  fields: FieldDefinition[];
  isFiniteSet: boolean;
  /**
   * How many items a finite set has (#42), 1–`TARGET_COUNT_MAX`, or `null` for
   * none. Only a finite set may carry one: the server refuses a number here
   * alongside `isFiniteSet: false`. In an edit, `null` clears the stored target
   * and an omitted key leaves it alone — except that turning finite off clears it
   * either way.
   */
  targetCount?: number | null;
}

export interface ItemInput {
  status?: ItemStatus;
  fields: Record<string, unknown>;
}

const BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

export class ApiError extends Error {
  constructor(public readonly status: number) {
    super(`API error ${status}`);
  }
}

export class UnauthorizedError extends ApiError {
  constructor() {
    super(401);
  }
}

/**
 * A pairing code the API refused (#241): wrong, already used, or expired — the API
 * deliberately does not say which. Its own class, not `UnauthorizedError`, because
 * that one sends the whole app back to `/setup`, which is where pairing happens.
 */
export class PairingRejectedError extends ApiError {
  constructor() {
    super(401);
  }
}

/**
 * Trades a one-time pairing code for the device token (#241).
 *
 * Not built on `request()`: that attaches the stored token, which during pairing is
 * missing or stale, and turns a 401 into `UnauthorizedError` for the global recovery.
 */
export async function pair(code: string): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/pair`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
  if (res.status === 401) throw new PairingRejectedError();
  if (!res.ok) throw new ApiError(res.status);
  const body = (await res.json()) as { token?: unknown };
  if (typeof body.token !== "string" || body.token.trim() === "") throw new ApiError(res.status);
  return body.token;
}

/**
 * Re-exported rather than defined here: the token needs guarding against a
 * browser that will not store anything (#279), and `token.js` is where that
 * lives. Every caller and every test mock still reaches it through this module.
 */
export { clearToken, getToken, isTokenSessionOnly, setToken } from "./token.js";

async function request(path: string, init?: RequestInit): Promise<Response> {
  const token = getToken();
  const headers = new Headers(init?.headers);
  // Only declare a JSON body when there is one: sending Content-Type:
  // application/json on a request with no body (e.g. DELETE) makes the server
  // reject it as an empty JSON body. Every JSON body here is a string; a
  // FormData upload (#37) must carry the browser's own multipart type, boundary
  // included, so it is left alone.
  if (typeof init?.body === "string") headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(`${BASE_URL}${path}`, { ...init, headers });
  if (res.status === 401) throw new UnauthorizedError();
  return res;
}

export async function listCollections(): Promise<CollectionWithItemCount[]> {
  const res = await request("/api/collections");
  if (!res.ok) throw new ApiError(res.status);
  return res.json() as Promise<CollectionWithItemCount[]>;
}

export async function createCollection(input: CreateCollectionInput): Promise<Collection> {
  const res = await request("/api/collections", { method: "POST", body: JSON.stringify(input) });
  if (!res.ok) throw new ApiError(res.status);
  return res.json() as Promise<Collection>;
}

/**
 * A collection edit. `fields` replaces the whole schema rather than describing a
 * delta, so send the field list you want to end up with. The server keeps values
 * stored under a field id that leaves the schema, and refuses to change an
 * existing field's type while the collection holds items.
 */
export type UpdateCollectionInput = Partial<CreateCollectionInput> & {
  /** How the collection's page lays out its items (#38); an omitted key keeps the stored view. */
  itemView?: ItemView;
};

export async function updateCollection(id: string, input: UpdateCollectionInput): Promise<Collection> {
  const res = await request(`/api/collections/${id}`, { method: "PATCH", body: JSON.stringify(input) });
  if (!res.ok) throw new ApiError(res.status);
  return res.json() as Promise<Collection>;
}

export async function getCollection(id: string): Promise<Collection> {
  const res = await request(`/api/collections/${id}`);
  if (!res.ok) throw new ApiError(res.status);
  return res.json() as Promise<Collection>;
}

/**
 * A collection's live items, in total and per status (#42) — what the
 * collection header measures a finite set's progress with. A trashed or unknown
 * collection is a 404, which rejects here rather than reading as zeros.
 */
export async function getCollectionCounts(id: string): Promise<ItemCounts> {
  const res = await request(`/api/collections/${id}/counts`);
  if (!res.ok) throw new ApiError(res.status);
  return res.json() as Promise<ItemCounts>;
}

/** What a tag change touched: live items, and trashed ones counted apart. */
export interface TagChange {
  updated: number;
  trashed: number;
}

/** Renames a tag across a collection's items (#41); answers how many changed. */
export async function renameTag(
  collectionId: string,
  input: { field: string; from: string; to: string },
): Promise<TagChange & { merged: boolean }> {
  const res = await request(`/api/collections/${collectionId}/tags/rename`, {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new ApiError(res.status);
  return res.json() as Promise<TagChange & { merged: boolean }>;
}

/** Removes a tag from a collection's items (#41); answers how many changed. */
export async function removeTag(collectionId: string, input: { field: string; value: string }): Promise<TagChange> {
  const res = await request(`/api/collections/${collectionId}/tags/remove`, {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new ApiError(res.status);
  return res.json() as Promise<TagChange>;
}

/** What a list of items is narrowed and ordered by (#41). Empty values are left out of the request. */
export interface ItemListQuery {
  status?: ItemStatus;
  /** Search text; trimmed, and not sent when nothing is left. */
  q?: string;
  /** A sort key in core's `formatItemSort` form. */
  sort?: string;
  /** A filter list in core's `formatItemFilters` form. */
  filter?: string;
}

/** The tags in use in one tags field, most used first (#41). */
export interface TagValues {
  values: { value: string; count: number }[];
  truncated: boolean;
}

export async function getTagValues(collectionId: string, fieldId: string, q?: string): Promise<TagValues> {
  const params = new URLSearchParams({ field: fieldId });
  if (q?.trim()) params.set("q", q.trim());
  const res = await request(`/api/collections/${collectionId}/tag-values?${params.toString()}`);
  if (!res.ok) throw new ApiError(res.status);
  return res.json() as Promise<TagValues>;
}

export async function listItems(collectionId: string, query: ItemListQuery = {}): Promise<ItemWithMedia[]> {
  const params = new URLSearchParams();
  if (query.status) params.set("status", query.status);
  const q = query.q?.trim();
  if (q) params.set("q", q);
  if (query.sort) params.set("sort", query.sort);
  if (query.filter) params.set("filter", query.filter);
  // toString, not `params.size`, which Safari 16 and Chrome 111 lack.
  const encoded = params.toString();
  const search = encoded ? `?${encoded}` : "";
  const res = await request(`/api/collections/${collectionId}/items${search}`);
  if (!res.ok) throw new ApiError(res.status);
  return res.json() as Promise<ItemWithMedia[]>;
}

export async function createItem(collectionId: string, input: ItemInput): Promise<Item> {
  const res = await request(`/api/collections/${collectionId}/items`, {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new ApiError(res.status);
  return res.json() as Promise<Item>;
}

export async function updateItem(collectionId: string, itemId: string, input: ItemInput): Promise<Item> {
  const res = await request(`/api/collections/${collectionId}/items/${itemId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new ApiError(res.status);
  return res.json() as Promise<Item>;
}

/**
 * Changes an item's status and nothing else (#42, R14) — a row's Mark
 * collected. The body is `{ status }` alone, never the item's fields: the row
 * holds the fields as last fetched, and sending them back would overwrite an
 * edit made since in another tab or device with a stale copy. The server
 * leaves whatever is not in the body as it is stored.
 */
export async function setItemStatus(collectionId: string, itemId: string, status: ItemStatus): Promise<Item> {
  const res = await request(`/api/collections/${collectionId}/items/${itemId}`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
  if (!res.ok) throw new ApiError(res.status);
  return res.json() as Promise<Item>;
}

/**
 * Undoes a soft delete. Sends no body, so `request` leaves the JSON Content-Type
 * off — the server rejects a declared-but-empty JSON body (#202).
 */
export async function restoreItem(collectionId: string, itemId: string): Promise<Item> {
  const res = await request(`/api/collections/${collectionId}/items/${itemId}/restore`, { method: "POST" });
  if (!res.ok) throw new ApiError(res.status);
  return res.json() as Promise<Item>;
}

export async function deleteItem(collectionId: string, itemId: string): Promise<void> {
  const res = await request(`/api/collections/${collectionId}/items/${itemId}`, { method: "DELETE" });
  if (!res.ok) throw new ApiError(res.status);
}

/**
 * What the trash holds. Items of a trashed collection are deliberately absent —
 * the server excludes them because they come back with their collection, so the
 * UI never has to offer a restore it cannot honor (#281).
 */
export interface Trash {
  collections: Collection[];
  items: DeletedItem[];
}

/** How much emptying the trash destroyed, for the message that says so. */
export interface EmptyTrashResult {
  items: number;
  collections: number;
}

export async function listTrash(): Promise<Trash> {
  const res = await request("/api/trash");
  if (!res.ok) throw new ApiError(res.status);
  return res.json() as Promise<Trash>;
}

/** Undoes a collection's soft delete, bringing its items back with it. Sends no body, like `restoreItem`. */
export async function restoreCollection(id: string): Promise<Collection> {
  const res = await request(`/api/collections/${id}/restore`, { method: "POST" });
  if (!res.ok) throw new ApiError(res.status);
  return res.json() as Promise<Collection>;
}

/**
 * Destroys one trashed item for good. Deliberately a different path from
 * `deleteItem` — permanent deletion is never a parameter away from the
 * everyday delete that undo can still reverse.
 */
export async function purgeItem(itemId: string): Promise<void> {
  const res = await request(`/api/trash/items/${itemId}`, { method: "DELETE" });
  if (!res.ok) throw new ApiError(res.status);
}

export async function purgeCollection(id: string): Promise<void> {
  const res = await request(`/api/trash/collections/${id}`, { method: "DELETE" });
  if (!res.ok) throw new ApiError(res.status);
}

export async function emptyTrash(): Promise<EmptyTrashResult> {
  const res = await request("/api/trash", { method: "DELETE" });
  if (!res.ok) throw new ApiError(res.status);
  return res.json() as Promise<EmptyTrashResult>;
}

export interface ImportSummary {
  collectionsImported: number;
  collectionsSkipped: number;
  itemsImported: number;
  itemsSkipped: number;
}

/** Fetches the full backup document as a Blob suitable for a browser download. */
export async function exportData(): Promise<Blob> {
  const res = await request("/api/export");
  if (!res.ok) throw new ApiError(res.status);
  return res.blob();
}

/** Sends a parsed backup document to the server and returns the import summary. */
export async function importData(document: unknown): Promise<ImportSummary> {
  const res = await request("/api/import", { method: "POST", body: JSON.stringify(document) });
  if (!res.ok) throw new ApiError(res.status);
  return res.json() as Promise<ImportSummary>;
}

/**
 * What an item response carries about the item's primary image (#37): enough
 * for a row to reserve the thumbnail's space before the bytes arrive.
 */
export interface PrimaryMedia {
  id: string;
  width: number;
  height: number;
}

/**
 * An item as the API answers with it: the stored item plus its primary image.
 * Optional in the type only so a stored `Item` (a test fixture, a cache entry
 * written before #37) still fits; the server always sends it.
 */
export type ItemWithMedia = Item & { primaryMedia?: PrimaryMedia | null };

export async function getItem(collectionId: string, itemId: string): Promise<ItemWithMedia> {
  const res = await request(`/api/collections/${collectionId}/items/${itemId}`);
  if (!res.ok) throw new ApiError(res.status);
  return res.json() as Promise<ItemWithMedia>;
}

/** An item's live images in order; the first is its primary. */
export async function listMedia(collectionId: string, itemId: string): Promise<Media[]> {
  const res = await request(`/api/collections/${collectionId}/items/${itemId}/media`);
  if (!res.ok) throw new ApiError(res.status);
  return res.json() as Promise<Media[]>;
}

export type UploadSource = "user-attached" | "user-camera";

/**
 * Uploads one image. A refusal rejects with its status, which the page words
 * its message from: 415 not an image it accepts, 413 too large, 409 the item
 * is full, 503 the server is busy with other images.
 */
export async function uploadMedia(
  collectionId: string,
  itemId: string,
  file: Blob,
  source: UploadSource,
): Promise<Media> {
  const body = new FormData();
  body.append("file", file);
  const res = await request(`/api/collections/${collectionId}/items/${itemId}/media?source=${source}`, {
    method: "POST",
    body,
  });
  if (!res.ok) throw new ApiError(res.status);
  return res.json() as Promise<Media>;
}

export type MediaVariant = "display" | "thumb";

/**
 * An image's bytes. Fetched rather than pointed at by an `<img src>`, which
 * cannot send the token; the caller turns the blob into an object URL.
 */
export async function fetchMediaBlob(
  collectionId: string,
  itemId: string,
  mediaId: string,
  variant: MediaVariant,
): Promise<Blob> {
  const res = await request(`/api/collections/${collectionId}/items/${itemId}/media/${mediaId}/${variant}`);
  if (!res.ok) throw new ApiError(res.status);
  return res.blob();
}

/**
 * Puts an item's live images in this order (#37). Every live image exactly
 * once, or the server answers 409: the list on screen was stale.
 */
export async function reorderMedia(collectionId: string, itemId: string, ids: string[]): Promise<Media[]> {
  const res = await request(`/api/collections/${collectionId}/items/${itemId}/media/order`, {
    method: "PUT",
    body: JSON.stringify({ ids }),
  });
  if (!res.ok) throw new ApiError(res.status);
  return res.json() as Promise<Media[]>;
}

/** Moves an image to the front, which is what makes it the cover. Answers the new order. */
export async function makeCover(collectionId: string, itemId: string, mediaId: string): Promise<Media[]> {
  const res = await request(`/api/collections/${collectionId}/items/${itemId}/media/${mediaId}/make-primary`, {
    method: "POST",
  });
  if (!res.ok) throw new ApiError(res.status);
  return res.json() as Promise<Media[]>;
}

/** A soft delete: the server keeps the files until the trash is emptied, so Undo can bring it back. */
export async function deleteMedia(collectionId: string, itemId: string, mediaId: string): Promise<void> {
  const res = await request(`/api/collections/${collectionId}/items/${itemId}/media/${mediaId}`, { method: "DELETE" });
  if (!res.ok) throw new ApiError(res.status);
}

/** Undoes `deleteMedia`, putting the image back in its place. */
export async function restoreMedia(collectionId: string, itemId: string, mediaId: string): Promise<Media> {
  const res = await request(`/api/collections/${collectionId}/items/${itemId}/media/${mediaId}/restore`, {
    method: "POST",
  });
  if (!res.ok) throw new ApiError(res.status);
  return res.json() as Promise<Media>;
}
