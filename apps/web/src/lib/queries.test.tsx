import type { CollectionWithItemCount, Item } from "@mycollections/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./api-client.js", () => ({
  listCollections: vi.fn(),
  getCollectionCounts: vi.fn(),
  createItem: vi.fn(),
  updateItem: vi.fn(),
  deleteItem: vi.fn(),
  restoreItem: vi.fn(),
  restoreCollection: vi.fn(),
  importData: vi.fn(),
  updateCollection: vi.fn(),
}));

import {
  createItem,
  deleteItem,
  getCollectionCounts,
  importData,
  listCollections,
  restoreCollection,
  restoreItem,
  updateCollection,
  updateItem,
} from "./api-client.js";
import {
  useCollectionCounts,
  useCreateItem,
  useDeleteItem,
  useImportData,
  useRestoreCollection,
  useRestoreItem,
  useRestoreTrashedItem,
  useSetItemView,
  useUpdateCollection,
  useUpdateItem,
} from "./queries.js";

const ID = "11111111-1111-1111-1111-111111111111";

const LISTED: CollectionWithItemCount = {
  id: ID,
  name: "Trading cards",
  fields: [{ id: "title", label: "Title", type: "text", required: true }],
  isFiniteSet: true,
  targetCount: 5,
  itemView: "list",
  itemCount: 3,
  ownedCount: 2,
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T00:00:00.000Z",
  deletedAt: null,
};

const ITEM: Item = {
  id: "22222222-2222-2222-2222-222222222222",
  collectionId: ID,
  status: "owned",
  fields: { title: "Base Set card" },
  createdAt: "2024-01-02T00:00:00.000Z",
  updatedAt: "2024-01-02T00:00:00.000Z",
  deletedAt: null,
};

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, wrapper };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(createItem).mockResolvedValue(ITEM);
  vi.mocked(updateItem).mockResolvedValue(ITEM);
  vi.mocked(deleteItem).mockResolvedValue(undefined);
  vi.mocked(restoreItem).mockResolvedValue(ITEM);
  vi.mocked(updateCollection).mockResolvedValue(LISTED);
  vi.mocked(restoreCollection).mockResolvedValue(LISTED);
  vi.mocked(importData).mockResolvedValue({ collections: 1, items: 0 } as never);
});

describe("useCollectionCounts (#42)", () => {
  it("reads the counts under the items prefix, so every item mutation refreshes them", async () => {
    const counts = { total: 4, owned: 3, wanted: 1, ordered: 0 };
    vi.mocked(getCollectionCounts).mockResolvedValue(counts);
    const { qc, wrapper } = setup();

    const { result } = renderHook(() => useCollectionCounts(ID, true), { wrapper });

    await waitFor(() => expect(result.current.data).toEqual(counts));
    expect(getCollectionCounts).toHaveBeenCalledWith(ID);
    expect(qc.getQueryData(["collections", ID, "items", "counts"])).toEqual(counts);
  });

  it("asks nothing while disabled — a collection with no target has nothing to measure", async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useCollectionCounts(ID, false), { wrapper });
    await act(async () => {});
    expect(result.current.fetchStatus).toBe("idle");
    expect(getCollectionCounts).not.toHaveBeenCalled();
  });
});

/**
 * R21: the dashboard's card shows a set's owned count, so an item change has to
 * reach the dashboard list — which is not on screen while the change is made.
 * Fetched again in the background rather than merely marked stale: a stale
 * entry would paint the old count on return and then jump.
 */
