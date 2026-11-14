import type { Collection } from "@mycollections/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rootRoute } from "../__root.js";
import { authenticatedRoute } from "../_authenticated.js";
import { collectionDetailRoute } from "./$id.js";

/**
 * Exporting one collection from its own page (#45): the same archive as a full
 * export, holding just this collection.
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
  exportCollection: vi.fn(),
  getToken: vi.fn(() => "test-token"),
}));

import { exportCollection, getCollection, listItems } from "../../lib/api-client.js";

const testRouteTree = rootRoute.addChildren([authenticatedRoute.addChildren([collectionDetailRoute])]);

const COLLECTION: Collection = {
  id: "11111111-1111-1111-1111-111111111111",
  name: 'Café: "best" / 2026',
  fields: [{ id: "title", label: "Title", type: "text", required: true }],
  isFiniteSet: false,
  targetCount: null,
  itemView: "list",
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T00:00:00.000Z",
  deletedAt: null,
};

function renderDetail() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const history = createMemoryHistory({ initialEntries: [`/collections/${COLLECTION.id}`] });
  const router = createRouter({ routeTree: testRouteTree, history });
  render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

let downloads: string[];

beforeEach(() => {
  localStorage.setItem("api_token", "test-token");
  vi.resetAllMocks();
  vi.mocked(getCollection).mockResolvedValue(COLLECTION);
  vi.mocked(listItems).mockResolvedValue([]);
  vi.mocked(exportCollection).mockResolvedValue(new Blob(["PK"], { type: "application/zip" }));
  downloads = [];
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    downloads.push(this.download);
  });
  vi.stubGlobal("URL", { ...URL, createObjectURL: vi.fn(() => "blob:x"), revokeObjectURL: vi.fn() });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("exporting a collection from its page (#45)", () => {
  it("downloads this collection's archive, named after it with nothing a file system refuses", async () => {
    renderDetail();
    fireEvent.click(await screen.findByRole("button", { name: "Export collection" }));
    await waitFor(() => expect(downloads).toHaveLength(1));
    expect(exportCollection).toHaveBeenCalledWith(COLLECTION.id);
    expect(downloads[0]).toMatch(/^mycollections-Café best 2026-\d{4}-\d{2}-\d{2}\.zip$/);
  });

  it("keeps the button focusable but refuses a second press while the export runs", async () => {
    let finish!: (blob: Blob) => void;
    vi.mocked(exportCollection).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    renderDetail();
    const button = await screen.findByRole("button", { name: "Export collection" });
    fireEvent.click(button);
    await waitFor(() => expect(button).toHaveAttribute("aria-disabled", "true"));
    expect(button).not.toBeDisabled();
    fireEvent.click(button);
    expect(exportCollection).toHaveBeenCalledTimes(1);
    finish(new Blob(["PK"]));
    await waitFor(() => expect(button).not.toHaveAttribute("aria-disabled"));
  });

  it("says so in an alert when the export fails", async () => {
    vi.mocked(exportCollection).mockRejectedValue(new Error("500"));
    renderDetail();
    fireEvent.click(await screen.findByRole("button", { name: "Export collection" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The export failed. Please try again.");
    expect(downloads).toEqual([]);
  });
});
