import type { Collection, Item, ItemStatus } from "@mycollections/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ItemListQuery } from "../../lib/api-client.js";
import { parseSearch, stringifySearch } from "../../lib/search-params.js";
import { rootRoute } from "../__root.js";
import { collectionDetailRoute } from "./$id.js";

vi.mock("../../lib/api-client.js", () => ({
  getCollection: vi.fn(),
  getCollectionCounts: vi.fn(),
  listItems: vi.fn(),
  createItem: vi.fn(),
  updateItem: vi.fn(),
  setItemStatus: vi.fn(),
  deleteItem: vi.fn(),
  restoreItem: vi.fn(),
  getToken: vi.fn(() => "test-token"),
}));

import {
  deleteItem,
  getCollection,
  getCollectionCounts,
  listItems,
  setItemStatus,
  updateItem,
} from "../../lib/api-client.js";

/**
 * A wanted or ordered row's Mark collected (#42, slice 7: D8, D9, D10, R1, R13,
 * R14, R19): an instant flip to Owned, with no prompt and no undo, and focus
 * left where the row now is — or, when the tab no longer shows it, where a
 * delete would have left it.
 */

const COLLECTION: Collection = {
  id: "11111111-1111-1111-1111-111111111111",
  name: "Coins",
  fields: [
    { id: "title", label: "Title", type: "text", required: true },
    { id: "year", label: "Year", type: "number", required: false },
  ],
  isFiniteSet: false,
  targetCount: null,
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T00:00:00.000Z",
  deletedAt: null,
};

function item(id: string, title: string, year: number, status: ItemStatus): Item {
  return {
    id,
    collectionId: COLLECTION.id,
    status,
    fields: { title, year },
    createdAt: "2024-01-02T00:00:00.000Z",
    updatedAt: "2024-01-02T00:00:00.000Z",
    deletedAt: null,
  };
}

const PENNY = item("22222222-2222-4222-8222-222222222222", "Penny", 1909, "owned");
const NICKEL = item("33333333-3333-4333-8333-333333333333", "Nickel", 1913, "wanted");
const DIME = item("44444444-4444-4444-8444-444444444444", "Dime", 1916, "ordered");
const QUARTER = item("55555555-5555-4555-8555-555555555555", "Quarter", 1932, "owned");

const STATUS_ORDER: ItemStatus[] = ["owned", "ordered", "wanted"];

/** The server, played by the mock: it knows the status sort, and nothing of tabs. */
let stored: Item[];
function serve(_collectionId: string, query: ItemListQuery = {}): Promise<Item[]> {
  const found = [...stored];
  if (query.sort === "status") found.sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status));
  return Promise.resolve(found);
}

/** A status PATCH the server accepts: the stored item turns owned, fields untouched. */
function acceptMarks() {
  vi.mocked(setItemStatus).mockImplementation(async (_collectionId, itemId, status) => {
    let marked: Item | undefined;
    stored = stored.map((it) => {
      if (it.id !== itemId) return it;
      marked = { ...it, status };
      return marked;
    });
    if (!marked) throw new Error("no such item");
    return marked;
  });
}

