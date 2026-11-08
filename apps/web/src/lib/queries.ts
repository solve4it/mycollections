import type { Item, ItemStatus } from "@mycollections/core";
import { keepPreviousData, type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createCollection,
  createItem,
  deleteItem,
  emptyTrash,
  getCollection,
  getCollectionCounts,
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
  setItemStatus,
  type UpdateCollectionInput,
  updateCollection,
  updateItem,
} from "./api-client.js";

export function useCollections() {
  return useQuery({ queryKey: ["collections"], queryFn: listCollections });
}

/**
 * Fetches the dashboard list again even though it is not on screen (#42).
 *
 * Its cards show each finite set's owned count against its target, and every
 * change that moves those numbers is made on another screen. Invalidating with
 * the default `refetchType: "active"` would only mark the list stale, so going
 * back would paint the old count and then jump to the new one; fetching the
 * inactive query now means the return shows the right numbers from the first
 * frame. Exact, so no collection's own queries ride along — and a list that was
 * never loaded is not fetched at all. Not awaited: nothing on the screen making
 * the change waits on the dashboard.
 */
function refreshDashboard(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: ["collections"], exact: true, refetchType: "all" });
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
    // Run from Settings, where the dashboard is not on screen.
    onSuccess: () => {
      refreshDashboard(queryClient);
      return queryClient.invalidateQueries({ queryKey: ["collections"] });
    },
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
    onSuccess: () => {
      // A changed target or finite flag changes the dashboard's bar (#42).
      refreshDashboard(queryClient);
      return queryClient.invalidateQueries({ queryKey: ["collections"] });
    },
  });
}

export function useCollection(id: string) {
  return useQuery({ queryKey: ["collections", id], queryFn: () => getCollection(id) });
}

/**
 * A collection's live item counts (#42), for a finite set's progress in its
 * header. Under the `["collections", id, "items"]` prefix every item mutation
 * invalidates, so an add, edit, delete or undo refreshes the bar with the list.
 * Enabled only when there is something to measure — a finite set with a target.
 */
export function useCollectionCounts(id: string, enabled: boolean) {
  return useQuery({
    queryKey: ["collections", id, "items", "counts"],
    queryFn: () => getCollectionCounts(id),
    enabled,
  });
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
    queryKey: tagValuesQueryKey(collectionId, fieldId, q),
    queryFn: () => getTagValues(collectionId, fieldId, q.trim() || undefined),
    enabled,
    staleTime: 30_000,
  });
}

/** The cache key `useTagValues` uses, for reading what a change left on screen. */
export function tagValuesQueryKey(collectionId: string, fieldId: string, q = "") {
  return ["collections", collectionId, "items", "tag-values", fieldId, q.trim()] as const;
}

/**
 * Rename or remove a tag across a collection (#41). Both rewrite items, trashed
 * ones too, so lists, tag counts and the trash are all fetched again — and the
 * invalidation is awaited, so a caller's `onSuccess` sees the new tag list.
 */
function useTagChange<Input, Result>(collectionId: string, change: (input: Input) => Promise<Result>) {
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
    onSuccess: () => {
      refreshDashboard(queryClient);
      return queryClient.invalidateQueries({ queryKey: ["collections", collectionId, "items"] });
    },
  });
}

export function useUpdateItem(collectionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ itemId, input }: { itemId: string; input: ItemInput }) => updateItem(collectionId, itemId, input),
    onSuccess: () => {
      refreshDashboard(queryClient);
      return queryClient.invalidateQueries({ queryKey: ["collections", collectionId, "items"] });
    },
  });
}

/**
 * A row's Mark collected (#42): the status alone, through the status-only
 * update, so the item's fields are never sent back (R14). Invalidates what an
 * edit does — the list, the header's counts under the same prefix, and the
 * dashboard's owned counts.
 */
export function useSetItemStatus(collectionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ itemId, status }: { itemId: string; status: ItemStatus }) =>
      setItemStatus(collectionId, itemId, status),
    onSuccess: async (marked) => {
      refreshDashboard(queryClient);
      await queryClient.invalidateQueries({ queryKey: ["collections", collectionId, "items"] });
      // Then the server's answer goes into any cached list the refetch did not
      // bring up to date (#42 review). `invalidateQueries` swallows a failed
      // refetch, and without this the row kept saying Wanted, with its button,
      // under an announcement that it had been marked: the page decides where
      // focus goes and what to say from this cache.
      //
      // After the refetch, not before it, so the usual path is untouched: the
      // fresh list (in a status sort's new order) lands while the mutation is
      // still pending, the button stays marked busy and keeps focus, and only
      // then does the page hand focus on. A status change moves no item in or
      // out of a search or filter, so the patch replaces the item in place.
      // Only an older copy is replaced (ISO times compare as strings), so a
      // list the refetch did update is left alone. Item lists are the arrays
      // under the prefix; the counts and the tag values are objects.
      queryClient.setQueriesData<unknown>({ queryKey: ["collections", collectionId, "items"] }, (cached: unknown) => {
        if (!Array.isArray(cached)) return cached;
        const list = cached as Item[];
        const stale = list.some((listed) => listed.id === marked.id && listed.updatedAt < marked.updatedAt);
        return stale ? list.map((listed) => (listed.id === marked.id ? marked : listed)) : cached;
      });
    },
  });
}

export function useDeleteItem(collectionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (itemId: string) => deleteItem(collectionId, itemId),
    onSuccess: () => {
      refreshDashboard(queryClient);
      return queryClient.invalidateQueries({ queryKey: ["collections", collectionId, "items"] });
    },
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
      refreshDashboard(queryClient);
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
      refreshDashboard(queryClient);
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
    // took away — and, like it, the dashboard's counts (#42).
    onSuccess: () => {
      refreshDashboard(queryClient);
      return queryClient.invalidateQueries({ queryKey: ["collections", collectionId, "items"] });
    },
  });
}
