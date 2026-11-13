import type { Collection } from "@mycollections/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ItemWithMedia } from "../../lib/api-client.js";
import { rootRoute } from "../__root.js";
import { authenticatedRoute } from "../_authenticated.js";
import { collectionDetailRoute } from "./$id.js";

/**
 * A collection's list and grid views (#38). The view belongs to the collection
 * — the owner's call — so switching it is a PATCH, shown at once and taken back
 * if the server refuses. The rows are the same elements in both views: a switch
 * restyles them and never remounts them, so an open editor keeps its draft.
 */

vi.mock("../../lib/api-client.js", () => ({
  getCollection: vi.fn(),
  listItems: vi.fn(),
  createItem: vi.fn(),
  updateItem: vi.fn(),
  deleteItem: vi.fn(),
  restoreItem: vi.fn(),
  getCollectionCounts: vi.fn(),
  updateCollection: vi.fn(),
  fetchMediaBlob: vi.fn(),
  getToken: vi.fn(() => "test-token"),
}));

import { fetchMediaBlob, getCollection, listItems, updateCollection } from "../../lib/api-client.js";

const testRouteTree = rootRoute.addChildren([authenticatedRoute.addChildren([collectionDetailRoute])]);

const COLLECTION: Collection = {
  id: "11111111-1111-1111-1111-111111111111",
  name: "Records",
  fields: [
    { id: "title", label: "Title", type: "text", required: true },
    { id: "artist", label: "Artist", type: "text", required: false },
    { id: "label", label: "Label", type: "text", required: false },
    { id: "year", label: "Year", type: "number", required: false },
    { id: "pressing", label: "Pressing", type: "text", required: false },
  ],
  isFiniteSet: false,
  targetCount: null,
  itemView: "list",
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T00:00:00.000Z",
  deletedAt: null,
};

const COVER = { id: "44444444-4444-4444-8444-444444444444", width: 640, height: 480 };

const BLUE: ItemWithMedia = {
  id: "22222222-2222-2222-2222-222222222222",
  collectionId: COLLECTION.id,
  status: "owned",
  fields: { title: "Kind of Blue", artist: "Miles Davis", label: "Columbia", year: 1959, pressing: "Six-eye" },
  createdAt: "2024-01-02T00:00:00.000Z",
  updatedAt: "2024-01-02T00:00:00.000Z",
  deletedAt: null,
  primaryMedia: COVER,
};

const TRAIN: ItemWithMedia = {
  ...BLUE,
  id: "33333333-3333-3333-3333-333333333333",
  status: "wanted",
  // No label: an empty value is skipped on a card, so the next field takes its place.
  fields: { title: "Blue Train", artist: "John Coltrane", year: 1957, pressing: "Mono" },
  primaryMedia: null,
};

function renderDetail(search = "") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const history = createMemoryHistory({ initialEntries: [`/collections/${COLLECTION.id}${search}`] });
  const router = createRouter({ routeTree: testRouteTree, history });
  render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { qc };
}

function viewSelect() {
  return screen.findByRole("combobox", { name: "View" });
}

function itemList(): HTMLElement {
  const list = document.querySelector<HTMLElement>("ul.item-list");
  if (!list) throw new Error("no item list");
  return list;
}

function card(name: string): HTMLElement {
  return screen.getByRole("link", { name }).closest("li") as HTMLElement;
}

/** The labelled values a row shows, in order — the name link aside. */
function shownFields(row: HTMLElement): string[] {
  return Array.from(row.querySelectorAll(".item-field")).map((field) => field.textContent ?? "");
}

beforeEach(() => {
  localStorage.setItem("api_token", "test-token");
  vi.resetAllMocks();
  vi.mocked(getCollection).mockResolvedValue(COLLECTION);
  vi.mocked(listItems).mockResolvedValue([BLUE, TRAIN]);
  vi.mocked(fetchMediaBlob).mockResolvedValue(new Blob(["webp"], { type: "image/webp" }));
  vi.stubGlobal(
    "URL",
    Object.assign(Object.create(URL), { createObjectURL: () => "blob:test/cover", revokeObjectURL: () => {} }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the View control (#38)", () => {
  it("is a select named View offering List and Grid, set to the collection's view", async () => {
    renderDetail();
    const select = await viewSelect();
    expect(select).toHaveValue("list");
    expect(
      within(select)
        .getAllByRole("option")
        .map((o) => [o.getAttribute("value"), o.textContent]),
    ).toEqual([
      ["list", "List"],
      ["grid", "Grid"],
    ]);
    await screen.findByRole("link", { name: "Kind of Blue" });
    expect(itemList()).not.toHaveClass("item-list-grid");
  });

  it("opens a grid collection in the grid", async () => {
    vi.mocked(getCollection).mockResolvedValue({ ...COLLECTION, itemView: "grid" });
    renderDetail();
    expect(await viewSelect()).toHaveValue("grid");
    await screen.findByRole("link", { name: "Kind of Blue" });
    expect(itemList()).toHaveClass("item-list", "item-list-grid");
  });

  it("switches to the grid at once, saves it to the collection, and leaves focus on the select", async () => {
    vi.mocked(updateCollection).mockReturnValue(new Promise(() => {}));
    renderDetail();
    const select = await viewSelect();
    await screen.findByRole("link", { name: "Kind of Blue" });
    select.focus();

    fireEvent.change(select, { target: { value: "grid" } });

    await waitFor(() => expect(itemList()).toHaveClass("item-list-grid"));
    expect(select).toHaveValue("grid");
    expect(updateCollection).toHaveBeenCalledWith(COLLECTION.id, { itemView: "grid" });
    expect(document.activeElement).toBe(select);
  });

  it("goes back to the list and says so when the server refuses the switch", async () => {
    vi.mocked(updateCollection).mockRejectedValue(new Error("offline"));
    renderDetail();
    const select = await viewSelect();
    await screen.findByRole("link", { name: "Kind of Blue" });

    fireEvent.change(select, { target: { value: "grid" } });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not change the view. It is as it was — check that the app's server is running, then try again.",
    );
    expect(select).toHaveValue("list");
    expect(itemList()).not.toHaveClass("item-list-grid");
  });

  it("clears that failure once a later switch lands", async () => {
    vi.mocked(updateCollection)
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ ...COLLECTION, itemView: "grid" });
    renderDetail();
    const select = await viewSelect();
    fireEvent.change(select, { target: { value: "grid" } });
    await screen.findByRole("alert");

    fireEvent.change(select, { target: { value: "grid" } });

    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(select).toHaveValue("grid");
  });
});

