import type { Collection } from "@mycollections/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { routeTree } from "../routeTree.js";

/**
 * The page for an address that is not in the cabinet (#344).
 *
 * Rendered through the real `routeTree` rather than by mounting the component,
 * because most of what is under test is the *routing*: that an unknown URL
 * reaches this screen at all, that the shell names and announces it like any
 * other page, and — the half that a component test cannot see — that the splat
 * route did not quietly take a URL one of the real routes owns.
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

/** Mirrors `Shell.navigation.test.tsx`: a missing export renders the router's error boundary. */
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
  return { router };
}

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  localStorage.setItem("api_token", "test-token");
  document.title = "MyCollections";
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("an address with no page behind it", () => {
  it("says so, in the app's own words", async () => {
    renderAt("/nope");

    const heading = await screen.findByRole("heading", { level: 1 });
    // The exact words, not merely a heading: what rendered here before this
    // route existed was the router's own `<p>Not Found</p>` — a real element
    // that any "something is on screen" assertion accepts.
    expect(heading).toHaveTextContent("Page not found");
    expect(
      screen.getByText(/There is no page at this address/),
      "the explanation is the half that says the user's own data is fine",
    ).toBeInTheDocument();
    expect(document.body, "the library's untranslated fallback must be gone").not.toHaveTextContent(/^Not Found$/);
  });

  it("names the page, so a tab and a history entry can be told apart", async () => {
    renderAt("/nope");
    await screen.findByRole("heading", { level: 1 });

    // Without a route of its own the title stayed whatever the previous screen
    // set, which is WCAG 2.4.2: the page changed and its name did not.
    await waitFor(() => expect(document.title).toBe("Page not found · MyCollections"));
  });

  it("offers a way out that does not depend on the address that failed", async () => {
    renderAt("/nope");
    await screen.findByRole("heading", { level: 1 });

    expect(screen.getByRole("link", { name: "Back to collections" })).toHaveAttribute("href", "/collections");
    expect(screen.getByRole("link", { name: "Go to settings" })).toHaveAttribute("href", "/settings");
  });

  /**
   * A 404 is not a failure of the app, so it takes none of the failure
   * treatment: `[role="alert"]` is what carries the `--danger` ink and the
   * danger semantics in this app (`styles/alerts.integration.test.ts`), and
   * announcing "assertive" for a mistyped URL would interrupt the user for
   * something that is merely wrong, not broken.
   */
  it("is not dressed as an error", async () => {
    renderAt("/nope");
    await screen.findByRole("heading", { level: 1 });

    expect(screen.queryByRole("alert"), "a wrong address is not an alert").toBeNull();
  });

  /**
   * The shell survives, so the cabinet nav is still standing: the address was
   * wrong, the app was not.
   */
  it("keeps the app around it", async () => {
    renderAt("/nope");
    await screen.findByRole("heading", { level: 1 });

    expect(screen.getByRole("navigation", { name: "Main navigation" })).toBeInTheDocument();
    expect(screen.getByRole("main")).toContainElement(screen.getByRole("heading", { level: 1 }));
  });

  /**
   * The router warns in development whenever it falls back to its built-in
   * `<p>Not Found</p>` (`renderRouteNotFound.js:21`). A matched route raises no
   * notFound error at all, so the warning is the cheap proof that this screen is
   * the app's own route rather than a component the router reached for.
   */
  it("never reaches the router's generic fallback", async () => {
    renderAt("/nope");
    await screen.findByRole("heading", { level: 1 });

    const warnings = warn.mock.calls.map((args) => String(args[0]));
    expect(warnings.filter((message) => message.includes("overly generic"))).toEqual([]);
  });
});

/**
 * The risk a catch-all route brings with it. Every one of these URLs belongs to
 * a real route, and a splat that outranked any of them would replace a working
 * screen with "Page not found" — a regression no test of the 404 itself sees.
 */
describe("what the catch-all must not catch", () => {
  it.each([
    ["/collections", "Collections"],
    ["/collections/new", "New collection"],
    [`/collections/${COLLECTION.id}`, "Games"],
    ["/settings", "Settings"],
  ])("leaves %s to its own route", async (path, heading) => {
    renderAt(path);

    expect(await screen.findByRole("heading", { level: 1, name: heading })).toBeInTheDocument();
    expect(screen.queryByText("Page not found")).toBeNull();
  });

  it("still redirects / to the collections dashboard", async () => {
    renderAt("/");

    expect(await screen.findByRole("heading", { level: 1, name: "Collections" })).toBeInTheDocument();
  });

  /**
   * A depth the app has no route for at all. It is the *unknown* segment that
   * has to reach the 404, not the whole path — a collection id that is merely
   * unfamiliar is a different screen with a different answer.
   */
  it("catches a path below a route that exists", async () => {
    renderAt(`/collections/${COLLECTION.id}/nope`);

    expect(await screen.findByRole("heading", { level: 1, name: "Page not found" })).toBeInTheDocument();
  });
});

describe("arriving at a dead link from inside the app", () => {
  /**
   * The announcement, which is the whole reason this is a route and not a
   * `defaultNotFoundComponent`: only a route carries `staticData`, and
   * `staticData.titleKey` is what the shell announces (`Shell.tsx`).
   *
   * A client-side navigation, because that is the only thing the shell
   * announces — it deliberately says nothing about the page a user arrived on,
   * where the browser's own page load has already done it.
   */
  it("announces the page, the same way every other route is announced", async () => {
    const { router } = renderAt("/settings");
    expect(await screen.findByRole("main")).toBeInTheDocument();
    const announcer = document.querySelector('.visually-hidden[aria-live="polite"]');
    expect(announcer, "the shell's announcer must be in the document before the navigation").toBeEmptyDOMElement();

    await router.navigate({ to: "/$", params: { _splat: "nope" } });

    expect(await screen.findByRole("heading", { level: 1, name: "Page not found" })).toBeInTheDocument();
    // The same words as the document title: a screen-reader user is already
    // trained to hear that string on a page change.
    await waitFor(() => expect(announcer).toHaveTextContent("Page not found · MyCollections"));
  });
});
