import type { Collection, CollectionWithItemCount, FieldDefinition, Item, ItemStatus } from "@mycollections/core";

export interface CreateCollectionInput {
  name: string;
  description?: string;
  fields: FieldDefinition[];
  isFiniteSet: boolean;
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

export function getToken(): string | null {
  return localStorage.getItem("api_token");
}

export function setToken(token: string): void {
  localStorage.setItem("api_token", token.trim());
}

export function clearToken(): void {
  localStorage.removeItem("api_token");
}

async function request(path: string, init?: RequestInit): Promise<Response> {
  const token = getToken();
  const headers = new Headers(init?.headers);
  // Only declare a JSON body when there is one: sending Content-Type:
  // application/json on a request with no body (e.g. DELETE) makes the server
  // reject it as an empty JSON body.
  if (init?.body != null) headers.set("Content-Type", "application/json");
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

export async function getCollection(id: string): Promise<Collection> {
  const res = await request(`/api/collections/${id}`);
  if (!res.ok) throw new ApiError(res.status);
  return res.json() as Promise<Collection>;
}

export async function listItems(collectionId: string, status?: ItemStatus): Promise<Item[]> {
  const query = status ? `?status=${encodeURIComponent(status)}` : "";
  const res = await request(`/api/collections/${collectionId}/items${query}`);
  if (!res.ok) throw new ApiError(res.status);
  return res.json() as Promise<Item[]>;
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
