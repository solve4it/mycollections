import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rootRoute } from "../__root.js";
import { collectionDetailRoute } from "./$id.js";

vi.mock("../../lib/api-client.js", () => ({
  getCollection: vi.fn(),
  listItems: vi.fn(),
  createItem: vi.fn(),
  deleteItem: vi.fn(),
  getToken: vi.fn(() => "test-token"),
}));

import { createItem, deleteItem, getCollection, listItems } from "../../lib/api-client.js";

const testRouteTree = rootRoute.addChildren([collectionDetailRoute]);

const COLLECTION = {
  id: "11111111-1111-1111-1111-111111111111",
  name: "Games",
  fields: [
    { id: "title", label: "Title", type: "text", required: true },
    { id: "year", label: "Year", type: "number", required: false },
  ],
  isFiniteSet: false,
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T00:00:00.000Z",
  deletedAt: null,
};

const ITEM = {
  id: "22222222-2222-2222-2222-222222222222",
  collectionId: COLLECTION.id,
  status: "owned",
  fields: { title: "Zelda", year: 2017 },
  createdAt: "2024-01-02T00:00:00.000Z",
  updatedAt: "2024-01-02T00:00:00.000Z",
  deletedAt: null,
};

function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

function renderDetail() {
  const qc = makeQueryClient();
  const history = createMemoryHistory({ initialEntries: [`/collections/${COLLECTION.id}`] });
  const router = createRouter({ routeTree: testRouteTree, history });
  render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  localStorage.setItem("api_token", "test-token");
  vi.resetAllMocks();
  vi.mocked(getCollection).mockResolvedValue(COLLECTION);
  vi.mocked(listItems).mockResolvedValue([]);
  vi.mocked(createItem).mockResolvedValue(ITEM);
  vi.mocked(deleteItem).mockResolvedValue(undefined);
});

afterEach(cleanup);

describe("CollectionDetailPage", () => {
  it("shows the collection name", async () => {
    renderDetail();
    expect(await screen.findByRole("heading", { name: "Games" })).toBeInTheDocument();
  });

  it("shows an empty state when there are no items", async () => {
    renderDetail();
    expect(await screen.findByText(/no items yet/i)).toBeInTheDocument();
  });

  it("lists existing items with their field values", async () => {
    vi.mocked(listItems).mockResolvedValue([ITEM]);
    renderDetail();
    expect(await screen.findByText("Zelda")).toBeInTheDocument();
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

  it("deletes an item", async () => {
    vi.mocked(listItems).mockResolvedValue([ITEM]);
    renderDetail();
    await screen.findByText("Zelda");
    fireEvent.click(screen.getByRole("button", { name: /delete/i }));
    await waitFor(() => expect(deleteItem).toHaveBeenCalledWith(COLLECTION.id, ITEM.id));
  });
});