describe("item changes refresh the dashboard list, though it is not on screen (#42)", () => {
  async function seedDashboard(qc: QueryClient) {
    vi.mocked(listCollections).mockResolvedValueOnce([LISTED]);
    await qc.prefetchQuery({ queryKey: ["collections"], queryFn: listCollections });
    expect(qc.getQueryData(["collections"])).toEqual([LISTED]);
    vi.mocked(listCollections).mockResolvedValue([{ ...LISTED, ownedCount: 3 }]);
  }

  const cases: Array<[string, (qc: QueryClient, wrapper: (p: { children: ReactNode }) => ReactNode) => Promise<void>]> =
    [
      [
        "an added item",
        async (_qc, wrapper) => {
          const { result } = renderHook(() => useCreateItem(ID), { wrapper });
          await act(() => result.current.mutateAsync({ fields: { title: "Base Set card" } }));
        },
      ],
      [
        "an edited item",
        async (_qc, wrapper) => {
          const { result } = renderHook(() => useUpdateItem(ID), { wrapper });
          await act(() => result.current.mutateAsync({ itemId: ITEM.id, input: { status: "owned", fields: {} } }));
        },
      ],
      [
        "a deleted item",
        async (_qc, wrapper) => {
          const { result } = renderHook(() => useDeleteItem(ID), { wrapper });
          await act(() => result.current.mutateAsync(ITEM.id));
        },
      ],
      [
        "an undone delete",
        async (_qc, wrapper) => {
          const { result } = renderHook(() => useRestoreItem(ID), { wrapper });
          await act(() => result.current.mutateAsync(ITEM.id));
        },
      ],
      [
        "a changed target",
        async (_qc, wrapper) => {
          const { result } = renderHook(() => useUpdateCollection(ID), { wrapper });
          await act(() => result.current.mutateAsync({ targetCount: 6 }));
        },
      ],
      // Settings' three: run where the dashboard is never on screen either.
      [
        "an item restored from the trash",
        async (_qc, wrapper) => {
          const { result } = renderHook(() => useRestoreTrashedItem(), { wrapper });
          await act(() => result.current.mutateAsync({ collectionId: ID, itemId: ITEM.id }));
        },
      ],
      [
        "a collection restored from the trash",
        async (_qc, wrapper) => {
          const { result } = renderHook(() => useRestoreCollection(), { wrapper });
          await act(() => result.current.mutateAsync(ID));
        },
      ],
      [
        "an import",
        async (_qc, wrapper) => {
          const { result } = renderHook(() => useImportData(), { wrapper });
          await act(() => result.current.mutateAsync({}));
        },
      ],
    ];

  it.each(cases)("%s fetches the inactive dashboard list again", async (_name, run) => {
    const { qc, wrapper } = setup();
    await seedDashboard(qc);

    await run(qc, wrapper);

    await waitFor(() => expect(qc.getQueryData(["collections"])).toEqual([{ ...LISTED, ownedCount: 3 }]));
    expect(listCollections).toHaveBeenCalledTimes(2);
  });

  it("fetches no dashboard list that was never loaded", async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useDeleteItem(ID), { wrapper });
    await act(() => result.current.mutateAsync(ITEM.id));
    expect(listCollections).not.toHaveBeenCalled();
  });
});

