import type { Collection, CollectionWithItemCount, Item, ItemStatus, ItemView, Media } from "@mycollections/core";
import { keepPreviousData, type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import {
  createCollection,
  createItem,
  deleteItem,
  deleteMedia,
  emptyTrash,
  fetchMediaBlob,
  getCollection,
  getCollectionCounts,
  getItem,
  getTagValues,
  type ItemInput,
  type ItemListQuery,
  importData,
  listCollections,
  listItems,
  listMedia,
  listTrash,
  type MediaVariant,
  makeCover,
  purgeCollection,
  purgeItem,
  removeTag,
  renameTag,
  reorderMedia,
  restoreCollection,
  restoreItem,
  restoreMedia,
  setItemStatus,
  type UpdateCollectionInput,
  type UploadSource,
  updateCollection,
  updateItem,
  uploadMedia,
} from "./api-client.js";
import { MEDIA_IMAGE_KEY } from "./query-client.js";

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

/**
 * Writes a collection's view into both places it is cached: the collection's
 * own query and its entry in the dashboard list. Nothing else is touched.
 */
function writeItemView(queryClient: QueryClient, id: string, itemView: ItemView) {
  queryClient.setQueryData<Collection>(["collections", id], (current) => current && { ...current, itemView });
  queryClient.setQueryData<CollectionWithItemCount[]>(["collections"], (list) =>
    list?.map((listed) => (listed.id === id ? { ...listed, itemView } : listed)),
  );
}

/**
 * Switches a collection between its list and grid views (#38).
 *
 * Shown at once and taken back if the server refuses, like an image reorder: a
 * layout that waited a round trip would feel like a dead control. Unlike
 * `useUpdateCollection`, nothing is invalidated — the view changes no row, no
 * count and no label, so fetching the items again would only cost a request.
 *
 * Switches run one at a time (`scope`), so they reach the server in the order
 * they were made and the last choice is the one stored. While a later switch
 * is queued, an earlier one's answer is not written back and its failure is not
 * rolled back: either would paint over the choice the user has made since.
 */
export function useSetItemView(id: string) {
  const queryClient = useQueryClient();
  const mutationKey = ["collections", id, "item-view"];
  /** Whether a switch made after this one is still to land. */
  const superseded = () => queryClient.isMutating({ mutationKey }) > 1;
  // The last view the server is known to hold. Not each switch's own snapshot:
  // `onMutate` runs at once even for a switch queued behind another, so its
  // snapshot is the earlier switch's optimistic view, which the server may never
  // have stored (#38 review: grid then list, both refused, left grid showing).
  const confirmed = useRef<ItemView | undefined>(undefined);
  return useMutation({
    mutationKey,
    scope: { id: `item-view:${id}` },
    mutationFn: (itemView: ItemView) => updateCollection(id, { itemView }),
    onMutate: async (itemView: ItemView) => {
      // A collection fetch landing after this would paint the old view back.
      await queryClient.cancelQueries({ queryKey: ["collections", id], exact: true });
      // Only the first switch of a run sees the server's view in the cache.
      if (!superseded()) confirmed.current = queryClient.getQueryData<Collection>(["collections", id])?.itemView;
      writeItemView(queryClient, id, itemView);
    },
    onError: () => {
      if (confirmed.current && !superseded()) writeItemView(queryClient, id, confirmed.current);
    },
    onSuccess: (saved) => {
      confirmed.current = saved.itemView;
      if (superseded()) return;
      queryClient.setQueryData<Collection>(["collections", id], saved);
      writeItemView(queryClient, id, saved.itemView);
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
    queryKey: collectionCountsQueryKey(id),
    queryFn: () => getCollectionCounts(id),
    enabled,
  });
}

/**
 * The cache key `useCollectionCounts` uses, for reading the counts a change
 * started from and the ones it left — which is how the page tells that an
 * action completed a finite set (#42).
 */
export function collectionCountsQueryKey(id: string) {
  return ["collections", id, "items", "counts"] as const;
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

/**
 * One item, for its own page (#37). Under the items prefix, so every item
 * mutation refreshes it; an object rather than an array, so the status
 * mutation's list patch above passes over it.
 */
export function useItem(collectionId: string, itemId: string) {
  return useQuery({
    queryKey: ["collections", collectionId, "items", "detail", itemId] as const,
    queryFn: () => getItem(collectionId, itemId),
  });
}

/**
 * The cache key of an item's image list. Deliberately outside the items
 * prefix: it is an array, and the status mutation patches every array there as
 * an item list. Image changes invalidate it by name.
 */
export function mediaListQueryKey(collectionId: string, itemId: string) {
  return ["media-list", collectionId, itemId] as const;
}

export function useMediaList(collectionId: string, itemId: string) {
  return useQuery({
    queryKey: mediaListQueryKey(collectionId, itemId),
    queryFn: () => listMedia(collectionId, itemId),
  });
}

/**
 * After any change to an item's images: its list, and the items prefix, whose
 * responses carry the primary image (a row's thumbnail, the item page).
 */
function afterMediaChange(queryClient: QueryClient, collectionId: string, itemId: string) {
  void queryClient.invalidateQueries({ queryKey: ["collections", collectionId, "items"] });
  return queryClient.invalidateQueries({ queryKey: mediaListQueryKey(collectionId, itemId) });
}

export function useUploadMedia(collectionId: string, itemId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ file, source }: { file: Blob; source: UploadSource }) =>
      uploadMedia(collectionId, itemId, file, source),
    onSuccess: () => afterMediaChange(queryClient, collectionId, itemId),
  });
}

