import type { Collection, Item } from "@mycollections/core";
import { type NetworkMode, onlineManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rootRoute } from "../__root.js";
import { authenticatedRoute } from "../_authenticated.js";
import { collectionDetailRoute } from "./$id.js";
import { editCollectionRoute } from "./edit.js";

vi.mock("../../lib/api-client.js", () => ({
  getCollection: vi.fn(),
  listItems: vi.fn(),
  createItem: vi.fn(),
  updateItem: vi.fn(),
  deleteItem: vi.fn(),
  restoreItem: vi.fn(),
  getCollectionCounts: vi.fn(),
  fetchMediaBlob: vi.fn(),
  getToken: vi.fn(() => "test-token"),
}));

import {
  createItem,
  deleteItem,
  fetchMediaBlob,
  getCollection,
  getCollectionCounts,
  listItems,
  restoreItem,
  updateItem,
} from "../../lib/api-client.js";

const testRouteTree = rootRoute.addChildren([
  authenticatedRoute.addChildren([collectionDetailRoute, editCollectionRoute]),
]);

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

const ITEM: Item = {
  id: "22222222-2222-2222-2222-222222222222",
  collectionId: COLLECTION.id,
  status: "owned",
  fields: { title: "Zelda", year: 2017 },
  createdAt: "2024-01-02T00:00:00.000Z",
  updatedAt: "2024-01-02T00:00:00.000Z",
  deletedAt: null,
};

const OTHER_ITEM: Item = {
  ...ITEM,
  id: "33333333-3333-3333-3333-333333333333",
  fields: { title: "Mario", year: 1985 },
};

function makeQueryClient(networkMode?: NetworkMode) {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, networkMode }, mutations: { retry: false } },
  });
}

function renderDetail(qc: QueryClient = makeQueryClient()) {
  const history = createMemoryHistory({ initialEntries: [`/collections/${COLLECTION.id}`] });
  const router = createRouter({ routeTree: testRouteTree, history });
  render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { qc };
}

beforeEach(() => {
  localStorage.setItem("api_token", "test-token");
  vi.resetAllMocks();
  vi.mocked(getCollection).mockResolvedValue(COLLECTION);
  vi.mocked(listItems).mockResolvedValue([]);
  vi.mocked(createItem).mockResolvedValue(ITEM);
  vi.mocked(updateItem).mockResolvedValue(ITEM);
  vi.mocked(deleteItem).mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  onlineManager.setOnline(true);
});

