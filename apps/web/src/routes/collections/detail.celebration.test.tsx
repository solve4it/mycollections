import type { Collection, Item, ItemCounts, ItemStatus } from "@mycollections/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseSearch, stringifySearch } from "../../lib/search-params.js";
import { rootRoute } from "../__root.js";
import { authenticatedRoute } from "../_authenticated.js";
import { CELEBRATION_MS, collectionDetailRoute } from "./$id.js";

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
  createItem,
  deleteItem,
  getCollection,
  getCollectionCounts,
  listItems,
  restoreItem,
  setItemStatus,
  updateItem,
} from "../../lib/api-client.js";

/**
 * Completing a finite set (#42, slice 8: the Completion decision, R8). A user
 * action that takes owned from below the target to the target is celebrated
 * once, in one message, in a region of its own; nothing else is — not landing
 * on a complete set, not a target edit, not an undo, and never when the counts
 * before the action were not known.
 */

const COLLECTION: Collection = {
  id: "11111111-1111-1111-1111-111111111111",
  name: "Coin set",
  fields: [
    { id: "title", label: "Title", type: "text", required: true },
    { id: "year", label: "Year", type: "number", required: false },
  ],
  isFiniteSet: true,
  targetCount: 3,
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
const QUARTER = item("55555555-5555-4555-8555-555555555555", "Quarter", 1932, "owned");
const NICKEL = item("33333333-3333-4333-8333-333333333333", "Nickel", 1913, "wanted");
const DIME = item("44444444-4444-4444-8444-444444444444", "Dime", 1916, "ordered");
const HALF = item("66666666-6666-4666-8666-666666666666", "Half dollar", 1948, "owned");

/** The server, played by the mock. Two of three owned: one more completes the set. */
let stored: Item[];
let stamp = 3;
const nextStamp = () => `2024-01-${String(stamp++).padStart(2, "0")}T00:00:00.000Z`;

function countsOf(items: Item[]): ItemCounts {
  const of = (status: ItemStatus) => items.filter((it) => it.status === status).length;
  return { total: items.length, owned: of("owned"), wanted: of("wanted"), ordered: of("ordered") };
}

function acceptMarks() {
  vi.mocked(setItemStatus).mockImplementation(async (_collectionId, itemId, status) => {
    let marked: Item | undefined;
    stored = stored.map((it) => {
      if (it.id !== itemId) return it;
      marked = { ...it, status, updatedAt: nextStamp() };
      return marked;
    });
    if (!marked) throw new Error("no such item");
    return marked;
  });
}

function acceptSaves() {
  vi.mocked(updateItem).mockImplementation(async (_collectionId, itemId, input) => {
    let saved: Item | undefined;
    stored = stored.map((it) => {
      if (it.id !== itemId) return it;
      saved = { ...it, status: input.status ?? it.status, fields: input.fields, updatedAt: nextStamp() };
      return saved;
    });
    if (!saved) throw new Error("no such item");
    return saved;
  });
}

function renderAt(path: string, collection: Collection = COLLECTION, seed?: (qc: QueryClient) => void) {
  vi.mocked(getCollection).mockResolvedValue(collection);
  const history = createMemoryHistory({ initialEntries: [path] });
  const router = createRouter({
    routeTree: rootRoute.addChildren([authenticatedRoute.addChildren([collectionDetailRoute])]),
    history,
    parseSearch,
    stringifySearch,
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  seed?.(qc);
  const view = render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router, qc, view };
}

const BASE = `/collections/${COLLECTION.id}`;

function announcer(): HTMLElement {
  const region = document.querySelector<HTMLElement>('.visually-hidden[aria-live="polite"]');
  if (!region) throw new Error("no announcer");
  return region;
}

function celebration(): HTMLElement {
  const region = document.querySelector<HTMLElement>(".celebration-live");
  if (!region) throw new Error("no celebration region");
  return region;
}

function addLive(): HTMLElement {
  const region = document.querySelector<HTMLElement>(".add-item-live");
  if (!region) throw new Error("no add region");
  return region;
}

function progress(): HTMLElement | null {
  return document.querySelector<HTMLElement>(".collection-progress");
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

const markButton = (name: string) => screen.getByRole("button", { name: `Mark collected “${name}”` });

function addForm(): HTMLElement {
  const form = document.querySelector<HTMLElement>(".add-item");
  if (!form) throw new Error("no add form");
  return form;
}

/** Waits for the page and its header count, so the counts before any action are known. */
async function ready(count = "2 of 3 collected") {
  await waitFor(() => expect(rowTitles().length).toBeGreaterThan(0));
  await waitFor(() => expect(progress()).toHaveTextContent(count));
}

beforeEach(() => {
  localStorage.setItem("api_token", "test-token");
  vi.resetAllMocks();
  stamp = 3;
  stored = [PENNY, QUARTER, NICKEL, DIME];
  vi.mocked(listItems).mockImplementation(async () => [...stored]);
  vi.mocked(getCollectionCounts).mockImplementation(async () => countsOf(stored));
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("the celebration region (#42)", () => {
  it("is in the page from its first commit, empty, polite, with no role and no pointer", async () => {
    renderAt(BASE);
    await ready();
    const region = celebration();
    expect(region).toBeEmptyDOMElement();
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region).not.toHaveAttribute("role");
    expect(region).not.toHaveAttribute("aria-atomic");
    // Beside the undo toast's region, inside the same fixed strip, not inside it.
    expect(region.parentElement).toHaveClass("undo-toast-region");
    expect(region.parentElement?.querySelector(":scope > .undo-toast-live")).not.toBeNull();
    expect(region.closest(".undo-toast-live")).toBeNull();
  });

  it("says nothing on landing on a set that is already complete", async () => {
    stored = [PENNY, QUARTER, HALF, NICKEL];
    renderAt(BASE);
    await ready("3 of 3 collected");
    // Long enough for any effect keyed on the counts to have run.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(celebration()).toBeEmptyDOMElement();
    expect(progress()?.className).not.toContain("collection-progress-celebrating");
  });
});

describe("what completes a set (#42)", () => {
  it("Mark collected: one message, naming the item and the set, and the usual announcement skipped", async () => {
    acceptMarks();
    renderAt(BASE);
    await ready();
    const region = celebration();

    const mark = markButton("Nickel");
    mark.focus();
    fireEvent.click(mark);

    await waitFor(() => expect(celebration()).toHaveTextContent("Marked “Nickel” as collected. Coin set is complete!"));
    expect(celebration(), "the region is never rebuilt with its text inside").toBe(region);
    // Focus does exactly what it did before the celebration (#42, D10).
    await waitFor(() => expect(screen.getByRole("button", { name: "Edit “Nickel”" })).toHaveFocus());
    expect(progress()).toHaveTextContent("3 of 3 collected");
    expect(progress()).toHaveTextContent("Complete");
    expect(progress()).toHaveClass("collection-progress-celebrating");
    // One message: the announcer is not also told about the mark.
    expect(announcer()).not.toHaveTextContent("Marked");
  });

  it("Mark collected under Remaining: the message keeps the reason the row went, and focus the successor", async () => {
    acceptMarks();
    renderAt(`${BASE}?show=remaining`);
    await ready();
    await waitFor(() => expect(rowTitles()).toEqual(["Nickel", "Dime"]));

    const mark = markButton("Nickel");
    mark.focus();
    fireEvent.click(mark);

    await waitFor(() =>
      expect(celebration()).toHaveTextContent(
        "Marked “Nickel” as collected. It is no longer in this list. Coin set is complete!",
      ),
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "Edit “Dime”" })).toHaveFocus());
    expect(announcer()).not.toHaveTextContent("Marked");
  });

  it("a row Save that turns the item owned", async () => {
    acceptSaves();
    renderAt(BASE);
    await ready();

    fireEvent.click(screen.getByRole("button", { name: "Edit “Dime”" }));
    const editor = await screen.findByRole("form", { name: "Editing “Dime”" });
    fireEvent.change(within(editor).getByRole("combobox", { name: "Status" }), { target: { value: "owned" } });
    fireEvent.click(within(editor).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(celebration()).toHaveTextContent("Saved “Dime”. Coin set is complete!"));
    await waitFor(() => expect(screen.getByRole("button", { name: "Edit “Dime”" })).toHaveFocus());
    expect(announcer()).not.toHaveTextContent("Saved");
  });

  it("a row Save that takes the item out of the tab says why, once, in the celebration", async () => {
    acceptSaves();
    renderAt(`${BASE}?show=remaining`);
    await ready();
    await waitFor(() => expect(rowTitles()).toEqual(["Nickel", "Dime"]));

    fireEvent.click(screen.getByRole("button", { name: "Edit “Nickel”" }));
    const editor = await screen.findByRole("form", { name: "Editing “Nickel”" });
    fireEvent.change(within(editor).getByRole("combobox", { name: "Status" }), { target: { value: "owned" } });
    fireEvent.click(within(editor).getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(celebration()).toHaveTextContent(
        "Saved “Nickel”. It no longer matches the current search, filters or tab, so it isn’t shown. Coin set is complete!",
      ),
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "Edit “Dime”" })).toHaveFocus());
    expect(announcer()).not.toHaveTextContent("Saved");
  });

  it("Add item: the celebration replaces the add confirmation rather than joining it", async () => {
    vi.mocked(createItem).mockImplementation(async () => {
      stored = [...stored, HALF];
      return HALF;
    });
    renderAt(BASE);
    await ready();

    fireEvent.change(within(addForm()).getByRole("textbox", { name: "Title" }), { target: { value: "Half dollar" } });
    fireEvent.click(within(addForm()).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(celebration()).toHaveTextContent("Added “Half dollar”. Coin set is complete!"));
    expect(addLive()).toBeEmptyDOMElement();
    // The form still clears for the next item.
    await waitFor(() => expect(within(addForm()).getByRole("textbox", { name: "Title" })).toHaveValue(""));
  });

  it("a Save that changes nothing about status does not celebrate", async () => {
    acceptSaves();
    renderAt(BASE);
    await ready();

    fireEvent.click(screen.getByRole("button", { name: "Edit “Nickel”" }));
    const editor = await screen.findByRole("form", { name: "Editing “Nickel”" });
    fireEvent.change(within(editor).getByRole("textbox", { name: "Title" }), { target: { value: "Buffalo nickel" } });
    fireEvent.click(within(editor).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Edit “Buffalo nickel”" })).toHaveFocus());
    expect(celebration()).toBeEmptyDOMElement();
  });
});