describe("the grid (#38)", () => {
  beforeEach(() => {
    vi.mocked(getCollection).mockResolvedValue({ ...COLLECTION, itemView: "grid" });
  });

  it("leads each card with its cover, or an empty frame for an item with no photo", async () => {
    renderDetail();
    await screen.findByRole("link", { name: "Kind of Blue" });
    const blue = card("Kind of Blue");
    await waitFor(() => expect(blue.querySelector("img.item-card-cover")).toHaveAttribute("src", "blob:test/cover"));
    expect(blue.querySelector("img.item-card-cover")).toHaveAttribute("alt", "");
    // The row thumbnail is the list's; a card has its cover instead.
    expect(blue.querySelector(".item-row-thumb")).toBeNull();

    const emptyCover = card("Blue Train").querySelector(".item-card-cover");
    expect(emptyCover).toHaveClass("item-card-cover-empty");
    expect(emptyCover).toHaveAttribute("aria-hidden", "true");
    expect(emptyCover?.tagName).not.toBe("IMG");
  });

  it("shows the name as the link and at most three filled-in fields, skipping empty ones", async () => {
    renderDetail();
    await screen.findByRole("link", { name: "Kind of Blue" });
    expect(shownFields(card("Kind of Blue"))).toEqual(["Artist: Miles Davis", "Label: Columbia", "Year: 1959"]);
    expect(shownFields(card("Blue Train"))).toEqual(["Artist: John Coltrane", "Year: 1957", "Pressing: Mono"]);
    expect(card("Kind of Blue").querySelector(".item-status")).toHaveTextContent("Owned");
  });

  it("puts the field the list is sorted by first, so the order on screen can be read", async () => {
    renderDetail("?sort=-field:pressing");
    await screen.findByRole("link", { name: "Kind of Blue" });
    expect(shownFields(card("Kind of Blue"))).toEqual(["Pressing: Six-eye", "Artist: Miles Davis", "Label: Columbia"]);
  });

  it("keeps every action, named for its item", async () => {
    renderDetail();
    await screen.findByRole("link", { name: "Kind of Blue" });
    const train = within(card("Blue Train"));
    expect(train.getByRole("button", { name: "Mark collected “Blue Train”" })).toBeInTheDocument();
    expect(train.getByRole("button", { name: "Edit “Blue Train”" })).toHaveAttribute("data-row-edit");
    expect(train.getByRole("button", { name: "Delete “Blue Train”" })).toBeInTheDocument();
  });

  it("waits for the items with placeholder cards, not rows", async () => {
    vi.mocked(listItems).mockReturnValue(new Promise(() => {}));
    renderDetail();
    expect(await screen.findByRole("status")).toHaveTextContent("Loading items…");
    expect(document.querySelectorAll(".item-list-grid .skeleton-card-cover")).toHaveLength(3);
  });

  it("shows every field again in the list", async () => {
    vi.mocked(getCollection).mockResolvedValue(COLLECTION);
    renderDetail();
    await screen.findByRole("link", { name: "Kind of Blue" });
    expect(shownFields(card("Kind of Blue"))).toEqual([
      "Title: Kind of Blue",
      "Artist: Miles Davis",
      "Label: Columbia",
      "Year: 1959",
      "Pressing: Six-eye",
    ]);
  });
});

describe("switching keeps the rows (#38)", () => {
  it("restyles the same row elements rather than remounting them", async () => {
    vi.mocked(updateCollection).mockResolvedValue({ ...COLLECTION, itemView: "grid" });
    renderDetail();
    await screen.findByRole("link", { name: "Kind of Blue" });
    const list = itemList();
    const row = card("Kind of Blue");

    fireEvent.change(await viewSelect(), { target: { value: "grid" } });

    await waitFor(() => expect(itemList()).toHaveClass("item-list-grid"));
    expect(itemList()).toBe(list);
    expect(card("Kind of Blue")).toBe(row);
  });

  it("keeps an open editor and its unsaved draft across the switch", async () => {
    vi.mocked(updateCollection).mockResolvedValue({ ...COLLECTION, itemView: "grid" });
    renderDetail();
    fireEvent.click(await screen.findByRole("button", { name: "Edit “Kind of Blue”" }));
    const editor = await screen.findByRole("form", { name: "Editing “Kind of Blue”" });
    const artist = within(editor).getByLabelText("Artist");
    fireEvent.change(artist, { target: { value: "Miles Davis Sextet" } });

    fireEvent.change(await viewSelect(), { target: { value: "grid" } });

    await waitFor(() => expect(itemList()).toHaveClass("item-list-grid"));
    expect(within(screen.getByRole("form", { name: "Editing “Kind of Blue”" })).getByLabelText("Artist")).toBe(artist);
    expect(artist).toHaveValue("Miles Davis Sextet");
    // A card's editor takes the whole row of the grid, so the form has room.
    expect(artist.closest("li")).toHaveClass("item-editing");
  });
});
