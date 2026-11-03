import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createCollection,
  createItem,
  deleteItem,
  emptyTrash,
  getCollection,
  getTagValues,
  type ItemInput,
  type ItemListQuery,
  importData,
  listCollections,
  listItems,
  listTrash,
  purgeCollection,
  purgeItem,
  removeTag,
  renameTag,
  restoreCollection,
  restoreItem,
  type UpdateCollectionInput,
  updateCollection,
  updateItem,
} from "./api-client.js";

export function useCollections() {
  return useQuery({ queryKey: ["collections"], queryFn: listCollections });
}

export function useCreateCollection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createCollection,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["collections"] }),
  });
}

export function useImportData() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: importData,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["collections"] }),
  });
}

/**
 * Invalidating the `["collections"]` prefix covers the list, this collection, and
 * its items in one go — a field rename changes how every row is labelled, so the
 * item list has to reload with the collection.
 */
export function useUpdateCollection(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateCollectionInput) => updateCollection(id, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["collections"] }),
  });
}

export function useCollection(id: string) {
  return useQuery({ queryKey: ["collections", id], queryFn: () => getCollection(id) });
}

/**
 * The cache key of one view of a collection's items (#41). Under the
 * `["collections", id, "items"]` prefix every mutation invalidates, so a change
 * fetches again whichever search is on screen and marks the others stale.
 */
export function itemsQueryKey(collectionId: string, query: ItemListQuery = {}) {
  return [
    "collections",
    collectionId,
    "items",
    { q: query.q?.trim() || undefined, sort: query.sort, filter: query.filter },
  ] as const;
}

/**
 * A collection's items, narrowed and ordered by `query`. The previous view
 * stays on screen while the next one loads (`keepPreviousData`), so each
 * keystroke of a search does not flash the list back to a skeleton.
 */
export function useItems(collectionId: string, query: ItemListQuery = {}, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: itemsQueryKey(collectionId, query),
    queryFn: () => listItems(collectionId, query),
    placeholderData: keepPreviousData,
    enabled: options.enabled ?? true,
  });
}

/**
 * The tags in use in one tags field, for the filter panel (#41). Under the
 * items prefix, so an edit that adds or drops a tag refreshes it; fetched only
 * while the panel is open.
 */
export function useTagValues(collectionId: string, fieldId: string, enabled: boolean, q = "") {
  return useQuery({
    queryKey: ["collections", collectionId, "items", "tag-values", fieldId, q.trim()],
    queryFn: () => getTagValues(collectionId, fieldId, q.trim() || undefined),
    enabled,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
}

/**
 * Rename or remove a tag across a collection (#41). Both rewrite items, trashed
 * ones too, so lists, tag counts and the trash are all fetched again — and the
 * invalidation is awaited, so a caller's `onSuccess` sees the new tag list.
 */
function useTagChange<Input>(collectionId: string, change: (input: Input) => Promise<{ updated: number }>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: change,
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ["collections", collectionId, "items"] }),
        queryClient.invalidateQueries({ queryKey: ["trash"] }),
      ]),
  });
}

export function useRenameTag(collectionId: string) {
  return useTagChange(collectionId, (input: { field: string; from: string; to: string }) =>
    renameTag(collectionId, input),
  );
}

export function useRemoveTag(collectionId: string) {
  return useTagChange(collectionId, (input: { field: string; value: string }) => removeTag(collectionId, input));
}

export function useCreateItem(collectionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ItemInput) => createItem(collectionId, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["collections", collectionId, "items"] }),
  });
}

export function useUpdateItem(collectionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ itemId, input }: { itemId: string; input: ItemInput }) => updateItem(collectionId, itemId, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["collections", collectionId, "items"] }),
  });
}

export function useDeleteItem(collectionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (itemId: string) => deleteItem(collectionId, itemId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["collections", collectionId, "items"] }),
  });
}

export function useTrash() {
  return useQuery({ queryKey: ["trash"], queryFn: listTrash });
}

/**
 * The trash's own restore, distinct from `useRestoreItem`: that one is the undo
 * toast, which knows the single list it is undoing inside. A restore from
 * Settings puts a row back into lists this screen cannot see, so it invalidates
 * the whole `["collections"]` prefix — the dashboard's counts and every
 * collection's items alike — as well as the trash it just left.
 */
export function useRestoreTrashedItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ collectionId, itemId }: { collectionId: string; itemId: string }) =>
      restoreItem(collectionId, itemId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["trash"] });
      return queryClient.invalidateQueries({ queryKey: ["collections"] });
    },
  });
}

export function useRestoreCollection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => restoreCollection(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["trash"] });
      return queryClient.invalidateQueries({ queryKey: ["collections"] });
    },
  });
}

/**
 * Purging and emptying only ever remove rows that were already hidden
 * everywhere else, so the trash is the only list that can be stale.
 */
export function usePurgeItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (itemId: string) => purgeItem(itemId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["trash"] }),
  });
}

export function usePurgeCollection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => purgeCollection(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["trash"] }),
  });
}

export function useEmptyTrash() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => emptyTrash(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["trash"] }),
  });
}

export function useRestoreItem(collectionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (itemId: string) => restoreItem(collectionId, itemId),
    // Same key as useDeleteItem: an undo has to put back exactly what the delete
    // took away. The dashboard's itemCount needs no invalidation here — that
    // query reloads when it mounts, and it never mounts beside this one.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["collections", collectionId, "items"] }),
  });
}
