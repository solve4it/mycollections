import type { Collection, Item } from "@mycollections/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ItemListQuery } from "../../lib/api-client.js";
import { parseSearch, stringifySearch } from "../../lib/search-params.js";
import { rootRoute } from "../__root.js";
import { collectionDetailRoute } from "./$id.js";

vi.mock("../../lib/api-client.js", () => ({
  getCollection: vi.fn(),
  listItems: vi.fn(),
  createItem: vi.fn(),
  updateItem: vi.fn(),
  deleteItem: vi.fn(),
  restoreItem: vi.fn(),
  getToken: vi.fn(() => "test-token"),
}));

import { createItem, getCollection, listItems, restoreItem, updateItem } from "../../lib/api-client.js";

const COLLECTION: Collection = {
  id: "11111111-1111-1111-1111-111111111111",
  name: "Games",
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

function item(id: string, title: string, year?: number): Item {
  return {
    id,
    collectionId: COLLECTION.id,
    status: "owned",
    fields: year === undefined ? { title } : { title, year },
    createdAt: "2024-01-02T00:00:00.000Z",
    updatedAt: "2024-01-02T00:00:00.000Z",
    deletedAt: null,
  };
}

const ZELDA = item("22222222-2222-4222-8222-222222222222", "Zelda", 1986);
const ZELDA_II = item("33333333-3333-4333-8333-333333333333", "Zelda II", 1987);
const MARIO = item("44444444-4444-4444-8444-444444444444", "Mario", 1985);

/** The server, played by the mock: a case-insensitive title match. */
let stored: Item[];
function serve(_collectionId: string, query: ItemListQuery = {}): Promise<Item[]> {
  const q = query.q?.trim().toLowerCase();
  const titleOf = (it: Item) => String(it.fields.title ?? "").toLowerCase();
  let found = q ? stored.filter((it) => titleOf(it).includes(q)) : [...stored];
  for (const f of query.filter ? (JSON.parse(query.filter) as { field: string; op: string; value: number }[]) : []) {
    const yearOf = (it: Item) => (typeof it.fields[f.field] === "number" ? (it.fields[f.field] as number) : null);
    if (f.op === "gte") found = found.filter((it) => (yearOf(it) ?? -Infinity) >= f.value);
    if (f.op === "lte") found = found.filter((it) => (yearOf(it) ?? Infinity) <= f.value);
  }
  if (query.sort === "name" || query.sort === "-name") {
    found.sort((a, b) => titleOf(a).localeCompare(titleOf(b)));
    if (query.sort === "-name") found.reverse();
  }
  if (query.sort === "status" || query.sort === "-status") {
    const rank = { owned: 0, ordered: 1, wanted: 2 } as const;
    found.sort((a, b) => rank[a.status] - rank[b.status]);
    if (query.sort === "-status") found.reverse();
  }
  return Promise.resolve(found);
}

function renderAt(path: string) {
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

function searchBox() {
  return screen.getByRole("searchbox", { name: "Search items" });
}

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

beforeEach(() => {
  localStorage.setItem("api_token", "test-token");
  vi.resetAllMocks();
  stored = [ZELDA, ZELDA_II, MARIO];
  vi.mocked(getCollection).mockResolvedValue(COLLECTION);
  vi.mocked(listItems).mockImplementation(serve);
});

afterEach(() => {
  cleanup();
});

describe("searching a collection (#41)", () => {
  it("narrows the list as the user types, puts the search in the URL, and says how many match", async () => {
    const { router } = renderAt(BASE);
    await waitFor(() => expect(rowTitles()).toEqual(["Zelda", "Zelda II", "Mario"]));

    fireEvent.change(searchBox(), { target: { value: "zel" } });

    await waitFor(() => expect(rowTitles()).toEqual(["Zelda", "Zelda II"]));
    expect(router.state.location.search).toEqual({ q: "zel" });
    expect(screen.getByText("2 items match “zel”")).toBeInTheDocument();
    expect(vi.mocked(listItems)).toHaveBeenLastCalledWith(COLLECTION.id, {
      q: "zel",
      sort: undefined,
      filter: undefined,
    });
    // Spoken once the result has settled, through the shell's announcer.
    await waitFor(() => expect(announcer()).toHaveTextContent("2 items match “zel”"), { timeout: 3000 });
  });

  it("opens on a search from the URL — numbers included — without announcing what the page already says", async () => {
    stored = [item("55555555-5555-4555-8555-555555555555", "1984"), MARIO];
    renderAt(`${BASE}?q=1984`);

    await waitFor(() => expect(rowTitles()).toEqual(["1984"]));
    expect(searchBox()).toHaveValue("1984");
    expect(screen.getByText("1 item matches “1984”")).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(announcer()).not.toHaveTextContent("matches");
  });

  it("keeps 'nothing matches' apart from 'nothing here', and Clear search hands focus to the box", async () => {
    const { router } = renderAt(`${BASE}?q=sonic`);

    expect(await screen.findByText("No items match “sonic”")).toBeInTheDocument();
    expect(screen.queryByText(/no items yet/i)).not.toBeInTheDocument();
    // The count line is the empty state's job here, not said twice.
    expect(screen.queryByText(/^\d+ items? match(es)? “sonic”$/)).not.toBeInTheDocument();

    const clear = screen.getByRole("button", { name: "Clear search" });
    clear.focus();
    fireEvent.click(clear);

    await waitFor(() => expect(rowTitles()).toEqual(["Zelda", "Zelda II", "Mario"]));
    expect(router.state.location.search).toEqual({});
    await waitFor(() => expect(searchBox()).toHaveFocus());
    expect(searchBox()).toHaveValue("");
    await waitFor(() => expect(announcer()).toHaveTextContent("Showing all 3 items"), { timeout: 3000 });
  });

  it("drops a sort the collection cannot honour instead of failing to load", async () => {
    renderAt(`${BASE}?sort=field:gone`);
    await waitFor(() => expect(rowTitles()).toEqual(["Zelda", "Zelda II", "Mario"]));
    expect(vi.mocked(listItems)).toHaveBeenCalledWith(COLLECTION.id, {
      q: undefined,
      sort: undefined,
      filter: undefined,
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("when a search hides the row the user was on (#41)", () => {
  it("saving an item so it no longer matches hands focus to the row that took its place, and says why it went", async () => {
    renderAt(`${BASE}?q=zel`);
    await waitFor(() => expect(rowTitles()).toEqual(["Zelda", "Zelda II"]));

    const edit = screen.getByRole("button", { name: "Edit “Zelda”" });
    edit.focus();
    fireEvent.click(edit);
    const renamed = { ...ZELDA, fields: { title: "Link" } };
    vi.mocked(updateItem).mockImplementation(async () => {
      stored = stored.map((it) => (it.id === ZELDA.id ? renamed : it));
      return renamed;
    });
    const editor = screen.getByRole("form", { name: "Editing “Zelda”" });
    fireEvent.change(within(editor).getByRole("textbox", { name: /title/i }), { target: { value: "Link" } });
    fireEvent.click(within(editor).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(rowTitles()).toEqual(["Zelda II"]));
    // The successor rule, as for a delete: the row now at its index.
    await waitFor(() => expect(screen.getByRole("button", { name: "Edit “Zelda II”" })).toHaveFocus());
    await waitFor(() =>
      expect(announcer()).toHaveTextContent(
        "Saved “Link”. It no longer matches the current search or filters, so it isn’t shown.",
      ),
    );
  });

  it("saving an item that still matches returns focus to its own Edit", async () => {
    renderAt(`${BASE}?q=zel`);
    await waitFor(() => expect(rowTitles()).toEqual(["Zelda", "Zelda II"]));

    const edit = screen.getByRole("button", { name: "Edit “Zelda”" });
    edit.focus();
    fireEvent.click(edit);
    const renamed = { ...ZELDA, fields: { title: "Zelda III" } };
    vi.mocked(updateItem).mockImplementation(async () => {
      stored = stored.map((it) => (it.id === ZELDA.id ? renamed : it));
      return renamed;
    });
    const editor = screen.getByRole("form", { name: "Editing “Zelda”" });
    fireEvent.change(within(editor).getByRole("textbox", { name: /title/i }), { target: { value: "Zelda III" } });
    fireEvent.click(within(editor).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Edit “Zelda III”" })).toHaveFocus());
  });

  it("adding an item the search hides says so where it confirms the add", async () => {
    renderAt(`${BASE}?q=zel`);
    await waitFor(() => expect(rowTitles()).toEqual(["Zelda", "Zelda II"]));

    const sonic = item("66666666-6666-4666-8666-666666666666", "Sonic");
    vi.mocked(createItem).mockImplementation(async () => {
      stored = [...stored, sonic];
      return sonic;
    });
    const form = document.querySelector<HTMLElement>(".add-item");
    if (!form) throw new Error("no add form");
    fireEvent.change(within(form).getByRole("textbox", { name: /title/i }), { target: { value: "Sonic" } });
    fireEvent.click(within(form).getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(document.querySelector(".add-item-live")).toHaveTextContent(
        "Added “Sonic”. It doesn’t match the current search or filters, so it isn’t shown.",
      ),
    );
  });

  it("undoing a delete of an item the search hides hands focus where the delete left it", async () => {
    renderAt(`${BASE}?q=zel`);
    await waitFor(() => expect(rowTitles()).toEqual(["Zelda", "Zelda II"]));
    const { deleteItem } = await import("../../lib/api-client.js");
    vi.mocked(deleteItem).mockImplementation(async () => {
      stored = stored.filter((it) => it.id !== ZELDA.id);
    });
    // Restored under a name the search does not match — as if edited elsewhere meanwhile.
    vi.mocked(restoreItem).mockImplementation(async () => {
      const back = { ...ZELDA, fields: { title: "Link" } };
      stored = [back, ...stored];
      return back;
    });

    // Pressed from the keyboard: focus is on each control as it is used, which
    // is what a handoff takes over from.
    const del = screen.getByRole("button", { name: "Delete “Zelda”" });
    del.focus();
    fireEvent.click(del);
    await waitFor(() => expect(rowTitles()).toEqual(["Zelda II"]));
    const undo = await screen.findByRole("button", { name: "Undo" });
    undo.focus();
    fireEvent.click(undo);

    await waitFor(() => expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole("button", { name: "Edit “Zelda II”" })).toHaveFocus());
    await waitFor(() =>
      expect(announcer()).toHaveTextContent(
        "Restored “Link”. It doesn’t match the current search or filters, so it isn’t shown.",
      ),
    );
  });
});

describe("a search that changes while an add is saving (#41)", () => {
  it("judges whether the new item is shown against the search on screen when it lands", async () => {
    renderAt(`${BASE}?q=zel`);
    await waitFor(() => expect(rowTitles()).toEqual(["Zelda", "Zelda II"]));

    const added = item("77777777-7777-4777-8777-777777777777", "Zelda Z");
    let land: () => void = () => {};
    vi.mocked(createItem).mockImplementation(
      () =>
        new Promise((resolve) => {
          land = () => {
            stored = [...stored, added];
            resolve(added);
          };
        }),
    );
    const form = document.querySelector<HTMLElement>(".add-item");
    if (!form) throw new Error("no add form");
    fireEvent.change(within(form).getByRole("textbox", { name: /title/i }), { target: { value: "Zelda Z" } });
    fireEvent.click(within(form).getByRole("button", { name: "Save" }));

    // The search is cleared while the add is still in flight.
    fireEvent.change(searchBox(), { target: { value: "" } });
    fireEvent.submit(searchBox());
    await waitFor(() => expect(rowTitles()).toEqual(["Zelda", "Zelda II", "Mario"]));
    land();

    await waitFor(() => expect(rowTitles()).toContain("Zelda Z"));
    await waitFor(() => expect(document.querySelector(".add-item-live")).toHaveTextContent("Added “Zelda Z”"));
    expect(document.querySelector(".add-item-live")).not.toHaveTextContent("isn’t shown");
  });
});

describe("sorting a collection (#41)", () => {
  function sortSelect() {
    return screen.getByRole("combobox", { name: "Sort by" });
  }

  it("orders the list by the option chosen and keeps it in the URL", async () => {
    const { router } = renderAt(BASE);
    await waitFor(() => expect(rowTitles()).toEqual(["Zelda", "Zelda II", "Mario"]));

    fireEvent.change(sortSelect(), { target: { value: "-name" } });

    await waitFor(() => expect(rowTitles()).toEqual(["Zelda II", "Zelda", "Mario"]));
    expect(router.state.location.search).toEqual({ sort: "-name" });
    expect(vi.mocked(listItems)).toHaveBeenLastCalledWith(COLLECTION.id, {
      q: undefined,
      sort: "-name",
      filter: undefined,
    });

    fireEvent.change(sortSelect(), { target: { value: "" } });
    await waitFor(() => expect(router.state.location.search).toEqual({}));
  });

  it("sorts by status from the select, and opens on a status sort from the URL (#42)", async () => {
    stored = [{ ...ZELDA, status: "wanted" }, ZELDA_II, { ...MARIO, status: "ordered" }];
    const { router } = renderAt(BASE);
    await waitFor(() => expect(rowTitles()).toEqual(["Zelda", "Zelda II", "Mario"]));

    const option = within(sortSelect()).getByRole("option", { name: "Status, remaining first" });
    fireEvent.change(sortSelect(), { target: { value: (option as HTMLOptionElement).value } });

    await waitFor(() => expect(rowTitles()).toEqual(["Zelda", "Mario", "Zelda II"]));
    expect(router.state.location.search).toEqual({ sort: "-status" });
    expect(vi.mocked(listItems)).toHaveBeenLastCalledWith(COLLECTION.id, {
      q: undefined,
      sort: "-status",
      filter: undefined,
    });

    cleanup();
    renderAt(`${BASE}?sort=status`);
    await waitFor(() => expect(rowTitles()).toEqual(["Zelda II", "Mario", "Zelda"]));
    expect(sortSelect()).toHaveValue("status");
    expect(vi.mocked(listItems)).toHaveBeenLastCalledWith(COLLECTION.id, {
      q: undefined,
      sort: "status",
      filter: undefined,
    });
  });

  it("a save that moves the row under the sort keeps focus on that row's Edit", async () => {
    renderAt(`${BASE}?sort=name`);
    await waitFor(() => expect(rowTitles()).toEqual(["Mario", "Zelda", "Zelda II"]));

    const edit = screen.getByRole("button", { name: "Edit “Mario”" });
    edit.focus();
    fireEvent.click(edit);
    const renamed = { ...MARIO, fields: { title: "Zzz" } };
    vi.mocked(updateItem).mockImplementation(async () => {
      stored = stored.map((it) => (it.id === MARIO.id ? renamed : it));
      return renamed;
    });
    const editor = screen.getByRole("form", { name: "Editing “Mario”" });
    fireEvent.change(within(editor).getByRole("textbox", { name: /title/i }), { target: { value: "Zzz" } });
    fireEvent.click(within(editor).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(rowTitles()).toEqual(["Zelda", "Zelda II", "Zzz"]));
    await waitFor(() => expect(screen.getByRole("button", { name: "Edit “Zzz”" })).toHaveFocus());
  });
});

describe("filtering a collection (#41)", () => {
  it("applies filters from the panel, puts them in the URL, says how many match, and shows a chip", async () => {
    const { router } = renderAt(BASE);
    await waitFor(() => expect(rowTitles()).toEqual(["Zelda", "Zelda II", "Mario"]));

    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: "Minimum" }), { target: { value: "1986" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply filters" }));

    await waitFor(() => expect(rowTitles()).toEqual(["Zelda", "Zelda II"]));
    expect(router.state.location.search).toEqual({ filter: '[{"field":"year","op":"gte","value":1986}]' });
    expect(screen.getByText("2 items match")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove filter Year: from 1986" })).toBeInTheDocument();
    await waitFor(() => expect(announcer()).toHaveTextContent("2 items match"), { timeout: 3000 });
  });

  it("removing the last chip hands focus to the Filters toggle and shows everything again", async () => {
    renderAt(`${BASE}?filter=${encodeURIComponent('[{"field":"year","op":"lte","value":1985}]')}`);
    await waitFor(() => expect(rowTitles()).toEqual(["Mario"]));

    const chip = screen.getByRole("button", { name: "Remove filter Year: up to 1985" });
    chip.focus();
    fireEvent.click(chip);

    await waitFor(() => expect(rowTitles()).toEqual(["Zelda", "Zelda II", "Mario"]));
    await waitFor(() => expect(screen.getByRole("button", { name: "Filters" })).toHaveFocus());
  });

  it("a filter that matches nothing offers Clear filters, which hands focus to the toggle", async () => {
    renderAt(`${BASE}?filter=${encodeURIComponent('[{"field":"year","op":"gte","value":2000}]')}`);
    expect(await screen.findByText("No items match these filters")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Clear search" })).not.toBeInTheDocument();

    const clear = screen.getAllByRole("button", { name: "Clear filters" }).at(-1) as HTMLElement;
    clear.focus();
    fireEvent.click(clear);

    await waitFor(() => expect(rowTitles()).toEqual(["Zelda", "Zelda II", "Mario"]));
    await waitFor(() => expect(screen.getByRole("button", { name: "Filters" })).toHaveFocus());
  });

  it("drops a filter the collection's fields cannot take instead of failing to load", async () => {
    renderAt(`${BASE}?filter=${encodeURIComponent('[{"field":"title","op":"empty"}]')}`);
    await waitFor(() => expect(rowTitles()).toEqual(["Zelda", "Zelda II", "Mario"]));
    expect(vi.mocked(listItems)).toHaveBeenLastCalledWith(COLLECTION.id, {
      q: undefined,
      sort: undefined,
      filter: undefined,
    });
    expect(screen.queryByRole("list", { name: "Applied filters" })).not.toBeInTheDocument();
  });
});

describe("filters and what the page says (#41 review)", () => {
  it("does not announce the count of a filtered view the page opened on", async () => {
    renderAt(`${BASE}?filter=${encodeURIComponent('[{"field":"year","op":"gte","value":1986}]')}`);
    await waitFor(() => expect(rowTitles()).toEqual(["Zelda", "Zelda II"]));
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(announcer()).not.toHaveTextContent("match");
  });

  it("says the search or filters hide an added item, not the search alone", async () => {
    renderAt(`${BASE}?filter=${encodeURIComponent('[{"field":"year","op":"gte","value":1986}]')}`);
    await waitFor(() => expect(rowTitles()).toEqual(["Zelda", "Zelda II"]));
    const sonic = item("66666666-6666-4666-8666-666666666666", "Sonic", 1991);
    const old = { ...sonic, fields: { title: "Pong", year: 1972 } };
    vi.mocked(createItem).mockImplementation(async () => {
      stored = [...stored, old];
      return old;
    });
    const form = document.querySelector<HTMLElement>(".add-item");
    if (!form) throw new Error("no add form");
    fireEvent.change(within(form).getByRole("textbox", { name: /title/i }), { target: { value: "Pong" } });
    fireEvent.click(within(form).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(document.querySelector(".add-item-live")).toHaveTextContent(
        "Added “Pong”. It doesn’t match the current search or filters, so it isn’t shown.",
      ),
    );
  });
});