describe("useSetItemView (#38)", () => {
  const { itemCount: _itemCount, ownedCount: _ownedCount, ...COLLECTION } = LISTED;
  const OTHER = { ...LISTED, id: "33333333-3333-3333-3333-333333333333", name: "Coins" };

  function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  function seeded() {
    const { qc, wrapper } = setup();
    qc.setQueryData(["collections", ID], COLLECTION);
    qc.setQueryData(["collections"], [LISTED, OTHER]);
    return { qc, wrapper };
  }

  it("shows the new view at once and sends only the view", async () => {
    const { qc, wrapper } = seeded();
    const sent = deferred<typeof COLLECTION>();
    vi.mocked(updateCollection).mockReturnValue(sent.promise);
    const { result } = renderHook(() => useSetItemView(ID), { wrapper });

    act(() => result.current.mutate("grid"));

    await waitFor(() => expect(qc.getQueryData<typeof COLLECTION>(["collections", ID])?.itemView).toBe("grid"));
    expect(qc.getQueryData<CollectionWithItemCount[]>(["collections"])?.map((c) => [c.name, c.itemView])).toEqual([
      ["Trading cards", "grid"],
      ["Coins", "list"],
    ]);
    expect(updateCollection).toHaveBeenCalledWith(ID, { itemView: "grid" });

    await act(async () => sent.resolve({ ...COLLECTION, itemView: "grid", updatedAt: "2024-02-01T00:00:00.000Z" }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(qc.getQueryData<typeof COLLECTION>(["collections", ID])).toEqual({
      ...COLLECTION,
      itemView: "grid",
      updatedAt: "2024-02-01T00:00:00.000Z",
    });
  });

  it("does not fetch the items again — a layout changes no row", async () => {
    const { qc, wrapper } = seeded();
    const itemsFetch = vi.fn().mockResolvedValue([ITEM]);
    await qc.prefetchQuery({ queryKey: ["collections", ID, "items", {}], queryFn: itemsFetch });
    vi.mocked(updateCollection).mockResolvedValue({ ...COLLECTION, itemView: "grid" });
    const { result } = renderHook(() => useSetItemView(ID), { wrapper });

    await act(async () => {
      await result.current.mutateAsync("grid");
    });

    expect(itemsFetch).toHaveBeenCalledTimes(1);
    expect(qc.getQueryState(["collections", ID, "items", {}])?.isInvalidated).toBe(false);
  });

  it("puts the old view back when the server refuses", async () => {
    const { qc, wrapper } = seeded();
    vi.mocked(updateCollection).mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() => useSetItemView(ID), { wrapper });

    act(() => result.current.mutate("grid"));

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(qc.getQueryData<typeof COLLECTION>(["collections", ID])?.itemView).toBe("list");
    expect(qc.getQueryData<CollectionWithItemCount[]>(["collections"])?.map((c) => c.itemView)).toEqual([
      "list",
      "list",
    ]);
  });

  it("sends a second switch only once the first has landed, so the last choice is the one stored", async () => {
    const { qc, wrapper } = seeded();
    const first = deferred<typeof COLLECTION>();
    const second = deferred<typeof COLLECTION>();
    vi.mocked(updateCollection).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { result } = renderHook(() => useSetItemView(ID), { wrapper });

    act(() => result.current.mutate("grid"));
    act(() => result.current.mutate("list"));

    await waitFor(() => expect(qc.getQueryData<typeof COLLECTION>(["collections", ID])?.itemView).toBe("list"));
    expect(updateCollection).toHaveBeenCalledTimes(1);

    await act(async () => first.resolve({ ...COLLECTION, itemView: "grid" }));
    await waitFor(() => expect(updateCollection).toHaveBeenCalledTimes(2));
    expect(updateCollection).toHaveBeenLastCalledWith(ID, { itemView: "list" });
    // The first answer does not paint its view over the choice made since.
    expect(qc.getQueryData<typeof COLLECTION>(["collections", ID])?.itemView).toBe("list");

    await act(async () => second.resolve({ ...COLLECTION, itemView: "list" }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(qc.getQueryData<typeof COLLECTION>(["collections", ID])?.itemView).toBe("list");
  });

  it("goes back to the view the server holds when two queued switches both fail", async () => {
    const { qc, wrapper } = seeded();
    const first = deferred<typeof COLLECTION>();
    const second = deferred<typeof COLLECTION>();
    vi.mocked(updateCollection).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { result } = renderHook(() => useSetItemView(ID), { wrapper });

    act(() => result.current.mutate("grid"));
    act(() => result.current.mutate("list"));
    await act(async () => first.reject(new Error("offline")));
    await waitFor(() => expect(updateCollection).toHaveBeenCalledTimes(2));
    await act(async () => second.reject(new Error("offline")));

    await waitFor(() => expect(result.current.isError).toBe(true));
    // The server never stored anything but list, so list is what shows.
    expect(qc.getQueryData<typeof COLLECTION>(["collections", ID])?.itemView).toBe("list");
  });

  it("does not undo a later choice when an earlier switch fails", async () => {
    const { qc, wrapper } = seeded();
    const first = deferred<typeof COLLECTION>();
    vi.mocked(updateCollection)
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce({ ...COLLECTION, itemView: "list" });
    const { result } = renderHook(() => useSetItemView(ID), { wrapper });

    act(() => result.current.mutate("grid"));
    act(() => result.current.mutate("list"));
    await act(async () => first.reject(new Error("offline")));

    await waitFor(() => expect(updateCollection).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(qc.getQueryData<typeof COLLECTION>(["collections", ID])?.itemView).toBe("list");
  });
});