/**
 * An image as an object URL, for an `<img src>`. Ids are never reused and
 * files never rewritten, so a fetched image never goes stale; the URL is
 * revoked when the query leaves the cache (`createQueryClient`). Kept a few
 * minutes after its last viewer unmounts, so going back to a page does not
 * fetch every image again — but not for good, since display images are large.
 */
export function useMediaImage(
  collectionId: string,
  itemId: string,
  mediaId: string,
  variant: MediaVariant,
  options: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: [MEDIA_IMAGE_KEY, mediaId, variant] as const,
    queryFn: async () => URL.createObjectURL(await fetchMediaBlob(collectionId, itemId, mediaId, variant)),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 5 * 60 * 1000,
    enabled: options.enabled ?? true,
  });
}

/**
 * A change to an item's image order, shown at once and taken back if the
 * server refuses it (#37). The order is what the user just arranged; waiting a
 * round trip to show it would make every move feel broken.
 */
function useOptimisticOrder<TVariables>(
  collectionId: string,
  itemId: string,
  send: (variables: TVariables) => Promise<Media[]>,
  arrange: (current: Media[], variables: TVariables) => Media[],
) {
  const queryClient = useQueryClient();
  const key = mediaListQueryKey(collectionId, itemId);
  return useMutation({
    mutationFn: send,
    onMutate: async (variables: TVariables) => {
      // A list fetch landing after this would paint the old order over the new.
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<Media[]>(key);
      if (previous) queryClient.setQueryData<Media[]>(key, arrange(previous, variables));
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
    },
    onSuccess: (ordered) => {
      queryClient.setQueryData(key, ordered);
      // The cover may have changed, and every item response carries it.
      void queryClient.invalidateQueries({ queryKey: ["collections", collectionId, "items"] });
    },
  });
}

/** Puts the images in the order of `ids`. */
export function useReorderMedia(collectionId: string, itemId: string) {
  return useOptimisticOrder(
    collectionId,
    itemId,
    (ids: string[]) => reorderMedia(collectionId, itemId, ids),
    (current, ids) => ids.flatMap((id) => current.filter((media) => media.id === id)),
  );
}

/** Makes an image the cover: moves it to the front, the rest keeping their order. */
export function useMakeCover(collectionId: string, itemId: string) {
  return useOptimisticOrder(
    collectionId,
    itemId,
    (mediaId: string) => makeCover(collectionId, itemId, mediaId),
    (current, mediaId) => [
      ...current.filter((media) => media.id === mediaId),
      ...current.filter((media) => media.id !== mediaId),
    ],
  );
}

export function useDeleteMedia(collectionId: string, itemId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (mediaId: string) => deleteMedia(collectionId, itemId, mediaId),
    onSuccess: () => afterMediaChange(queryClient, collectionId, itemId),
  });
}

export function useRestoreMedia(collectionId: string, itemId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (mediaId: string) => restoreMedia(collectionId, itemId, mediaId),
    onSuccess: () => afterMediaChange(queryClient, collectionId, itemId),
  });
}
