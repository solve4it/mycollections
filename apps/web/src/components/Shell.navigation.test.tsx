import type { Collection } from "@mycollections/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { routeTree } from "../routeTree.js";

/**
 * What the shell does when the route changes (#24): names the page, says so out
 * loud, and puts focus somewhere deliberate.
 *
 * Rendered against the real `routeTree` rather than a stub, because part of what
 * is under test is that *every* route carries a title — a fixture tree would
 * still pass with a route that forgot one.
 */

const COLLECTION: Collection = {
  id: "11111111-1111-1111-1111-111111111111",
  name: "Games",
  fields: [{ id: "title", label: "Title", type: "text", required: true }],
  isFiniteSet: false,
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T00:00:00.000Z",
  deletedAt: null,
};

/**
 * Every export the six screens reach for. Listed rather than partially mocked:
 * a missing one does not fail as a missing mock, it renders the router's error
 * boundary in place of the whole shell — which is a *passing* shell test away
 * from the title assertions, and was exactly how this file first went green.
 */
vi.mock("../lib/api-client.js", () => ({
  getToken: vi.fn(() => localStorage.getItem("api_token")),
  setToken: vi.fn(),
  clearToken: vi.fn(),
  isTokenSessionOnly: vi.fn(() => false),
  listCollections: vi.fn(async () => []),
  createCollection: vi.fn(),
  updateCollection: vi.fn(),
  getCollection: vi.fn(async () => COLLECTION),
  listItems: vi.fn(async () => []),
  createItem: vi.fn(),
  updateItem: vi.fn(),
  deleteItem: vi.fn(),
  restoreItem: vi.fn(),
  listTrash: vi.fn(async () => ({ collections: [], items: [] })),
  restoreCollection: vi.fn(),
  purgeItem: vi.fn(),
  purgeCollection: vi.fn(),
  emptyTrash: vi.fn(),
  exportData: vi.fn(),
  importData: vi.fn(),
}));

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [path] }) });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

beforeEach(() => {
  localStorage.setItem("api_token", "test-token");
  document.title = "MyCollections";
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("the document title", () => {
  /**
   * WCAG 2.4.2 treats every SPA view as a page, and index.html carries one
   * static <title> for all seven of them. Asserted as exact strings rather than
   * "contains the app name": the whole point is that the routes are told apart.
   */
  it.each([
    ["/collections", "Collections · MyCollections"],
    ["/collections/new", "New collection · MyCollections"],
    [`/collections/${COLLECTION.id}`, "Collection · MyCollections"],
    [`/collections/${COLLECTION.id}/edit`, "Edit collection · MyCollections"],
    ["/settings", "Settings · MyCollections"],
  ])("names %s in the title", async (path, expected) => {
    renderAt(path);
    // The shell has to be on screen for its title to mean anything: a route that
    // threw renders the router's error component instead, with no shell at all.
    expect(await screen.findByRole("main")).toBeInTheDocument();
    await waitFor(() => expect(document.title).toBe(expected));
  });

  it("names the setup screen, which is reached by redirect rather than by link", async () => {
    localStorage.clear();
    renderAt("/collections");
    // The token guard sends this to /setup before anything renders.
    expect(await screen.findByRole("heading", { level: 1, name: /connect/i })).toBeInTheDocument();
    await waitFor(() => expect(document.title).toBe("Connect · MyCollections"));
  });
});

/** The one live region the shell owns. Exactly one, or the announcement is ambiguous. */
function announcer(): HTMLElement {
  const regions = document.querySelectorAll<HTMLElement>('[aria-live="polite"]');
  expect(regions, "the shell must own exactly one polite live region").toHaveLength(1);
  const region = regions[0];
  if (!region) throw new Error("no live region");
  return region;
}

describe("announcing route changes", () => {
  /**
   * A screen reader is told nothing when a client-side navigation swaps the
   * content: there is no page load to announce. A live region that is already
   * in the document and *then* receives text is the announcement — a region
   * inserted with its text already inside is announced by VoiceOver but usually
   * not by NVDA or JAWS, which is the bug this exists to avoid.
   */
  it("mounts the live region empty, so the first page load is not announced", async () => {
    renderAt("/settings");
    expect(await screen.findByRole("main")).toBeInTheDocument();
    expect(announcer()).toBeEmptyDOMElement();
  });

  it.each([
    ["/", "the index route redirects to /collections"],
    ["/collections", "the token guard redirects to /setup"],
  ])("stays empty when %s loads through a redirect", async (path, _why) => {
    if (path === "/collections") localStorage.clear();
    renderAt(path);
    expect(await screen.findByRole("main")).toBeInTheDocument();
    // A redirect that committed its intermediate location would announce on
    // first load — the one thing an announcer must never do.
    expect(announcer()).toBeEmptyDOMElement();
  });

  it("announces the page it navigated to, by name", async () => {
    const router = renderAt("/collections");
    expect(await screen.findByRole("main")).toBeInTheDocument();

    await router.navigate({ to: "/settings" });

    // The same words as the document title: it is the string every screen
    // reader user is already trained to hear on a page change.
    //
    // The exact string is what makes this test worth having. Announcing on a
    // `location.pathname` change reads as obviously correct and is wrong —
    // pathname lands a render before the matches resolve, so the region gets
    // filled with the title of the page being *left*. That version passes any
    // "the region is not empty" assertion.
    await waitFor(() => expect(announcer()).toHaveTextContent("Settings · MyCollections"));
  });

  it("keeps announcing as the user moves on", async () => {
    const router = renderAt("/collections");
    expect(await screen.findByRole("main")).toBeInTheDocument();

    await router.navigate({ to: "/settings" });
    await waitFor(() => expect(announcer()).toHaveTextContent("Settings · MyCollections"));
    await router.navigate({ to: "/collections/new" });
    await waitFor(() => expect(announcer()).toHaveTextContent("New collection · MyCollections"));
  });

  it("hides the region from view without hiding it from assistive tech", async () => {
    renderAt("/settings");
    expect(await screen.findByRole("main")).toBeInTheDocument();
    // .visually-hidden clips the box rather than using display:none, which would
    // take the text out of the accessibility tree along with the layout.
    expect(announcer()).toHaveClass("visually-hidden");
    expect(announcer()).toHaveAttribute("aria-atomic", "true");
  });
});

describe("route titles as data", () => {
  it("gives every route that renders a screen a title key", () => {
    // A route added without one would silently keep whatever title the previous
    // screen left behind, which is worse than the static title it replaces.
    const named = (routeTree.children ?? []).filter((route) => route.options.component !== undefined);
    expect(named.length, "the route tree should still have screens in it").toBeGreaterThan(5);
    for (const route of named) {
      expect(route.options.staticData?.titleKey, `${route.fullPath} needs a staticData.titleKey`).toBeTruthy();
    }
  });
});
