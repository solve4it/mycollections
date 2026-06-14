import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rootRoute } from "../__root.js";
import { collectionsRoute } from "./index.js";

vi.mock("../../lib/api-client.js", () => ({
  listCollections: vi.fn(),
  getToken: vi.fn(() => "test-token"),
}));

import { listCollections } from "../../lib/api-client.js";

const testRouteTree = rootRoute.addChildren([collectionsRoute]);

function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderCollections() {
  const qc = makeQueryClient();
  const history = createMemoryHistory({ initialEntries: ["/collections"] });
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
});

afterEach(cleanup);

const SAMPLE_COLLECTION = {
  id: "00000000-0000-0000-0000-000000000001",
  name: "Books",
  description: "My book collection",
  fields: [{ id: "f1", name: "Title", type: "text", required: true }],
  isFiniteSet: false,
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T00:00:00.000Z",
  deletedAt: null,
};

describe("CollectionsPage", () => {
  it("shows empty state when no collections exist", async () => {
    vi.mocked(listCollections).mockResolvedValue([]);
    renderCollections();
    expect(await screen.findByText(/no collections yet/i)).toBeInTheDocument();
  });

  it("shows a collection card when collections are returned", async () => {
    vi.mocked(listCollections).mockResolvedValue([SAMPLE_COLLECTION]);
    renderCollections();
    expect(await screen.findByText("Books")).toBeInTheDocument();
  });

  it("shows multiple collection cards", async () => {
    vi.mocked(listCollections).mockResolvedValue([
      SAMPLE_COLLECTION,
      { ...SAMPLE_COLLECTION, id: "00000000-0000-0000-0000-000000000002", name: "Movies" },
    ]);
    renderCollections();
    await screen.findByText("Books");
    expect(screen.getByText("Movies")).toBeInTheDocument();
  });

  it("shows an error state when the API fails", async () => {
    vi.mocked(listCollections).mockRejectedValue(new Error("Network error"));
    renderCollections();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});
