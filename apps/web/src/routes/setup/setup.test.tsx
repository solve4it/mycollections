import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  localStorage.clear();
});

afterEach(cleanup);

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
