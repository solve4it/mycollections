import { type NetworkMode, onlineManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createQueryClient } from "../../lib/query-client.js";
import { rootRoute } from "../__root.js";
import { collectionsRoute } from "./index.js";

vi.mock("../../lib/api-client.js", () => ({
  listCollections: vi.fn(),
  getToken: vi.fn(() => "test-token"),
}));

import { listCollections } from "../../lib/api-client.js";

const testRouteTree = rootRoute.addChildren([collectionsRoute]);

function makeQueryClient(networkMode?: NetworkMode) {
  return new QueryClient({ defaultOptions: { queries: { retry: false, networkMode } } });
}

function renderCollections(qc: QueryClient = makeQueryClient()) {
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

afterEach(() => {
  cleanup();
  onlineManager.setOnline(true);
});

const SAMPLE_COLLECTION = {
  id: "00000000-0000-0000-0000-000000000001",
  name: "Books",
  description: "My book collection",
  fields: [{ id: "f1", label: "Title", type: "text" as const, required: true }],
  isFiniteSet: false,
  itemCount: 3,
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

  it("shows the item count, not the field count", async () => {
    vi.mocked(listCollections).mockResolvedValue([SAMPLE_COLLECTION]);
    renderCollections();
    // SAMPLE_COLLECTION has 1 field but 3 items.
    expect(await screen.findByText("3 items")).toBeInTheDocument();
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

  it("uses the singular label for a single item", async () => {
    vi.mocked(listCollections).mockResolvedValue([{ ...SAMPLE_COLLECTION, itemCount: 1 }]);
    renderCollections();
    expect(await screen.findByText("1 item")).toBeInTheDocument();
  });

  it("shows 0 items for an empty collection", async () => {
    vi.mocked(listCollections).mockResolvedValue([{ ...SAMPLE_COLLECTION, itemCount: 0 }]);
    renderCollections();
    expect(await screen.findByText("0 items")).toBeInTheDocument();
  });

  it("stamps the card with the collection's catalog code", async () => {
    vi.mocked(listCollections).mockResolvedValue([SAMPLE_COLLECTION]);
    renderCollections();
    // C-DZ is what catalogCode() pins for this id. The code is derived from the
    // id, never from list position — the repository issues no ORDER BY, so a
    // sequence number would renumber itself on every create and delete.
    expect(await screen.findByText("C-DZ")).toBeInTheDocument();
  });

  it("gives the collection the cover its id generates", async () => {
    vi.mocked(listCollections).mockResolvedValue([SAMPLE_COLLECTION]);
    renderCollections();
    await screen.findByText("Books");

    const cover = document.querySelector("svg.collection-cover");
    expect(cover?.getAttribute("data-archetype")).toBe("coins");
    expect(cover?.getAttribute("aria-hidden")).toBe("true");
  });

  it("gives two collections two different covers", async () => {
    vi.mocked(listCollections).mockResolvedValue([
      SAMPLE_COLLECTION,
      { ...SAMPLE_COLLECTION, id: "00000000-0000-0000-0000-000000000002", name: "Movies" },
    ]);
    renderCollections();
    await screen.findByText("Movies");

    const archetypes = [...document.querySelectorAll("svg.collection-cover")].map((c) =>
      c.getAttribute("data-archetype"),
    );
    expect(archetypes).toEqual(["coins", "spines"]);
  });

  it("draws placeholder cards while the collections load, not a line of text (#225)", async () => {
    vi.mocked(listCollections).mockReturnValue(new Promise(() => {}));
    renderCollections();

    await waitFor(() => expect(document.querySelectorAll(".skeleton-card").length).toBeGreaterThan(0));
    // The wait is still announced — the skeleton is the picture, the clipped
    // label is the words. Losing the words is how a skeleton silences a screen
    // reader, and it is what the #228 guards below depend on.
    expect(screen.getByRole("status")).toHaveTextContent(/loading collections/i);
  });

  it("keeps the page heading and its action on screen while the grid loads (#225)", async () => {
    // The header is not waiting on anything. Replacing the whole page with a
    // skeleton would leave the route with no <h1> to navigate to, and would pop
    // the header in over the grid the moment data landed.
    vi.mocked(listCollections).mockReturnValue(new Promise(() => {}));
    renderCollections();

    expect(await screen.findByRole("heading", { level: 1, name: "Collections" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /create collection/i })).toBeInTheDocument();
  });

  it("gives the empty dashboard the open-drawer mark (#225)", async () => {
    vi.mocked(listCollections).mockResolvedValue([]);
    renderCollections();

    await screen.findByText(/no collections yet/i);
    const mark = document.querySelector("svg.empty-mark");
    expect(mark).not.toBeNull();
    expect(mark).toHaveAttribute("aria-hidden", "true");
    // The action that fills the cabinet stays part of the empty state.
    expect(screen.getByRole("link", { name: /create collection/i })).toBeInTheDocument();
  });

  it("shows an error state when the API fails", async () => {
    vi.mocked(listCollections).mockRejectedValue(new Error("Network error"));
    renderCollections();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Could not load collections");
    // Never tell the user their collections are gone just because a request failed.
    expect(screen.queryByText(/no collections yet/i)).not.toBeInTheDocument();
  });

  it("does not report the raw error message to the user", async () => {
    // Error messages can carry internals or user data, so the UI shows a
    // translated explanation instead (the reporter still records the original).
    vi.mocked(listCollections).mockRejectedValue(new Error("connect ECONNREFUSED 127.0.0.1:3001"));
    renderCollections();

    await screen.findByRole("alert");
    expect(screen.queryByText(/ECONNREFUSED/)).not.toBeInTheDocument();
  });

  it("keeps showing loaded collections when a later reload fails", async () => {
    vi.mocked(listCollections).mockResolvedValueOnce([SAMPLE_COLLECTION]);
    const { qc } = renderCollections();
    await screen.findByText("Books");

    // The server goes away after a successful load. The collections on screen
    // are still the truth about the user's data, so they must stay — with a
    // warning, not replaced by a full-page error.
    vi.mocked(listCollections).mockRejectedValue(new Error("API error 500"));
    await qc.refetchQueries({ queryKey: ["collections"] });

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Could not refresh"));
    expect(screen.getByText("Books")).toBeInTheDocument();
  });

  it("keeps showing the loading state while the query is paused, never the empty state", async () => {
    // Reproduces #228: React Query pauses a query it believes it cannot run, so
    // the query sits pending without fetching — isLoading is false, error is
    // null and data is undefined. The user owns a collection here, so the empty
    // state would be a lie about their data.
    onlineManager.setOnline(false);
    vi.mocked(listCollections).mockResolvedValue([SAMPLE_COLLECTION]);
    renderCollections(makeQueryClient("online"));

    expect(await screen.findByText(/loading collections/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText(/no collections yet/i)).not.toBeInTheDocument());
    expect(listCollections).not.toHaveBeenCalled();
  });

  it("loads collections through the app's own query client while the browser reports no internet", async () => {
    // The two halves of the #228 fix, together: the app's client keeps talking
    // to the local API, and the page shows the data rather than an empty state.
    onlineManager.setOnline(false);
    vi.mocked(listCollections).mockResolvedValue([SAMPLE_COLLECTION]);
    renderCollections(createQueryClient(() => {}));

    expect(await screen.findByText("Books")).toBeInTheDocument();
    expect(listCollections).toHaveBeenCalledTimes(1);
  });
});
