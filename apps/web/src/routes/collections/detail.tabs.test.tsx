import type { Collection, Item, ItemStatus } from "@mycollections/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ItemListQuery } from "../../lib/api-client.js";
import { parseSearch, stringifySearch } from "../../lib/search-params.js";
import { rootRoute } from "../__root.js";
import { authenticatedRoute } from "../_authenticated.js";
import { collectionDetailRoute } from "./$id.js";

vi.mock("../../lib/api-client.js", () => ({
  getCollection: vi.fn(),
  getCollectionCounts: vi.fn(),
  listItems: vi.fn(),
  createItem: vi.fn(),
  updateItem: vi.fn(),
  deleteItem: vi.fn(),
  restoreItem: vi.fn(),
  getToken: vi.fn(() => "test-token"),
}));

import {
  createItem,
  deleteItem,
  getCollection,
  getCollectionCounts,
  listItems,
  restoreItem,
  updateItem,
} from "../../lib/api-client.js";

/**
 * The status tabs on a collection's page (#42, slice 6): All, Collected and
 * Remaining, filtered on the client from the one list the page already
 * fetched (R4), with the tab in the URL as `?show=`.
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
  itemView: "list",
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

/** The server, played by the mock: a case-insensitive title match and a year range. It knows nothing of tabs. */
let stored: Item[];
function serve(_collectionId: string, query: ItemListQuery = {}): Promise<Item[]> {
  const q = query.q?.trim().toLowerCase();
  const titleOf = (it: Item) => String(it.fields.title ?? "").toLowerCase();
  let found = q ? stored.filter((it) => titleOf(it).includes(q)) : [...stored];
  for (const f of query.filter ? (JSON.parse(query.filter) as { field: string; op: string; value: number }[]) : []) {
    const yearOf = (it: Item) => it.fields[f.field] as number;
    if (f.op === "gte") found = found.filter((it) => yearOf(it) >= f.value);
    if (f.op === "lte") found = found.filter((it) => yearOf(it) <= f.value);
  }
  return Promise.resolve(found);
}