function renderAt(path: string, collection: Collection = COLLECTION) {
  vi.mocked(getCollection).mockResolvedValue(collection);
  const history = createMemoryHistory({ initialEntries: [path] });
  const router = createRouter({
    routeTree: rootRoute.addChildren([collectionDetailRoute]),
    history,
    parseSearch,
    stringifySearch,
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router };
}

const BASE = `/collections/${COLLECTION.id}`;
const FINITE = (targetCount: number | null): Collection => ({ ...COLLECTION, isFiniteSet: true, targetCount });

function announcer(): HTMLElement {
  const region = document.querySelector<HTMLElement>('.visually-hidden[aria-live="polite"]');
  if (!region) throw new Error("no announcer");
  return region;
}

function rowTitles(): string[] {
  const list = document.querySelector(".item-list");
  if (!list) return [];
  return Array.from(list.querySelectorAll("li"), (li) => {
    const edit = li.querySelector("[data-row-edit]");
    return edit?.getAttribute("aria-label")?.replace(/^Edit “(.*)”$/, "$1") ?? "";
  });
}

function row(it: Item): HTMLElement {
  const li = document.querySelector<HTMLElement>(`[data-item-id="${it.id}"]`);
  if (!li) throw new Error(`no row for ${it.id}`);
  return li;
}

const markName = (name: string) => `Mark collected “${name}”`;

function markButton(name: string): HTMLElement {
  return screen.getByRole("button", { name: markName(name) });
}

function panel(): HTMLElement {
  return screen.getByRole("tabpanel");
}

beforeEach(() => {
  localStorage.setItem("api_token", "test-token");
  vi.resetAllMocks();
  stored = [PENNY, NICKEL, DIME, QUARTER];
  vi.mocked(listItems).mockImplementation(serve);
  vi.mocked(getCollectionCounts).mockImplementation(async () => {
    const live = stored.filter((it) => it.deletedAt === null);
    const of = (status: ItemStatus) => live.filter((it) => it.status === status).length;
    return { total: live.length, owned: of("owned"), wanted: of("wanted"), ordered: of("ordered") };
  });
});

afterEach(() => {
  cleanup();
});

describe("a wanted or ordered row (#42, D8)", () => {
  it("marks wanted rows dashed and ordered rows dotted by class, and leaves owned rows plain", async () => {
    renderAt(BASE);
    await waitFor(() => expect(rowTitles()).toEqual(["Penny", "Nickel", "Dime", "Quarter"]));

    const card = (it: Item) => row(it).querySelector(".item-row");
    expect(card(PENNY)?.className).toBe("item-row");
    expect(card(NICKEL)?.className).toBe("item-row item-row-wanted");
    expect(card(DIME)?.className).toBe("item-row item-row-ordered");
    expect(card(QUARTER)?.className).toBe("item-row");
  });

  it("drops the treatment in the editor, which is not a view of the item", async () => {
    renderAt(BASE);
    await waitFor(() => expect(rowTitles()).toContain("Nickel"));
    fireEvent.click(screen.getByRole("button", { name: "Edit “Nickel”" }));
    const editor = await screen.findByRole("form", { name: "Editing “Nickel”" });
    expect(editor.closest(".item-row")?.className).toBe("item-row");
  });

  it("offers Mark collected on wanted and ordered rows only, naming the row, with the verb visible", async () => {
    renderAt(BASE);
    await waitFor(() => expect(rowTitles()).toEqual(["Penny", "Nickel", "Dime", "Quarter"]));

    expect(markButton("Nickel")).toHaveTextContent("Mark collected");
    expect(markButton("Dime")).toHaveTextContent("Mark collected");
    expect(within(row(PENNY)).queryByRole("button", { name: /Mark collected/ })).toBeNull();
    expect(within(row(QUARTER)).queryByRole("button", { name: /Mark collected/ })).toBeNull();
    // First in the row's actions: the action the row exists for comes before Edit and Delete.
    const actions = Array.from(row(NICKEL).querySelectorAll(".item-actions button"), (b) =>
      b.getAttribute("aria-label"),
    );
    expect(actions).toEqual([markName("Nickel"), "Edit “Nickel”", "Delete “Nickel”"]);
  });

  it("has no Mark collected while the row is being edited", async () => {
    renderAt(BASE);
    await waitFor(() => expect(rowTitles()).toContain("Nickel"));
    fireEvent.click(screen.getByRole("button", { name: "Edit “Nickel”" }));
    await screen.findByRole("form", { name: "Editing “Nickel”" });
    expect(screen.queryByRole("button", { name: markName("Nickel") })).toBeNull();
  });
});

describe("Mark collected (#42, D9)", () => {
  it("sends the status alone, through the status-only update, and never the item's fields", async () => {
    acceptMarks();
    renderAt(BASE);
    await waitFor(() => expect(rowTitles()).toContain("Nickel"));

    fireEvent.click(markButton("Nickel"));

    await waitFor(() => expect(setItemStatus).toHaveBeenCalledTimes(1));
    expect(vi.mocked(setItemStatus).mock.calls[0]).toEqual([COLLECTION.id, NICKEL.id, "owned"]);
    expect(updateItem).not.toHaveBeenCalled();
  });

  it("marks itself busy with aria-disabled, never disabled, keeps focus, and refuses a second press", async () => {
    let finish: (marked: Item) => void = () => {};
    vi.mocked(setItemStatus).mockImplementation(
      () =>
        new Promise<Item>((resolve) => {
          finish = resolve;
        }),
    );
    renderAt(BASE);
    await waitFor(() => expect(rowTitles()).toContain("Nickel"));

    const mark = markButton("Nickel");
    mark.focus();
    fireEvent.click(mark);

    await waitFor(() => expect(mark).toHaveAttribute("aria-disabled", "true"));
    expect(mark).not.toBeDisabled();
    expect(mark).toHaveFocus();
    fireEvent.click(mark);
    fireEvent.click(mark);
    expect(setItemStatus).toHaveBeenCalledTimes(1);

    const owned = { ...NICKEL, status: "owned" as const };
    stored = stored.map((it) => (it.id === NICKEL.id ? owned : it));
    await act(async () => finish(owned));
    await waitFor(() => expect(screen.queryByRole("button", { name: markName("Nickel") })).toBeNull());
  });

  it("says a failure inside the row, with the message already in the alert, and leaves focus on the button", async () => {
    vi.mocked(setItemStatus).mockRejectedValue(new Error("offline"));
    renderAt(BASE);
    await waitFor(() => expect(rowTitles()).toContain("Nickel"));

    const mark = markButton("Nickel");
    mark.focus();
    fireEvent.click(mark);

    const alert = await within(row(NICKEL)).findByRole("alert");
    expect(alert).toHaveTextContent(
      "Could not mark this item as collected. Its status has not changed — check that the app's server is running, then try again.",
    );
    expect(within(row(DIME)).queryByRole("alert")).toBeNull();
    expect(mark).toHaveFocus();
    expect(mark).not.toHaveAttribute("aria-disabled");
    // Still wanted, still offered: the retry is where the user is.
    expect(row(NICKEL).querySelector(".item-row")?.className).toBe("item-row item-row-wanted");
    expect(announcer()).not.toHaveTextContent("Marked");
  });

  it("clears the failure when the user tries again", async () => {
    vi.mocked(setItemStatus).mockRejectedValueOnce(new Error("offline"));
    renderAt(BASE);
    await waitFor(() => expect(rowTitles()).toContain("Nickel"));
    fireEvent.click(markButton("Nickel"));
    await within(row(NICKEL)).findByRole("alert");

    acceptMarks();
    fireEvent.click(markButton("Nickel"));
    await waitFor(() => expect(within(row(NICKEL)).queryByRole("alert")).toBeNull());
  });
});

describe("focus after Mark collected (#42, D10)", () => {
  it("under All the row stays: focus goes to its Edit, the button is gone, and the mark is spoken", async () => {
    acceptMarks();
    renderAt(BASE);
    await waitFor(() => expect(rowTitles()).toEqual(["Penny", "Nickel", "Dime", "Quarter"]));

    const mark = markButton("Nickel");
    mark.focus();
    fireEvent.click(mark);

    await waitFor(() => expect(screen.getByRole("button", { name: "Edit “Nickel”" })).toHaveFocus());
    expect(screen.queryByRole("button", { name: markName("Nickel") })).toBeNull();
    expect(row(NICKEL).querySelector(".item-row")?.className).toBe("item-row");
    expect(rowTitles()).toEqual(["Penny", "Nickel", "Dime", "Quarter"]);
    await waitFor(() => expect(announcer()).toHaveTextContent("Marked “Nickel” as collected."));
    expect(announcer()).not.toHaveTextContent("no longer");
  });

  it("pressed without focus, still lands on the row's Edit rather than leaving focus on <body>", async () => {
    acceptMarks();
    renderAt(BASE);
    await waitFor(() => expect(rowTitles()).toContain("Nickel"));

    const mark = markButton("Nickel");
    (document.activeElement as HTMLElement | null)?.blur();
    fireEvent.click(mark);

    await waitFor(() => expect(screen.getByRole("button", { name: "Edit “Nickel”" })).toHaveFocus());
  });

  it("under the status sort the row moves but stays listed, and focus follows it to its new place", async () => {
    acceptMarks();
    renderAt(`${BASE}?sort=status`);
    // owned, ordered, wanted
    await waitFor(() => expect(rowTitles()).toEqual(["Penny", "Quarter", "Dime", "Nickel"]));

    const mark = markButton("Nickel");
    mark.focus();
    fireEvent.click(mark);

    await waitFor(() => expect(rowTitles()).toEqual(["Penny", "Nickel", "Quarter", "Dime"]));
    await waitFor(() => expect(screen.getByRole("button", { name: "Edit “Nickel”" })).toHaveFocus());
    await waitFor(() => expect(announcer()).toHaveTextContent("Marked “Nickel” as collected."));
  });

  it("under Remaining the row goes: focus goes to the row in its place, and the message says why it went", async () => {
    acceptMarks();
    renderAt(`${BASE}?show=remaining`);
    await waitFor(() => expect(rowTitles()).toEqual(["Nickel", "Dime"]));

    const mark = markButton("Nickel");
    mark.focus();
    fireEvent.click(mark);

    await waitFor(() => expect(rowTitles()).toEqual(["Dime"]));
    await waitFor(() => expect(screen.getByRole("button", { name: "Edit “Dime”" })).toHaveFocus());
    await waitFor(() =>
      expect(announcer()).toHaveTextContent("Marked “Nickel” as collected. It is no longer in this list."),
    );
  });

  it("under Remaining, the last row's mark goes to the row before it", async () => {
    acceptMarks();
    renderAt(`${BASE}?show=remaining`);
    await waitFor(() => expect(rowTitles()).toEqual(["Nickel", "Dime"]));

    fireEvent.click(markButton("Dime"));

    await waitFor(() => expect(rowTitles()).toEqual(["Nickel"]));
    await waitFor(() => expect(screen.getByRole("button", { name: "Edit “Nickel”" })).toHaveFocus());
  });

  it("under Remaining, pressed without focus, still hands focus to the row in its place", async () => {
    acceptMarks();
    renderAt(`${BASE}?show=remaining`);
    await waitFor(() => expect(rowTitles()).toEqual(["Nickel", "Dime"]));

    const mark = markButton("Nickel");
    (document.activeElement as HTMLElement | null)?.blur();
    fireEvent.click(mark);

    await waitFor(() => expect(rowTitles()).toEqual(["Dime"]));
    await waitFor(() => expect(screen.getByRole("button", { name: "Edit “Dime”" })).toHaveFocus());
  });

  it("marking the last remaining item completes the set: focus goes to the panel, described by 'All collected' (R19)", async () => {
    stored = [PENNY, NICKEL];
    acceptMarks();
    renderAt(`${BASE}?show=remaining`, FINITE(2));
    await waitFor(() => expect(rowTitles()).toEqual(["Nickel"]));
    await waitFor(() => expect(document.querySelector(".collection-progress")).toHaveTextContent("1 of 2 collected"));

    const mark = markButton("Nickel");
    mark.focus();
    fireEvent.click(mark);

    await waitFor(() => expect(panel()).toHaveFocus());
    expect(panel()).toHaveAccessibleDescription("All collected You own every item in this set.");
    await waitFor(() => expect(document.querySelector(".collection-progress")).toHaveTextContent("2 of 2 collected"));
    await waitFor(() =>
      expect(announcer()).toHaveTextContent("Marked “Nickel” as collected. It is no longer in this list."),
    );
  });

  it("marking the last remaining item short of the target says how many are left to find", async () => {
    stored = [PENNY, NICKEL];
    acceptMarks();
    renderAt(`${BASE}?show=remaining`, FINITE(5));
    await waitFor(() => expect(rowTitles()).toEqual(["Nickel"]));

    fireEvent.click(markButton("Nickel"));

    await waitFor(() => expect(panel()).toHaveFocus());
    expect(panel()).toHaveAccessibleDescription(
      "3 more to find Nothing is on your wanted list. Add the items you are looking for as Wanted or Ordered.",
    );
  });

  it("moves the header's count on a finite set as the item is marked", async () => {
    acceptMarks();
    renderAt(BASE, FINITE(4));
    await waitFor(() => expect(document.querySelector(".collection-progress")).toHaveTextContent("2 of 4 collected"));

    fireEvent.click(markButton("Dime"));

    await waitFor(() => expect(document.querySelector(".collection-progress")).toHaveTextContent("3 of 4 collected"));
  });
});

describe("Mark collected beside the row's other actions (#42)", () => {
  it("while a mark is in flight, Edit and Delete on the same row refuse rather than act on an item about to change", async () => {
    let finish: (marked: Item) => void = () => {};
    vi.mocked(setItemStatus).mockImplementation(
      () =>
        new Promise<Item>((resolve) => {
          finish = resolve;
        }),
    );
    renderAt(`${BASE}?show=remaining`);
    await waitFor(() => expect(rowTitles()).toEqual(["Nickel", "Dime"]));

    fireEvent.click(markButton("Nickel"));
    const edit = screen.getByRole("button", { name: "Edit “Nickel”" });
    const del = screen.getByRole("button", { name: "Delete “Nickel”" });
    await waitFor(() => expect(edit).toHaveAttribute("aria-disabled", "true"));
    expect(del).toHaveAttribute("aria-disabled", "true");
    expect(edit).not.toBeDisabled();

    fireEvent.click(edit);
    fireEvent.click(del);
    expect(screen.queryByRole("form", { name: "Editing “Nickel”" })).toBeNull();
    expect(deleteItem).not.toHaveBeenCalled();
    // Another row is not busy.
    expect(screen.getByRole("button", { name: "Edit “Dime”" })).not.toHaveAttribute("aria-disabled");

    const owned = { ...NICKEL, status: "owned" as const };
    stored = stored.map((it) => (it.id === NICKEL.id ? owned : it));
    await act(async () => finish(owned));
    await waitFor(() => expect(rowTitles()).toEqual(["Dime"]));
  });

  it("while a delete is in flight, Mark collected and Delete refuse, so the item is neither marked nor deleted twice", async () => {
    let finish: () => void = () => {};
    vi.mocked(deleteItem).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    renderAt(BASE);
    await waitFor(() => expect(rowTitles()).toContain("Nickel"));

    const del = screen.getByRole("button", { name: "Delete “Nickel”" });
    del.focus();
    fireEvent.click(del);
    const mark = markButton("Nickel");
    await waitFor(() => expect(mark).toHaveAttribute("aria-disabled", "true"));
    expect(del).toHaveAttribute("aria-disabled", "true");
    expect(del).toHaveFocus();

    fireEvent.click(mark);
    fireEvent.click(del);
    expect(setItemStatus).not.toHaveBeenCalled();
    expect(deleteItem).toHaveBeenCalledTimes(1);

    stored = stored.filter((it) => it.id !== NICKEL.id);
    await act(async () => finish());
    await waitFor(() => expect(rowTitles()).toEqual(["Penny", "Dime", "Quarter"]));
    expect(await screen.findByRole("button", { name: "Undo" })).toBeInTheDocument();
  });
});