describe("what does not celebrate (#42, R8)", () => {
  it.each([
    ["a rename saved (the review's probe)", "rename"],
    ["Mark collected", "mark"],
  ] as const)(
    "%s over counts left from an earlier visit: stale is not known, so no completion is claimed",
    async (_name, action) => {
      // The set was completed elsewhere — a Settings restore, an import, another
      // device — while the cache still holds the counts from the last visit.
      // Those are served at once (status success) while the mount refetch is in
      // flight, and must not be read as "it was incomplete before this change".
      stored = [PENNY, QUARTER, HALF, NICKEL];
      acceptSaves();
      acceptMarks();
      vi.mocked(getCollectionCounts)
        .mockImplementationOnce(() => new Promise<ItemCounts>(() => {}))
        .mockImplementation(async () => countsOf(stored));
      renderAt(BASE, COLLECTION, (qc) => {
        qc.setQueryData(["collections", COLLECTION.id, "items", "counts"], {
          total: 4,
          owned: 2,
          wanted: 1,
          ordered: 0,
        } satisfies ItemCounts);
      });
      await ready("2 of 3 collected");

      if (action === "rename") {
        fireEvent.click(screen.getByRole("button", { name: "Edit “Nickel”" }));
        const editor = await screen.findByRole("form", { name: "Editing “Nickel”" });
        fireEvent.change(within(editor).getByRole("textbox", { name: "Title" }), {
          target: { value: "Buffalo nickel" },
        });
        fireEvent.click(within(editor).getByRole("button", { name: "Save" }));
        await waitFor(() => expect(screen.getByRole("button", { name: "Edit “Buffalo nickel”" })).toHaveFocus());
        await waitFor(() => expect(progress()).toHaveTextContent("3 of 3 collected"));
      } else {
        fireEvent.click(markButton("Nickel"));
        await waitFor(() => expect(announcer()).toHaveTextContent("Marked “Nickel” as collected."));
        await waitFor(() => expect(progress()).toHaveTextContent("4 of 3 collected"));
      }
      expect(celebration()).toBeEmptyDOMElement();
    },
  );

  it("two changes in flight together: neither the rename nor the mark sent during its refetch claims the completion", async () => {
    // A rename adds no owned item, so it is never the change that completed
    // the set — even though the counts it reads afterwards (moved by the mark)
    // say complete. And the trade the freshness rule makes: counts mid-fetch
    // are not known, so the mark sent while the rename's refetch is in flight
    // is missed rather than risk a false claim.
    stored = [PENNY, NICKEL, DIME];
    renderAt(BASE, { ...COLLECTION, targetCount: 2 });
    await ready("1 of 2 collected");
    acceptMarks();
    let answer: () => void = () => {};
    vi.mocked(getCollectionCounts)
      .mockImplementationOnce(
        () =>
          new Promise<ItemCounts>((resolve) => {
            answer = () => resolve(countsOf(stored));
          }),
      )
      .mockImplementation(async () => countsOf(stored));
    acceptSaves();

    // A rename sets off a counts refetch that is held …
    fireEvent.click(screen.getByRole("button", { name: "Edit “Penny”" }));
    const editor = await screen.findByRole("form", { name: "Editing “Penny”" });
    fireEvent.change(within(editor).getByRole("textbox", { name: "Title" }), { target: { value: "Wheat penny" } });
    fireEvent.click(within(editor).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(getCollectionCounts).toHaveBeenCalledTimes(2));
    // … and the mark that completes the set is sent meanwhile.
    fireEvent.click(markButton("Nickel"));
    await waitFor(() => expect(setItemStatus).toHaveBeenCalledTimes(1));
    await act(async () => answer());

    await waitFor(() => expect(progress()).toHaveTextContent("2 of 2 collected"));
    await waitFor(() => expect(announcer()).toHaveTextContent("Marked “Nickel” as collected."));
    expect(celebration()).toBeEmptyDOMElement();
  });

  it("an action on a set that was already complete: the usual message instead", async () => {
    stored = [PENNY, QUARTER, HALF, NICKEL];
    acceptMarks();
    renderAt(BASE);
    await ready("3 of 3 collected");

    fireEvent.click(markButton("Nickel"));

    await waitFor(() => expect(announcer()).toHaveTextContent("Marked “Nickel” as collected."));
    expect(progress()).toHaveTextContent("4 of 3 collected");
    expect(celebration()).toBeEmptyDOMElement();
  });

  it("an action taken before the counts arrived: not knowing it was incomplete, it never claims a completion", async () => {
    acceptMarks();
    // The first counts request is slow: it answers only after the mark has
    // landed, so when the mark was sent the page could not know where the set
    // stood. (The mark's refetch joins that request rather than racing it.)
    let answer: () => void = () => {};
    vi.mocked(getCollectionCounts)
      .mockImplementationOnce(
        () =>
          new Promise<ItemCounts>((resolve) => {
            answer = () => resolve(countsOf(stored));
          }),
      )
      .mockImplementation(async () => countsOf(stored));
    renderAt(BASE);
    await waitFor(() => expect(rowTitles()).toContain("Nickel"));
    expect(progress()).toBeNull();

    fireEvent.click(markButton("Nickel"));
    await waitFor(() => expect(setItemStatus).toHaveBeenCalledTimes(1));
    await act(async () => answer());

    await waitFor(() => expect(announcer()).toHaveTextContent("Marked “Nickel” as collected."));
    await waitFor(() => expect(progress()).toHaveTextContent("3 of 3 collected"));
    expect(celebration()).toBeEmptyDOMElement();
  });

  it("an action taken after the counts failed", async () => {
    acceptMarks();
    vi.mocked(getCollectionCounts)
      .mockRejectedValueOnce(new Error("offline"))
      .mockImplementation(async () => countsOf(stored));
    renderAt(BASE);
    await waitFor(() => expect(rowTitles()).toContain("Nickel"));
    await waitFor(() => expect(getCollectionCounts).toHaveBeenCalledTimes(1));
    expect(progress()).toBeNull();

    fireEvent.click(markButton("Nickel"));

    await waitFor(() => expect(announcer()).toHaveTextContent("Marked “Nickel” as collected."));
    await waitFor(() => expect(progress()).toHaveTextContent("3 of 3 collected"));
    expect(celebration()).toBeEmptyDOMElement();
  });

  it("an action whose counts refetch fails: the bar still says 2 of 3, so no completion is claimed", async () => {
    acceptMarks();
    renderAt(BASE);
    await ready();
    vi.mocked(getCollectionCounts).mockRejectedValue(new Error("offline"));

    fireEvent.click(markButton("Nickel"));

    await waitFor(() => expect(announcer()).toHaveTextContent("Marked “Nickel” as collected."));
    expect(celebration()).toBeEmptyDOMElement();
  });

  it("an Undo that restores the item which completes the set: it restores silently", async () => {
    stored = [PENNY, QUARTER, HALF, NICKEL];
    vi.mocked(deleteItem).mockImplementation(async () => {
      stored = stored.filter((it) => it.id !== HALF.id);
    });
    vi.mocked(restoreItem).mockImplementation(async () => {
      stored = [...stored, HALF];
      return HALF;
    });
    renderAt(BASE);
    await ready("3 of 3 collected");

    fireEvent.click(screen.getByRole("button", { name: "Delete “Half dollar”" }));
    await waitFor(() => expect(progress()).toHaveTextContent("2 of 3 collected"));
    fireEvent.click(await screen.findByRole("button", { name: "Undo" }));

    await waitFor(() => expect(progress()).toHaveTextContent("3 of 3 collected"));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Undo" })).toBeNull());
    expect(celebration()).toBeEmptyDOMElement();
  });

  it("a target lowered to what is already owned (an edit made elsewhere) completes the set without a celebration", async () => {
    const { qc } = renderAt(BASE, { ...COLLECTION, targetCount: 4 });
    await ready("2 of 4 collected");

    vi.mocked(getCollection).mockResolvedValue({ ...COLLECTION, targetCount: 2 });
    await act(async () => {
      await qc.invalidateQueries({ queryKey: ["collections"] });
    });

    await waitFor(() => expect(progress()).toHaveTextContent("2 of 2 collected"));
    expect(celebration()).toBeEmptyDOMElement();
  });

  it("a collection that is not a finite set never celebrates, and never asks for counts", async () => {
    vi.mocked(createItem).mockImplementation(async () => {
      stored = [...stored, HALF];
      return HALF;
    });
    renderAt(BASE, { ...COLLECTION, isFiniteSet: false, targetCount: null });
    await waitFor(() => expect(rowTitles()).toContain("Nickel"));

    fireEvent.change(within(addForm()).getByRole("textbox", { name: "Title" }), { target: { value: "Half dollar" } });
    fireEvent.click(within(addForm()).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(addLive()).toHaveTextContent("Added “Half dollar”"));
    expect(celebration()).toBeEmptyDOMElement();
    expect(getCollectionCounts).not.toHaveBeenCalled();
  });
});