describe("CollectionDetailPage", () => {
  it("shows the collection name", async () => {
    renderDetail();
    expect(await screen.findByRole("heading", { name: "Games" })).toBeInTheDocument();
  });

  it("links to the collection's field editor", async () => {
    renderDetail();
    const link = await screen.findByRole("link", { name: /edit collection/i });
    expect(link).toHaveAttribute("href", `/collections/${COLLECTION.id}/edit`);
  });

  it("shows an empty state when there are no items", async () => {
    renderDetail();
    expect(await screen.findByText(/no items yet/i)).toBeInTheDocument();
  });

  it("lists existing items with each field label paired with its own value", async () => {
    vi.mocked(listItems).mockResolvedValue([ITEM]);
    renderDetail();
    await screen.findByText("Zelda");

    // Assert the label↔value pairing, not just that the values appear somewhere:
    // a swapped or mis-keyed (item.fields[field.id]) lookup must fail this.
    const titleField = screen.getByText("Title:").closest(".item-field");
    expect(titleField).toHaveTextContent("Title: Zelda");
    const yearField = screen.getByText("Year:").closest(".item-field");
    expect(yearField).toHaveTextContent("Year: 2017");

    // The status is rendered via its translated label ("Owned"), not the raw enum
    // value. Scope to the row's status badge so the add-item form's status
    // <option> with the same text doesn't satisfy the assertion.
    const statusBadge = titleField?.closest(".item-row")?.querySelector(".item-status");
    expect(statusBadge).toHaveTextContent("Owned");

    // The tag carries its status as a modifier class, which is what colors it
    // (#224). Before that rule existed the class was emitted and matched
    // nothing, so owned, wanted and ordered all rendered the same indigo.
    expect(statusBadge).toHaveClass("item-status-owned");
    // The dot repeats the label, so it is hidden rather than announced.
    const dot = statusBadge?.querySelector(".status-dot");
    expect(dot).toHaveAttribute("aria-hidden", "true");
  });

  it("links each row's name to the item's own page, where its photos are (#37)", async () => {
    vi.mocked(listItems).mockResolvedValue([ITEM, { ...OTHER_ITEM, fields: { title: "", year: null } }]);
    renderDetail();
    const named = await screen.findByRole("link", { name: "Zelda" });
    expect(named).toHaveAttribute("href", `/collections/${COLLECTION.id}/items/${ITEM.id}`);
    // Inside its field, in place of the bare value: the value is the link.
    expect(named.closest(".item-field")).toHaveTextContent("Title: Zelda");
    // An item named by nothing is still reachable, as "(untitled)".
    expect(screen.getByRole("link", { name: "(untitled)" })).toHaveAttribute(
      "href",
      `/collections/${COLLECTION.id}/items/${OTHER_ITEM.id}`,
    );
  });

  it("shows an item's cover on its row as a decorative picture, and nothing for an item without one (#37)", async () => {
    vi.mocked(listItems).mockResolvedValue([
      { ...ITEM, primaryMedia: { id: "44444444-4444-4444-8444-444444444444", width: 640, height: 480 } },
      { ...OTHER_ITEM, primaryMedia: null },
    ]);
    vi.mocked(fetchMediaBlob).mockResolvedValue(new Blob(["webp"], { type: "image/webp" }));
    vi.stubGlobal(
      "URL",
      Object.assign(Object.create(URL), { createObjectURL: () => "blob:test/cover", revokeObjectURL: () => {} }),
    );
    try {
      renderDetail();
      const zelda = (await screen.findByRole("link", { name: "Zelda" })).closest(".item-row") as HTMLElement;
      const mario = screen.getByRole("link", { name: "Mario" }).closest(".item-row") as HTMLElement;
      await waitFor(() => expect(zelda.querySelector("img.item-row-thumb")).toHaveAttribute("src", "blob:test/cover"));
      expect(zelda.querySelector("img.item-row-thumb")).toHaveAttribute("alt", "");
      expect(fetchMediaBlob).toHaveBeenCalledWith(
        COLLECTION.id,
        ITEM.id,
        "44444444-4444-4444-8444-444444444444",
        "thumb",
      );
      expect(mario.querySelector(".item-row-thumb")).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("renders an empty placeholder for a missing field value", async () => {
    vi.mocked(listItems).mockResolvedValue([{ ...ITEM, fields: { title: "Mario" } }]);
    renderDetail();
    await screen.findByText("Mario");
    // The year field has no value for this item, so its cell shows the placeholder.
    expect(screen.getByText("Year:").closest(".item-field")).toHaveTextContent("Year: —");
  });

  it("renders boolean values as a labelled icon, not a bare glyph (#221)", async () => {
    // A screen reader announced the old ✓/✗ glyphs by their unicode names, or
    // skipped them entirely. The icon carries the value, so it carries a label.
    vi.mocked(getCollection).mockResolvedValue({
      ...COLLECTION,
      fields: [
        { id: "title", label: "Title", type: "text", required: true },
        { id: "boxed", label: "Boxed", type: "boolean", required: false },
        { id: "sealed", label: "Sealed", type: "boolean", required: false },
      ],
    });
    vi.mocked(listItems).mockResolvedValue([{ ...ITEM, fields: { title: "Zelda", boxed: true, sealed: false } }]);
    renderDetail();
    await screen.findByText("Zelda");

    const boxed = screen.getByText("Boxed:").closest(".item-field");
    expect(boxed?.querySelector("svg")).toBeInTheDocument();
    expect(within(boxed as HTMLElement).getByRole("img")).toHaveAccessibleName("Yes");

    const sealed = screen.getByText("Sealed:").closest(".item-field");
    expect(within(sealed as HTMLElement).getByRole("img")).toHaveAccessibleName("No");
  });

  it("gives the back link an icon without changing its accessible name (#221)", async () => {
    renderDetail();
    const back = await screen.findByRole("link", { name: "All collections" });
    const icon = back.querySelector("svg");
    expect(icon).toHaveClass("icon");
    expect(icon).toHaveAttribute("aria-hidden", "true");
  });

  it("creates an item from the dynamic form", async () => {
    renderDetail();
    fireEvent.change(await screen.findByLabelText("Title"), { target: { value: "Mario" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(createItem).toHaveBeenCalledTimes(1));
    expect(createItem).toHaveBeenCalledWith(
      COLLECTION.id,
      expect.objectContaining({ status: "owned", fields: expect.objectContaining({ title: "Mario" }) }),
    );
  });

  it("reports a failed item load instead of claiming the collection is empty", async () => {
    // #228: the items query used to fall back to `[]`, so a failed load looked
    // exactly like a collection the user had never added anything to.
    vi.mocked(listItems).mockRejectedValue(new Error("API error 500"));
    renderDetail();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Could not load items");
    expect(screen.queryByText(/no items yet/i)).not.toBeInTheDocument();
  });

  /**
   * The trap in #349. This block is the same markup *shape* as the three
   * full-page load failures — a `<div role="alert">` holding two lines — but it
   * replaces the item list, not the screen, and the collection's own `<h1>` is
   * still on the page above it. Converting it to the shared `FailureSurface`
   * would put a second `<h1>` mid-page, and the assertion above would not
   * notice: it reads text content, which a converted region still carries.
   *
   * So the shape is what is asserted. `global.css` styles both shapes through
   * one `div[role="alert"] > p:last-of-type` selector, which is why the region
   * is two `<p>` rather than a heading and a paragraph.
   */
  it("keeps the items failure a region, not a second full-page screen", async () => {
    vi.mocked(listItems).mockRejectedValue(new Error("API error 500"));
    renderDetail();

    const alert = await screen.findByRole("alert");
    expect(within(alert).queryAllByRole("heading")).toEqual([]);
    expect([...alert.children].map((child) => child.tagName)).toEqual(["P", "P"]);
    // The collection's own heading is what still names the page.
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Games");
  });

  /**
   * The screen's own failure, which had no test at all until #347 — its only
   * coverage was an incidental `getByRole("alert")` in `Shell.navigation.test.tsx`,
   * which is there for the announcement rather than the words.
   *
   * The words are the point: this is one collection, and the plural pair in the
   * `collections` namespace is about the dashboard. Both are asserted, so a
   * screen that reached for the wrong one could not pass.
   */
  it("reports a failed collection load in the singular", async () => {
    vi.mocked(getCollection).mockRejectedValue(new Error("API error 500"));
    renderDetail();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Could not load this collection");
    expect(alert).toHaveTextContent("Your data is safe.");
    expect(alert, "the collection must not borrow the dashboard's plural copy").not.toHaveTextContent(
      "Could not load collections",
    );
  });

  it("does not claim there are no items while the item load is still in flight", async () => {
    vi.mocked(listItems).mockReturnValue(new Promise(() => {}));
    renderDetail();

    await screen.findByRole("heading", { name: "Games" });
    expect(screen.getByRole("status")).toHaveTextContent(/loading/i);
    expect(screen.queryByText(/no items yet/i)).not.toBeInTheDocument();
  });

  it("draws placeholder rows while the items load, not a line of text (#225)", async () => {
    vi.mocked(listItems).mockReturnValue(new Promise(() => {}));
    renderDetail();

    await screen.findByRole("heading", { name: "Games" });
    expect(document.querySelectorAll(".skeleton-row").length).toBeGreaterThan(0);
    expect(screen.getByRole("status")).toHaveTextContent(/loading items/i);
  });

  it("keeps the way back on screen while the collection loads (#225)", async () => {
    // A slow load must never be a screen with no way off it: the back link does
    // not depend on the collection, so it renders beside the skeleton.
    vi.mocked(getCollection).mockReturnValue(new Promise(() => {}));
    renderDetail();

    expect(await screen.findByRole("link", { name: "All collections" })).toBeInTheDocument();
    expect(document.querySelectorAll(".skeleton-row").length).toBeGreaterThan(0);
  });

  it("gives an empty item list the open-drawer mark (#225)", async () => {
    vi.mocked(listItems).mockResolvedValue([]);
    renderDetail();

    await screen.findByText(/no items yet/i);
    const mark = document.querySelector("svg.empty-mark");
    expect(mark).not.toBeNull();
    expect(mark).toHaveAttribute("aria-hidden", "true");
    // The add-item form is the action here, so the empty state adds no second
    // call to action of its own — and must not claim a heading level either.
    expect(screen.getAllByRole("heading").map((h) => h.textContent)).toEqual(["Games", "Items", "Add item"]);
  });

  it("keeps showing loaded items when a later reload fails", async () => {
    vi.mocked(listItems).mockResolvedValueOnce([ITEM]);
    const { qc } = renderDetail();
    await screen.findByText("Zelda");

    vi.mocked(listItems).mockRejectedValue(new Error("API error 500"));
    await qc.refetchQueries({ queryKey: ["collections", COLLECTION.id, "items"] });

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Could not refresh"));
    expect(screen.getByText("Zelda")).toBeInTheDocument();
  });

  it("shows loading rather than an error while the collection query is paused", async () => {
    // A paused query has never run: it is not an error, and the page must not
    // present it as one.
    onlineManager.setOnline(false);
    renderDetail(makeQueryClient("online"));

    expect(await screen.findByRole("status")).toHaveTextContent(/loading/i);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(getCollection).not.toHaveBeenCalled();
  });

  it("deletes an item", async () => {
    vi.mocked(listItems).mockResolvedValue([ITEM]);
    renderDetail();
    await screen.findByText("Zelda");
    fireEvent.click(screen.getByRole("button", { name: /delete/i }));
    await waitFor(() => expect(deleteItem).toHaveBeenCalledWith(COLLECTION.id, ITEM.id));
  });

  /**
   * The toast's live region (#308). Queried by class rather than by role: the
   * region carries `aria-live` and no `role="status"`, so that the skeletons'
   * status regions stay the only thing `getByRole("status")` finds. A bare
   * `[aria-live="polite"]` query would match the shell's announcer too — these
   * tests render the real root route, so both regions are in this document.
   */
  function liveRegion(): HTMLElement {
    const regions = document.querySelectorAll<HTMLElement>(".undo-toast-live");
    expect(regions, "the page must own exactly one toast live region").toHaveLength(1);
    const region = regions[0];
    if (!region) throw new Error("no toast live region");
    return region;
  }

  /** The visible toast itself, once a delete has put one in the live region. */
  async function findToast(): Promise<HTMLElement> {
    return await waitFor(() => {
      const toast = document.querySelector<HTMLElement>(".undo-toast");
      if (!toast) throw new Error("no toast on screen");
      return toast;
    });
  }

  // #33: a delete is soft, and the toast is the shortcut back. It has to survive
  // the row that spawned it disappearing from the list, which is why it is owned
  // by the page rather than by the <li>.
  describe("undo toast", () => {
    it("fills a live region that was already in the document, rather than inserting one with its message inside (#308)", async () => {
      vi.mocked(listItems).mockResolvedValueOnce([ITEM]).mockResolvedValue([]);
      renderDetail();
      await screen.findByText("Zelda");

      // The sequence is the whole point, so it is asserted as a sequence. A
      // region that appears already holding its text is announced by VoiceOver
      // but usually not by NVDA or JAWS — and a test that only inspected the
      // final DOM would pass against exactly that bug.
      const before = liveRegion();
      expect(before).toHaveAttribute("aria-live", "polite");
      // No role="status": an inner live region would own its own subtree's
      // mutations (nearest ancestor wins), so the host would never fire — and a
      // role here would make every page-level status query ambiguous with the
      // loading skeletons.
      expect(before).not.toHaveAttribute("role");
      expect(before, "the region must already be in the document, and empty").toBeEmptyDOMElement();

      fireEvent.click(screen.getByRole("button", { name: /delete/i }));

      await waitFor(() => expect(liveRegion()).toHaveTextContent("Deleted “Zelda”"));
      // Identity, not shape: a region torn down and rebuilt with the message in
      // it satisfies every "the text is there" assertion and announces nothing.
      expect(liveRegion(), "the message must land in the same node, not a replacement").toBe(before);
    });

    it("keeps the live region in the document, and empty, once the toast is dismissed (#308)", async () => {
      vi.mocked(listItems).mockResolvedValueOnce([ITEM]).mockResolvedValue([]);
      renderDetail();
      await screen.findByText("Zelda");
      const before = liveRegion();

      fireEvent.click(screen.getByRole("button", { name: /delete/i }));
      await waitFor(() => expect(liveRegion()).toHaveTextContent("Deleted “Zelda”"));

      fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

      // The half-fix this catches: a region that is conditionally rendered again
      // once nothing is in it is a region that gets re-inserted — with its text
      // already inside — on the next delete.
      await waitFor(() => expect(liveRegion()).toBeEmptyDOMElement());
      expect(liveRegion()).toBe(before);
    });

    it("offers undo naming the deleted item, after the row is gone", async () => {
      vi.mocked(listItems).mockResolvedValueOnce([ITEM]).mockResolvedValue([]);
      renderDetail();
      await screen.findByText("Zelda");

      fireEvent.click(screen.getByRole("button", { name: /delete/i }));

      const toast = await findToast();
      expect(toast).toHaveTextContent(/deleted/i);
      expect(toast).toHaveTextContent("Zelda");
      await waitFor(() => expect(screen.queryByText("Zelda")).not.toBeInTheDocument());
      expect(within(toast).getByRole("button", { name: "Undo" })).toBeInTheDocument();
    });

    it("restores the item when undo is pressed, and takes the toast away", async () => {
      vi.mocked(listItems).mockResolvedValueOnce([ITEM]).mockResolvedValueOnce([]).mockResolvedValue([ITEM]);
      vi.mocked(restoreItem).mockResolvedValue(ITEM);
      renderDetail();
      await screen.findByText("Zelda");
      fireEvent.click(screen.getByRole("button", { name: /delete/i }));

      fireEvent.click(within(await findToast()).getByRole("button", { name: "Undo" }));

      await waitFor(() => expect(restoreItem).toHaveBeenCalledWith(COLLECTION.id, ITEM.id));
      // The toast goes; the region it spoke through stays, empty, for the next one.
      await waitFor(() => expect(document.querySelector(".undo-toast")).toBeNull());
      expect(liveRegion()).toBeEmptyDOMElement();
      expect(await screen.findByText("Zelda")).toBeInTheDocument();
    });

    it("names the newest deletion when a second item is deleted", async () => {
      // The list is held still (both rows stay mounted) so this tests only what
      // it claims: a second toast replaces the first rather than stacking.
      vi.mocked(listItems).mockResolvedValue([ITEM, OTHER_ITEM]);
      renderDetail();
      await screen.findByText("Zelda");

      const deleteButtons = () => screen.getAllByRole("button", { name: /delete/i });
      fireEvent.click(deleteButtons()[0] as HTMLElement);
      expect(await findToast()).toHaveTextContent("Zelda");

      fireEvent.click(deleteButtons()[1] as HTMLElement);

      // Into the same region, which is why it announces at all the second time:
      // the text changes inside a region that never left the document.
      await waitFor(() => expect(liveRegion()).toHaveTextContent("Mario"));
      expect(liveRegion()).not.toHaveTextContent("Zelda");
      expect(document.querySelectorAll(".undo-toast")).toHaveLength(1);
    });

    it("says so and keeps the toast when the undo itself fails", async () => {
      vi.mocked(listItems).mockResolvedValueOnce([ITEM]).mockResolvedValue([]);
      vi.mocked(restoreItem).mockRejectedValue(new Error("API error 500"));
      renderDetail();
      await screen.findByText("Zelda");
      fireEvent.click(screen.getByRole("button", { name: /delete/i }));

      fireEvent.click(within(await findToast()).getByRole("button", { name: "Undo" }));

      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent("Could not restore this item");
      // The failure is its own assertive announcement, so it sits beside the
      // live region rather than inside it: a live region nested in a live region
      // owns its own subtree, and the polite one would never speak for it.
      expect(liveRegion().contains(alert)).toBe(false);
      expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument();
    });

    it("shows no toast when the delete failed — there is nothing to undo", async () => {
      vi.mocked(listItems).mockResolvedValue([ITEM]);
      vi.mocked(deleteItem).mockRejectedValue(new Error("API error 500"));
      renderDetail();
      await screen.findByText("Zelda");

      fireEvent.click(screen.getByRole("button", { name: /delete/i }));

      await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Could not delete this item"));
      expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
    });
  });

  // #237: `networkMode: "always"` (#228) turned these three mutations from a
  // visible hang into a silent no-op. Each needs its own error surface, and each
  // message has to name the action that failed — "something went wrong" leaves
  // the user guessing which of the three attempts was lost.
  describe("mutation failures (#237)", () => {
    it("reports a failed add instead of silently discarding the form", async () => {
      vi.mocked(createItem).mockRejectedValue(new Error("API error 500"));
      renderDetail();
      fireEvent.change(await screen.findByLabelText("Title"), { target: { value: "Mario" } });
      fireEvent.click(screen.getByRole("button", { name: /save/i }));

      await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Could not add this item"));
      // The empty state must not be the only thing on screen after a failed add.
      expect(screen.getByRole("alert")).toBeVisible();
    });

    it("reports a failed save and leaves the editor open with the entered value", async () => {
      vi.mocked(listItems).mockResolvedValue([ITEM]);
      vi.mocked(updateItem).mockRejectedValue(new Error("API error 500"));
      renderDetail();
      await screen.findByText("Zelda");
      fireEvent.click(screen.getByRole("button", { name: /edit/i }));

      const row = screen.getAllByRole("listitem")[0] as HTMLElement;
      fireEvent.change(within(row).getByLabelText("Title"), { target: { value: "Ocarina" } });
      fireEvent.click(within(row).getByRole("button", { name: "Save" }));

      await waitFor(() =>
        expect(within(row).getByRole("alert")).toHaveTextContent("Could not save your changes to this item"),
      );
      // The editor stays open holding the typed value — closing it would throw
      // the edit away, which is exactly the silent loss this issue is about.
      expect(within(row).getByLabelText("Title")).toHaveValue("Ocarina");
      expect(within(row).getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    });

    it("reports a failed delete instead of leaving the row unexplained", async () => {
      vi.mocked(listItems).mockResolvedValue([ITEM]);
      vi.mocked(deleteItem).mockRejectedValue(new Error("API error 500"));
      renderDetail();
      await screen.findByText("Zelda");
      fireEvent.click(screen.getByRole("button", { name: /delete/i }));

      const row = screen.getAllByRole("listitem")[0] as HTMLElement;
      await waitFor(() => expect(within(row).getByRole("alert")).toHaveTextContent("Could not delete this item"));
      expect(within(row).getByText("Zelda")).toBeInTheDocument();
    });

    it("attaches a delete error to the row that failed, not to its siblings", async () => {
      vi.mocked(listItems).mockResolvedValue([ITEM, OTHER_ITEM]);
      vi.mocked(deleteItem).mockImplementation((_collectionId: string, itemId: string) =>
        itemId === ITEM.id ? Promise.reject(new Error("API error 500")) : Promise.resolve(),
      );
      renderDetail();
      await screen.findByText("Zelda");

      const [zeldaRow, marioRow] = screen.getAllByRole("listitem") as HTMLElement[];
      fireEvent.click(within(zeldaRow as HTMLElement).getByRole("button", { name: /delete/i }));

      await waitFor(() =>
        expect(within(zeldaRow as HTMLElement).getByRole("alert")).toHaveTextContent("Could not delete this item"),
      );
      expect(within(marioRow as HTMLElement).queryByRole("alert")).not.toBeInTheDocument();
    });

    it("does not show a stale save error when the editor is reopened", async () => {
      // Cancelling leaves the mutation in its error state, so without an
      // explicit reset the next Edit click greets the user with a failure
      // message for a save they have not attempted yet.
      vi.mocked(listItems).mockResolvedValue([ITEM]);
      vi.mocked(updateItem).mockRejectedValue(new Error("API error 500"));
      renderDetail();
      await screen.findByText("Zelda");

      fireEvent.click(screen.getByRole("button", { name: /edit/i }));
      let row = screen.getAllByRole("listitem")[0] as HTMLElement;
      fireEvent.click(within(row).getByRole("button", { name: "Save" }));
      await waitFor(() => expect(within(row).getByRole("alert")).toHaveTextContent("Could not save your changes"));

      fireEvent.click(within(row).getByRole("button", { name: "Cancel" }));
      fireEvent.click(screen.getByRole("button", { name: /edit/i }));
      row = screen.getAllByRole("listitem")[0] as HTMLElement;
      expect(within(row).queryByRole("alert")).not.toBeInTheDocument();
    });

    it("clears the add error once a later attempt succeeds", async () => {
      vi.mocked(createItem).mockRejectedValueOnce(new Error("API error 500"));
      renderDetail();
      fireEvent.change(await screen.findByLabelText("Title"), { target: { value: "Mario" } });
      fireEvent.click(screen.getByRole("button", { name: /save/i }));
      await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Could not add this item"));

      fireEvent.click(screen.getByRole("button", { name: /save/i }));
      await waitFor(() => expect(createItem).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    });
  });

  // #369: with a row's editor open the screen holds two item forms built from
  // the same fields. They used to share DOM ids, so both sets of labels pointed
  // at the editor — its controls were named twice, and the add form's not at all.
  describe("two item forms on one screen (#369)", () => {
    it("names each form's controls once, after its own labels", async () => {
      vi.mocked(listItems).mockResolvedValue([ITEM]);
      renderDetail();
      await screen.findByText("Zelda");
      fireEvent.click(screen.getByRole("button", { name: /edit/i }));

      const row = screen.getAllByRole("listitem")[0] as HTMLElement;
      const addSection = document.querySelector(".add-item") as HTMLElement;
      expect(within(row).getByRole("textbox", { name: "Title" })).toHaveValue("Zelda");
      expect(within(row).getByRole("spinbutton", { name: "Year" })).toHaveValue(2017);
      expect(within(row).getByRole("combobox", { name: "Status" })).toHaveValue("owned");
      expect(within(addSection).getByRole("textbox", { name: "Title" })).toHaveValue("");
      expect(within(addSection).getByRole("spinbutton", { name: "Year" })).toHaveValue(null);
      expect(within(addSection).getByRole("combobox", { name: "Status" })).toHaveValue("owned");
    });

    it("adds what was typed into the add form while an editor is open", async () => {
      vi.mocked(listItems).mockResolvedValue([ITEM]);
      renderDetail();
      await screen.findByText("Zelda");
      fireEvent.click(screen.getByRole("button", { name: /edit/i }));

      const addSection = document.querySelector(".add-item") as HTMLElement;
      fireEvent.change(within(addSection).getByLabelText("Title"), { target: { value: "Mario" } });
      fireEvent.click(within(addSection).getByRole("button", { name: "Save" }));

      await waitFor(() =>
        expect(createItem).toHaveBeenCalledWith(COLLECTION.id, {
          status: "owned",
          fields: { title: "Mario", year: null },
        }),
      );
      const row = screen.getAllByRole("listitem")[0] as HTMLElement;
      expect(within(row).getByRole("textbox", { name: "Title" })).toHaveValue("Zelda");
    });
  });

  // #42: the header measures a finite set with a target against its live
  // counts; a finite set without one is told how to get a bar, in a plain hint.
  describe("a finite set's progress in the header (#42)", () => {
    const FINITE: Collection = { ...COLLECTION, isFiniteSet: true, targetCount: 5 };

    function progress(): HTMLElement | null {
      return document.querySelector<HTMLElement>(".collection-detail p.collection-progress");
    }

    it("shows owned against the target from the collection's counts, under the title", async () => {
      vi.mocked(getCollection).mockResolvedValue(FINITE);
      vi.mocked(getCollectionCounts).mockResolvedValue({ total: 4, owned: 3, wanted: 1, ordered: 0 });
      renderDetail();

      await waitFor(() => expect(progress()).toHaveTextContent(/^3 of 5 collected$/));
      expect(getCollectionCounts).toHaveBeenCalledWith(COLLECTION.id);
      // Directly after the title row, before anything about the items.
      expect(document.querySelector(".collection-detail-header")?.nextElementSibling).toBe(progress());
      expect(screen.queryByText("Complete")).not.toBeInTheDocument();
    });

    it("says Complete once owned reaches the target", async () => {
      vi.mocked(getCollection).mockResolvedValue(FINITE);
      vi.mocked(getCollectionCounts).mockResolvedValue({ total: 7, owned: 6, wanted: 1, ordered: 0 });
      renderDetail();

      await waitFor(() => expect(progress()).toHaveTextContent(/^6 of 5 collected\s*Complete$/));
    });

    it("follows an item change, since the counts ride under the items prefix", async () => {
      vi.mocked(getCollection).mockResolvedValue(FINITE);
      vi.mocked(listItems).mockResolvedValueOnce([ITEM]).mockResolvedValue([]);
      vi.mocked(getCollectionCounts)
        .mockResolvedValueOnce({ total: 1, owned: 1, wanted: 0, ordered: 0 })
        .mockResolvedValue({ total: 0, owned: 0, wanted: 0, ordered: 0 });
      renderDetail();
      await waitFor(() => expect(progress()).toHaveTextContent(/^1 of 5 collected$/));

      fireEvent.click(await screen.findByRole("button", { name: "Delete “Zelda”" }));

      await waitFor(() => expect(progress()).toHaveTextContent(/^0 of 5 collected$/));
    });

    it("shows no bar, never a zero, while the counts load or when they fail", async () => {
      vi.mocked(getCollection).mockResolvedValue(FINITE);
      let fail: (error: Error) => void = () => {};
      vi.mocked(getCollectionCounts).mockReturnValue(
        new Promise((_resolve, reject) => {
          fail = reject;
        }),
      );
      renderDetail();
      await screen.findByRole("heading", { level: 1, name: "Games" });
      await waitFor(() => expect(getCollectionCounts).toHaveBeenCalled());
      expect(progress()).toBeNull();

      fail(new Error("API error 500"));

      await screen.findByText(/no items yet/i);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(progress()).toBeNull();
      expect(screen.queryByText(/of 5 collected/)).not.toBeInTheDocument();
      // A missing bar is not a failure worth an alert over the page's real content.
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("asks a finite set with no target for one in a plain hint, and fetches no counts", async () => {
      vi.mocked(getCollection).mockResolvedValue({ ...FINITE, targetCount: null });
      renderDetail();
      await screen.findByRole("heading", { level: 1, name: "Games" });

      const hint = screen.getByText("Add how many items the set has in Edit collection to see your progress.");
      expect(hint.tagName).toBe("P");
      expect(hint).toHaveClass("form-hint");
      // Decided once, with the collection: not a live region (DEVELOPMENT.md).
      expect(hint).not.toHaveAttribute("role");
      expect(hint).not.toHaveAttribute("aria-live");
      expect(hint.closest("[aria-live]")).toBeNull();
      expect(progress()).toBeNull();
      expect(getCollectionCounts).not.toHaveBeenCalled();
    });

    it("shows neither bar nor hint on a collection that is not a finite set", async () => {
      renderDetail();
      await screen.findByRole("heading", { level: 1, name: "Games" });
      await screen.findByText(/no items yet/i);

      expect(progress()).toBeNull();
      expect(screen.queryByText(/see your progress/)).not.toBeInTheDocument();
      expect(getCollectionCounts).not.toHaveBeenCalled();
    });

    // R1: the counts query is a second refetch under the items prefix, which
    // gives React time to commit the list fetched again (unmounting the row) before
    // the mutation settles. A mutate-level callback on the row's own observer is
    // dropped once that observer is gone.
    it("still offers Undo after a delete on a finite set with a target", async () => {
      vi.mocked(getCollection).mockResolvedValue(FINITE);
      vi.mocked(getCollectionCounts).mockResolvedValue({ total: 1, owned: 1, wanted: 0, ordered: 0 });
      vi.mocked(listItems).mockResolvedValueOnce([ITEM]).mockResolvedValue([]);
      renderDetail();
      fireEvent.click(await screen.findByRole("button", { name: "Delete “Zelda”" }));

      await waitFor(() => expect(screen.queryByText("Zelda")).not.toBeInTheDocument());
      const toast = await findToast();
      expect(toast).toHaveTextContent("Deleted “Zelda”");
      expect(within(toast).getByRole("button", { name: "Undo" })).toBeInTheDocument();
    });
  });
});
