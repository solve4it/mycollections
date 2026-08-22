import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearToken } from "../../lib/api-client.js";
import { rootRoute } from "../__root.js";
import { collectionsRoute } from "../collections/index.js";
import { setupRoute } from "./index.js";

const testRouteTree = rootRoute.addChildren([setupRoute, collectionsRoute]);

function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderSetup() {
  const qc = makeQueryClient();
  const history = createMemoryHistory({ initialEntries: ["/setup"] });
  const router = createRouter({ routeTree: testRouteTree, history });
  render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router };
}

beforeEach(() => {
  // `clearToken()` as well as the storage wipe: the token is held in memory for
  // the session too (#279), so clearing storage alone leaves a previous test's
  // token in play and this route redirects straight to /collections.
  localStorage.clear();
  clearToken();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("SetupPage", () => {
  it("renders the API token input", async () => {
    renderSetup();
    expect(await screen.findByLabelText(/api token/i)).toBeInTheDocument();
  });

  it("renders a connect button", async () => {
    renderSetup();
    expect(await screen.findByRole("button", { name: /connect/i })).toBeInTheDocument();
  });

  it("stores token in localStorage on form submit", async () => {
    renderSetup();
    const input = await screen.findByLabelText(/api token/i);
    fireEvent.change(input, { target: { value: "test-token-abc" } });
    fireEvent.click(await screen.findByRole("button", { name: /connect/i }));
    expect(localStorage.getItem("api_token")).toBe("test-token-abc");
  });

  it("puts the token field in a form row so the stylesheet reaches it", async () => {
    // Every input rule in global.css is scoped to .form-row. This input sat
    // outside one, so the first screen a new user sees rendered a bare UA
    // control (#224). forms.integration.test.ts proves the rule; this proves
    // the markup opts into it.
    renderSetup();
    const input = await screen.findByLabelText(/api token/i);
    expect(input.closest(".form-row")).not.toBeNull();
  });

  it("says the token will not be remembered when storage is denied", async () => {
    // The one moment this can be said: the page navigates away the instant a
    // token is accepted, so a notice shown after connecting is never read (#279).
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    renderSetup();
    const notice = await screen.findByRole("status");
    expect(notice.textContent).toMatch(/will not let mycollections remember your token/i);
  });

  it("says nothing about persistence when storage works", async () => {
    renderSetup();
    await screen.findByLabelText(/api token/i);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("still lets the user connect when storage is denied", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    const { router } = renderSetup();
    const input = await screen.findByLabelText(/api token/i);
    fireEvent.change(input, { target: { value: "session-token" } });
    fireEvent.click(await screen.findByRole("button", { name: /connect/i }));
    await screen.findByRole("main");
    expect(router.state.location.pathname).toBe("/collections");
  });

  it("redirects to /collections if token already stored", async () => {
    localStorage.setItem("api_token", "existing-token");
    const qc = makeQueryClient();
    const history = createMemoryHistory({ initialEntries: ["/setup"] });
    const router = createRouter({ routeTree: testRouteTree, history });
    render(
      <QueryClientProvider client={qc}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    await screen.findByRole("main");
    expect(router.state.location.pathname).toBe("/collections");
  });
});