describe("once per completion (#42)", () => {
  it("two marks in flight together that both see the set go complete celebrate once", async () => {
    stored = [PENNY, NICKEL, DIME];
    renderAt(BASE, { ...COLLECTION, targetCount: 2 });
    await ready("1 of 2 collected");

    const finishes: Array<() => void> = [];
    vi.mocked(setItemStatus).mockImplementation(
      (_collectionId, itemId, status) =>
        new Promise<Item>((resolve) => {
          finishes.push(() => {
            let marked: Item | undefined;
            stored = stored.map((it) => {
              if (it.id !== itemId) return it;
              marked = { ...it, status, updatedAt: nextStamp() };
              return marked;
            });
            if (marked) resolve(marked);
          });
        }),
    );

    fireEvent.click(markButton("Nickel"));
    fireEvent.click(markButton("Dime"));
    await waitFor(() => expect(finishes).toHaveLength(2));
    // Both land before either list refetch has settled: each saw the set
    // incomplete before it started, and each sees it complete after.
    await act(async () => {
      for (const finish of finishes) finish();
    });

    await waitFor(() => expect(progress()).toHaveTextContent("3 of 2 collected"));
    await waitFor(() => expect(celebration()).toHaveTextContent("is complete!"));
    // Whichever finished second says its usual message; the celebration is said once.
    await waitFor(() => expect(announcer()).toHaveTextContent(/Marked “(Nickel|Dime)” as collected\./));
    expect(celebration().textContent?.match(/is complete!/g)).toHaveLength(1);
  });

  it("celebrates again after the set drops below its target and is completed once more", async () => {
    acceptMarks();
    acceptSaves();
    renderAt(BASE);
    await ready();

    fireEvent.click(markButton("Nickel"));
    await waitFor(() => expect(celebration()).toHaveTextContent("Marked “Nickel” as collected. Coin set is complete!"));

    // Back to wanted: below the target, so the celebration — no longer true — goes.
    fireEvent.click(screen.getByRole("button", { name: "Edit “Nickel”" }));
    const editor = await screen.findByRole("form", { name: "Editing “Nickel”" });
    fireEvent.change(within(editor).getByRole("combobox", { name: "Status" }), { target: { value: "wanted" } });
    fireEvent.click(within(editor).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(progress()).toHaveTextContent("2 of 3 collected"));
    await waitFor(() => expect(celebration()).toBeEmptyDOMElement());
    expect(progress()).not.toHaveClass("collection-progress-celebrating");

    // And completed again: a new completion is a new celebration.
    fireEvent.click(await waitFor(() => markButton("Nickel")));
    await waitFor(() => expect(celebration()).toHaveTextContent("Marked “Nickel” as collected. Coin set is complete!"));
    expect(row(NICKEL).querySelector(".item-row")?.className).toBe("item-row");
  });
});