function renderAt(path: string, collection: Collection = COLLECTION) {
  vi.mocked(getCollection).mockResolvedValue(collection);
  const history = createMemoryHistory({ initialEntries: [path] });
  const router = createRouter({
    routeTree: rootRoute.addChildren([authenticatedRoute.addChildren([collectionDetailRoute])]),
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

function tab(name: "All" | "Collected" | "Remaining"): HTMLElement {
  return screen.getByRole("tab", { name });
}

function panel(): HTMLElement {
  return screen.getByRole("tabpanel");
}

function addForm(): HTMLElement {
  const form = document.querySelector<HTMLElement>(".add-item");
  if (!form) throw new Error("no add form");
  return form;
}

/** The empty state's title and description, as one array, or null when there is none. */
function emptyState(): [string, string] | null {
  const state = document.querySelector(".empty-state");
  if (!state) return null;
  const [title, description] = Array.from(state.querySelectorAll("p"), (p) => p.textContent ?? "");
  return [title ?? "", description ?? ""];
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

describe("the status tabs (#42)", () => {
  it("narrows the one list on the client, keeps the tab in the URL, and never asks the server again", async () => {
    const { router } = renderAt(BASE);
    await waitFor(() => expect(rowTitles()).toEqual(["Penny", "Nickel", "Dime", "Quarter"]));
    expect(screen.getByRole("tab", { selected: true })).toHaveTextContent("All");
    expect(panel()).toHaveAccessibleName("All");
    // All is the whole collection: no count line, as before the tabs.
    expect(document.querySelector(".item-count")).toBeNull();
    const fetches = vi.mocked(listItems).mock.calls.length;

    fireEvent.click(tab("Collected"));
    await waitFor(() => expect(rowTitles()).toEqual(["Penny", "Quarter"]));
    expect(router.state.location.search).toEqual({ show: "collected" });
    expect(panel()).toHaveAccessibleName("Collected");
    expect(document.querySelector(".item-count")).toHaveTextContent("2 items collected");

    fireEvent.click(tab("Remaining"));
    await waitFor(() => expect(rowTitles()).toEqual(["Nickel", "Dime"]));
    expect(router.state.location.search).toEqual({ show: "remaining" });
    expect(document.querySelector(".item-count")).toHaveTextContent("2 items remaining");

    fireEvent.click(tab("All"));
    await waitFor(() => expect(rowTitles()).toEqual(["Penny", "Nickel", "Dime", "Quarter"]));
    expect(router.state.location.search).toEqual({});

    // R4: the tabs are a view of the list already in hand.
    expect(vi.mocked(listItems).mock.calls.length).toBe(fetches);
    for (const [, query] of vi.mocked(listItems).mock.calls)
      expect(query).toEqual({ q: undefined, sort: undefined, filter: undefined });
  });

  it("replaces the history entry rather than pushing one, so Back leaves the page rather than stepping through tabs", async () => {
    const { router } = renderAt(BASE);
    await waitFor(() => expect(rowTitles()).toHaveLength(4));
    const length = router.history.length;
    fireEvent.click(tab("Collected"));
    await waitFor(() => expect(router.state.location.search).toEqual({ show: "collected" }));
    fireEvent.click(tab("Remaining"));
    await waitFor(() => expect(router.state.location.search).toEqual({ show: "remaining" }));
    expect(router.history.length).toBe(length);
  });

  it("opens on the tab in the URL, says nothing it already shows, and reads one it does not know as All", async () => {
    renderAt(`${BASE}?show=remaining`);
    await waitFor(() => expect(rowTitles()).toEqual(["Nickel", "Dime"]));
    expect(tab("Remaining")).toHaveAttribute("aria-selected", "true");
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(announcer()).not.toHaveTextContent("remaining");

    cleanup();
    renderAt(`${BASE}?show=owned`);
    await waitFor(() => expect(rowTitles()).toEqual(["Penny", "Nickel", "Dime", "Quarter"]));
    expect(tab("All")).toHaveAttribute("aria-selected", "true");
  });

  it("carries ?show=all forward as no param at all (R17)", async () => {
    const { router } = renderAt(`${BASE}?show=all`);
    await waitFor(() => expect(rowTitles()).toHaveLength(4));
    expect(tab("All")).toHaveAttribute("aria-selected", "true");
    fireEvent.change(screen.getByRole("searchbox", { name: "Search items" }), { target: { value: "nick" } });
    await waitFor(() => expect(router.state.location.search).toEqual({ q: "nick" }));
  });

  it("rewrites ?show=all, or a tab it does not know, as the bare address on arrival, keeping the rest", async () => {
    const { router } = renderAt(`${BASE}?show=all&q=nick`);
    await waitFor(() => expect(rowTitles()).toEqual(["Nickel"]));
    expect(router.history.location.href).toBe(`${BASE}?q=nick`);
    const entries = router.history.length;

    cleanup();
    const second = renderAt(`${BASE}?show=owned`);
    await waitFor(() => expect(rowTitles()).toHaveLength(4));
    expect(second.router.history.location.href).toBe(BASE);
    // Replaced, so Back does not land on the address that was rewritten.
    expect(second.router.history.length).toBe(entries);
  });

  it("composes with a search and with filters, and keeps the tab when either changes", async () => {
    const filter = encodeURIComponent('[{"field":"year","op":"gte","value":1914}]');
    const { router } = renderAt(`${BASE}?show=remaining&filter=${filter}`);
    // Remaining is Nickel (1913) and Dime (1916); the filter keeps 1914 on.
    await waitFor(() => expect(rowTitles()).toEqual(["Dime"]));
    // The count names the tab: the filter alone matches Dime and Quarter.
    expect(document.querySelector(".item-count")).toHaveTextContent("1 remaining item matches");

    fireEvent.click(screen.getByRole("button", { name: "Remove filter Year: from 1914" }));
    await waitFor(() => expect(rowTitles()).toEqual(["Nickel", "Dime"]));
    expect(router.state.location.search).toEqual({ show: "remaining" });

    fireEvent.change(screen.getByRole("searchbox", { name: "Search items" }), { target: { value: "e" } });
    // "e" matches Penny, Nickel, Dime and Quarter; the tab keeps the two remaining.
    await waitFor(() => expect(router.state.location.search).toEqual({ show: "remaining", q: "e" }));
    await waitFor(() => expect(rowTitles()).toEqual(["Nickel", "Dime"]));
    // Four items match "e"; two of them are remaining, and the line says which two it counts.
    expect(document.querySelector(".item-count")).toHaveTextContent("2 remaining items match “e”");

    fireEvent.click(tab("Collected"));
    await waitFor(() => expect(rowTitles()).toEqual(["Penny", "Quarter"]));
    expect(router.state.location.search).toEqual({ show: "collected", q: "e" });
    expect(document.querySelector(".item-count")).toHaveTextContent("2 collected items match “e”");

    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: "Minimum" }), { target: { value: "1920" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply filters" }));
    await waitFor(() => expect(rowTitles()).toEqual(["Quarter"]));
    expect(document.querySelector(".item-count")).toHaveTextContent("1 collected item matches “e” with these filters");
  });

  it("a search that matches only in another tab says so, how many match under All, and offers to show them", async () => {
    renderAt(`${BASE}?show=remaining`);
    await waitFor(() => expect(rowTitles()).toEqual(["Nickel", "Dime"]));
    fireEvent.change(screen.getByRole("searchbox", { name: "Search items" }), { target: { value: "penny" } });

    await waitFor(() =>
      expect(emptyState()).toEqual(["No remaining items match “penny”", "1 item matches under All."]),
    );
    expect(screen.queryByText("No items yet")).not.toBeInTheDocument();
    expect(screen.queryByText(/Try fewer or shorter words/)).not.toBeInTheDocument();
    await waitFor(
      () => expect(announcer()).toHaveTextContent("No remaining items match “penny”. 1 item matches under All."),
      { timeout: 3000 },
    );

    const show = screen.getByRole("button", { name: "Show them under All" });
    show.focus();
    fireEvent.click(show);
    await waitFor(() => expect(rowTitles()).toEqual(["Penny"]));
    expect(tab("All")).toHaveAttribute("aria-selected", "true");
    // The button went with the empty state; focus goes to the tab it selected.
    await waitFor(() => expect(tab("All")).toHaveFocus());
  });

  it("filters that match only in another tab say so too, and a search that matches nothing anywhere keeps its own advice", async () => {
    const filter = encodeURIComponent('[{"field":"year","op":"gte","value":1930}]');
    renderAt(`${BASE}?show=remaining&filter=${filter}`);
    await waitFor(() =>
      expect(emptyState()).toEqual(["No remaining items match these filters", "1 item matches under All."]),
    );

    cleanup();
    renderAt(`${BASE}?show=remaining&q=zzz`);
    await waitFor(() =>
      expect(emptyState()).toEqual([
        "No items match “zzz”",
        "Try fewer or shorter words. Search looks at text, choices, tags and numbers.",
      ]),
    );
    expect(screen.queryByRole("button", { name: "Show them under All" })).not.toBeInTheDocument();
  });

  it("shows no empty state built from the previous search while the next one loads", async () => {
    stored = [PENNY, NICKEL];
    let release: () => void = () => {};
    vi.mocked(listItems).mockImplementation((collectionId, query = {}) => {
      if (query.q) return serve(collectionId, query);
      return new Promise<Item[]>((resolve) => {
        release = () => void serve(collectionId, query).then(resolve);
      });
    });
    const { router } = renderAt(`${BASE}?show=remaining&q=zzz`, FINITE(5));
    await waitFor(() => expect(emptyState()?.[0]).toBe("No items match “zzz”"));

    fireEvent.change(screen.getByRole("searchbox", { name: "Search items" }), { target: { value: "" } });
    await waitFor(() => expect(router.state.location.search.q).toBeUndefined());
    await new Promise((resolve) => setTimeout(resolve, 50));
    // The kept "zzz" result is empty, but it is not this view's answer: no
    // "4 more to find" while Nickel is wanted, only the list's loading state.
    expect(emptyState()).toBeNull();
    expect(panel()).toHaveTextContent("Loading items…");
    expect(panel()).not.toHaveAttribute("aria-describedby");

    release();
    await waitFor(() => expect(rowTitles()).toEqual(["Nickel"]));
  });

  it("describes the panel by its empty state while one shows, and by nothing otherwise", async () => {
    stored = [PENNY];
    renderAt(BASE);
    await waitFor(() => expect(rowTitles()).toEqual(["Penny"]));
    expect(panel()).not.toHaveAttribute("aria-describedby");

    fireEvent.click(tab("Remaining"));
    await waitFor(() =>
      expect(panel()).toHaveAccessibleDescription(
        "Nothing on your wanted list Items whose status is Wanted or Ordered appear here.",
      ),
    );

    fireEvent.click(tab("Collected"));
    await waitFor(() => expect(rowTitles()).toEqual(["Penny"]));
    expect(panel()).not.toHaveAttribute("aria-describedby");
  });

  it("speaks the count of a tab once it settles, and the empty state's title when there is nothing in it", async () => {
    stored = [PENNY, QUARTER];
    renderAt(BASE);
    await waitFor(() => expect(rowTitles()).toEqual(["Penny", "Quarter"]));

    fireEvent.click(tab("Collected"));
    await waitFor(() => expect(announcer()).toHaveTextContent("2 items collected"), { timeout: 3000 });

    fireEvent.click(tab("Remaining"));
    await waitFor(() => expect(announcer()).toHaveTextContent("Nothing on your wanted list"), { timeout: 3000 });

    fireEvent.click(tab("All"));
    await waitFor(() => expect(announcer()).toHaveTextContent("Showing all 2 items"), { timeout: 3000 });
  });
});

describe("a tab with nothing in it (#42, R7)", () => {
  it.each([
    {
      when: "Collected, with nothing owned",
      collection: COLLECTION,
      items: [NICKEL, DIME],
      show: "collected",
      expected: ["Nothing collected yet", "Items whose status is Owned appear here."],
    },
    {
      when: "Collected, on an empty collection",
      collection: COLLECTION,
      items: [],
      show: "collected",
      expected: ["Nothing collected yet", "Items whose status is Owned appear here."],
    },
    {
      when: "Remaining, with no target to measure against",
      collection: COLLECTION,
      items: [PENNY],
      show: "remaining",
      expected: ["Nothing on your wanted list", "Items whose status is Wanted or Ordered appear here."],
    },
    {
      when: "Remaining, on a finite set with no target yet",
      collection: FINITE(null),
      items: [PENNY],
      show: "remaining",
      expected: ["Nothing on your wanted list", "Items whose status is Wanted or Ordered appear here."],
    },
    {
      when: "Remaining, on a finite set three short of its target",
      collection: FINITE(5),
      items: [PENNY, QUARTER],
      show: "remaining",
      expected: [
        "3 more to find",
        "Nothing is on your wanted list. Add the items you are looking for as Wanted or Ordered.",
      ],
    },
    {
      when: "Remaining, on a finite set one short of its target",
      collection: FINITE(3),
      items: [PENNY, QUARTER],
      show: "remaining",
      expected: [
        "1 more to find",
        "Nothing is on your wanted list. Add the items you are looking for as Wanted or Ordered.",
      ],
    },
    {
      when: "Remaining, on a complete set",
      collection: FINITE(2),
      items: [PENNY, QUARTER],
      show: "remaining",
      expected: ["All collected", "You own every item in this set."],
    },
    {
      when: "Remaining, on a set past its target",
      collection: FINITE(1),
      items: [PENNY, QUARTER],
      show: "remaining",
      expected: ["All collected", "You own every item in this set."],
    },
  ])("$when", async ({ collection, items, show, expected }) => {
    stored = items;
    renderAt(`${BASE}?show=${show}`, collection);
    await waitFor(() => expect(emptyState()).toEqual(expected));
    expect(screen.queryByText("No items yet")).not.toBeInTheDocument();
    expect(panel()).toContainElement(document.querySelector(".empty-state") as HTMLElement);
  });

  it("keeps 'No items yet' for the All tab of an empty collection", async () => {
    stored = [];
    renderAt(BASE);
    await waitFor(() => expect(emptyState()).toEqual(["No items yet", "Add your first item using the form below."]));
  });

  it("the header counts a set complete once owned reaches the target, while Remaining still lists its wanted items", async () => {
    stored = [PENNY, QUARTER, NICKEL];
    renderAt(`${BASE}?show=remaining`, FINITE(2));
    await waitFor(() => expect(rowTitles()).toEqual(["Nickel"]));
    await waitFor(() => expect(document.querySelector(".collection-progress")).toHaveTextContent("Complete"));
  });
});

describe("adding an item from a tab (#42, R16)", () => {
  it("starts the add form on Wanted under Remaining, and back on Owned elsewhere", async () => {
    renderAt(`${BASE}?show=remaining`);
    await waitFor(() => expect(rowTitles()).toEqual(["Nickel", "Dime"]));
    const status = within(addForm()).getByRole("combobox", { name: "Status" });
    expect(status).toHaveValue("wanted");

    const half = item("66666666-6666-4666-8666-666666666666", "Half dollar", 1948, "wanted");
    vi.mocked(createItem).mockImplementation(async () => {
      stored = [...stored, half];
      return half;
    });
    fireEvent.change(within(addForm()).getByRole("textbox", { name: "Title" }), { target: { value: "Half dollar" } });
    fireEvent.click(within(addForm()).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(rowTitles()).toEqual(["Nickel", "Dime", "Half dollar"]));
    expect(vi.mocked(createItem)).toHaveBeenCalledWith(COLLECTION.id, {
      status: "wanted",
      fields: { title: "Half dollar", year: null },
    });
    await waitFor(() => expect(document.querySelector(".add-item-live")).toHaveTextContent("Added “Half dollar”"));
    expect(document.querySelector(".add-item-live")).not.toHaveTextContent("isn’t shown");
    // Reset for the next item, still under Remaining.
    expect(status).toHaveValue("wanted");

    fireEvent.click(tab("Collected"));
    await waitFor(() => expect(status).toHaveValue("owned"));
  });

  it("keeps a status the user picked when the tab changes under it", async () => {
    renderAt(`${BASE}?show=remaining`);
    await waitFor(() => expect(rowTitles()).toEqual(["Nickel", "Dime"]));
    const status = within(addForm()).getByRole("combobox", { name: "Status" });
    fireEvent.change(status, { target: { value: "ordered" } });
    fireEvent.change(within(addForm()).getByRole("textbox", { name: "Title" }), { target: { value: "Half dollar" } });

    fireEvent.click(tab("All"));
    await waitFor(() => expect(tab("All")).toHaveAttribute("aria-selected", "true"));
    expect(status).toHaveValue("ordered");
    expect(within(addForm()).getByRole("textbox", { name: "Title" })).toHaveValue("Half dollar");
  });

  it("a row editor keeps the status the user picked when the list is fetched again underneath it", async () => {
    renderAt(BASE);
    await waitFor(() => expect(rowTitles()).toEqual(["Penny", "Nickel", "Dime", "Quarter"]));
    fireEvent.click(screen.getByRole("button", { name: "Edit “Nickel”" }));
    const editor = screen.getByRole("form", { name: "Editing “Nickel”" });
    const status = within(editor).getByRole("combobox", { name: "Status" });
    fireEvent.change(status, { target: { value: "ordered" } });

    // Meanwhile Nickel is marked owned elsewhere, and a delete of another row
    // fetches the list again with that status in it.
    stored = stored.map((it) => (it.id === NICKEL.id ? { ...it, status: "owned" as const } : it));
    vi.mocked(deleteItem).mockImplementation(async () => {
      stored = stored.filter((it) => it.id !== QUARTER.id);
    });
    fireEvent.click(screen.getByRole("button", { name: "Delete “Quarter”" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Edit “Quarter”" })).not.toBeInTheDocument());

    expect(status).toHaveValue("ordered");
  });

  it("an add the tab hides says so, naming the tab among the reasons", async () => {
    renderAt(`${BASE}?show=collected`);
    await waitFor(() => expect(rowTitles()).toEqual(["Penny", "Quarter"]));
    const half = item("66666666-6666-4666-8666-666666666666", "Half dollar", 1948, "wanted");
    vi.mocked(createItem).mockImplementation(async () => {
      stored = [...stored, half];
      return half;
    });
    fireEvent.change(within(addForm()).getByRole("combobox", { name: "Status" }), { target: { value: "wanted" } });
    fireEvent.change(within(addForm()).getByRole("textbox", { name: "Title" }), { target: { value: "Half dollar" } });
    fireEvent.click(within(addForm()).getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(document.querySelector(".add-item-live")).toHaveTextContent(
        "Added “Half dollar”. It doesn’t match the current search, filters or tab, so it isn’t shown.",
      ),
    );
    expect(rowTitles()).toEqual(["Penny", "Quarter"]);
  });
});

describe("when the tab hides the row the user was on (#42)", () => {
  it("saving an owned item as wanted under Collected hands focus to the row in its place, and says why it went", async () => {
    renderAt(`${BASE}?show=collected`);
    await waitFor(() => expect(rowTitles()).toEqual(["Penny", "Quarter"]));

    const edit = screen.getByRole("button", { name: "Edit “Penny”" });
    edit.focus();
    fireEvent.click(edit);
    const wanted = { ...PENNY, status: "wanted" as const };
    vi.mocked(updateItem).mockImplementation(async () => {
      stored = stored.map((it) => (it.id === PENNY.id ? wanted : it));
      return wanted;
    });
    const editor = screen.getByRole("form", { name: "Editing “Penny”" });
    fireEvent.change(within(editor).getByRole("combobox", { name: "Status" }), { target: { value: "wanted" } });
    fireEvent.click(within(editor).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(rowTitles()).toEqual(["Quarter"]));
    await waitFor(() => expect(screen.getByRole("button", { name: "Edit “Quarter”" })).toHaveFocus());
    await waitFor(() =>
      expect(announcer()).toHaveTextContent(
        "Saved “Penny”. It no longer matches the current search, filters or tab, so it isn’t shown.",
      ),
    );
  });

  it("saving the only item out of its tab hands focus to the panel, which now holds the empty state", async () => {
    stored = [PENNY, NICKEL];
    renderAt(`${BASE}?show=remaining`);
    await waitFor(() => expect(rowTitles()).toEqual(["Nickel"]));

    const edit = screen.getByRole("button", { name: "Edit “Nickel”" });
    edit.focus();
    fireEvent.click(edit);
    const owned = { ...NICKEL, status: "owned" as const };
    vi.mocked(updateItem).mockImplementation(async () => {
      stored = stored.map((it) => (it.id === NICKEL.id ? owned : it));
      return owned;
    });
    const editor = screen.getByRole("form", { name: "Editing “Nickel”" });
    fireEvent.change(within(editor).getByRole("combobox", { name: "Status" }), { target: { value: "owned" } });
    fireEvent.click(within(editor).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(emptyState()?.[0]).toBe("Nothing on your wanted list"));
    await waitFor(() => expect(panel()).toHaveFocus());
  });

  it("saving an item that stays in its tab returns focus to its own Edit, unannounced", async () => {
    renderAt(`${BASE}?show=remaining`);
    await waitFor(() => expect(rowTitles()).toEqual(["Nickel", "Dime"]));
    const edit = screen.getByRole("button", { name: "Edit “Nickel”" });
    edit.focus();
    fireEvent.click(edit);
    const ordered = { ...NICKEL, status: "ordered" as const };
    vi.mocked(updateItem).mockImplementation(async () => {
      stored = stored.map((it) => (it.id === NICKEL.id ? ordered : it));
      return ordered;
    });
    const editor = screen.getByRole("form", { name: "Editing “Nickel”" });
    fireEvent.change(within(editor).getByRole("combobox", { name: "Status" }), { target: { value: "ordered" } });
    fireEvent.click(within(editor).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Edit “Nickel”" })).toHaveFocus());
    expect(rowTitles()).toEqual(["Nickel", "Dime"]);
    expect(announcer()).not.toHaveTextContent("isn’t shown");
  });

  it("deleting the last item in a tab hands focus to the panel, which now holds the empty state", async () => {
    stored = [PENNY, NICKEL];
    renderAt(`${BASE}?show=remaining`);
    await waitFor(() => expect(rowTitles()).toEqual(["Nickel"]));
    vi.mocked(deleteItem).mockImplementation(async () => {
      stored = stored.filter((it) => it.id !== NICKEL.id);
    });

    const del = screen.getByRole("button", { name: "Delete “Nickel”" });
    del.focus();
    fireEvent.click(del);

    await waitFor(() => expect(emptyState()?.[0]).toBe("Nothing on your wanted list"));
    await waitFor(() => expect(panel()).toHaveFocus());
    expect(await screen.findByRole("button", { name: "Undo" })).toBeInTheDocument();
  });

  it("an Undo that restores into another tab hands focus where the delete left it, and says why it is not shown", async () => {
    renderAt(`${BASE}?show=collected`);
    await waitFor(() => expect(rowTitles()).toEqual(["Penny", "Quarter"]));
    vi.mocked(deleteItem).mockImplementation(async () => {
      stored = stored.filter((it) => it.id !== PENNY.id);
    });
    vi.mocked(restoreItem).mockImplementation(async () => {
      stored = [PENNY, ...stored];
      return PENNY;
    });

    const del = screen.getByRole("button", { name: "Delete “Penny”" });
    del.focus();
    fireEvent.click(del);
    await waitFor(() => expect(rowTitles()).toEqual(["Quarter"]));

    // The user moves to Remaining before regretting it: Penny is owned, so the
    // restore lands outside the tab on screen.
    fireEvent.click(tab("Remaining"));
    await waitFor(() => expect(rowTitles()).toEqual(["Nickel", "Dime"]));
    const undo = screen.getByRole("button", { name: "Undo" });
    undo.focus();
    fireEvent.click(undo);

    await waitFor(() => expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole("button", { name: "Edit “Nickel”" })).toHaveFocus());
    await waitFor(() =>
      expect(announcer()).toHaveTextContent(
        "Restored “Penny”. It doesn’t match the current search, filters or tab, so it isn’t shown.",
      ),
    );
    expect(rowTitles()).toEqual(["Nickel", "Dime"]);
  });
});