describe("the celebration's window (#42)", () => {
  it("holds for CELEBRATION_MS, then empties the region in place and stops the badge", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    acceptMarks();
    renderAt(BASE);
    await ready();
    const region = celebration();

    fireEvent.click(markButton("Nickel"));
    await waitFor(() => expect(celebration()).toHaveTextContent("Coin set is complete!"));

    await act(async () => {
      vi.advanceTimersByTime(CELEBRATION_MS - 1000);
    });
    expect(celebration()).toHaveTextContent("Coin set is complete!");

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(celebration(), "the message must not outlive its window").toBeEmptyDOMElement();
    expect(celebration(), "and the region must stay: rebuilt, it would arrive with its text inside").toBe(region);
    expect(progress()).not.toHaveClass("collection-progress-celebrating");
    // The badge itself stays: the set is still complete.
    expect(progress()).toHaveTextContent("Complete");
  });

  it("clears its timer when the page unmounts", async () => {
    const setSpy = vi.spyOn(globalThis, "setTimeout");
    const clearSpy = vi.spyOn(globalThis, "clearTimeout");
    acceptMarks();
    const { view } = renderAt(BASE);
    await ready();

    fireEvent.click(markButton("Nickel"));
    await waitFor(() => expect(celebration()).toHaveTextContent("Coin set is complete!"));

    const index = setSpy.mock.calls.findIndex(([, delay]) => delay === CELEBRATION_MS);
    expect(index, "the celebration starts a timer of its own").toBeGreaterThanOrEqual(0);
    const timer = setSpy.mock.results[index]?.value;
    view.unmount();
    expect(clearSpy).toHaveBeenCalledWith(timer);
    setSpy.mockRestore();
    clearSpy.mockRestore();
  });
});
