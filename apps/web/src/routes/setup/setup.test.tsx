import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearToken } from "../../lib/api-client.js";
import { rootRoute } from "../__root.js";
import { authenticatedRoute } from "../_authenticated.js";
import { collectionsRoute } from "../collections/index.js";
import { setupRoute } from "./index.js";

const testRouteTree = rootRoute.addChildren([authenticatedRoute.addChildren([collectionsRoute]), setupRoute]);

function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderSetup(entry = "/setup") {
  const qc = makeQueryClient();
  const history = createMemoryHistory({ initialEntries: [entry] });
  const router = createRouter({ routeTree: testRouteTree, history });
  render(
    <StrictMode>
      <QueryClientProvider client={qc}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </StrictMode>,
  );
  return { router };
}

const CODE = "correct-horse-battery-staple-fixture-tokens";
const LABEL = "API token or pairing link";

/**
 * Stubs `fetch` for a pairing (#241): `/api/pair` answers with `pairResponse`, and
 * anything else — the collections screen the app lands on — with an empty list.
 * Returns the pairing calls only.
 */
function stubPairing(pairResponse: () => Promise<{ status: number; body: unknown }>) {
  const pairCalls: RequestInit[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith("/api/pair")) {
        pairCalls.push(init ?? {});
        const { status, body } = await pairResponse();
        return { ok: status >= 200 && status < 300, status, json: async () => body };
      }
      return { ok: true, status: 200, json: async () => [] };
    }),
  );
  return pairCalls;
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
  vi.unstubAllGlobals();
});

describe("SetupPage", () => {
  it("renders without the shell's nav or skip link, which had nowhere to go (#371)", async () => {
    renderSetup();
    await screen.findByLabelText(LABEL);
    // Every nav destination redirected straight back here with no token, so
    // the nav's links were silent no-ops. The page still sits in <main>.
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.queryByRole("link", { name: "Skip to main content" })).toBeNull();
    expect(screen.getByRole("main")).toContainElement(screen.getByLabelText(LABEL));
  });

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
    const notice = await screen.findByText(/will not let mycollections remember your token/i);
    // A plain hint, not a live region (#326). Whether storage works is probed
    // once, in a lazy `useState` initializer, so this notice is either in the
    // screen's first commit or never rendered at all — and a live region that
    // arrives with the page announces nothing. `role="status"` here bought no
    // announcement and made every page-level status query ambiguous.
    expect(notice).not.toHaveAttribute("role");
    expect(notice).toHaveClass("form-hint");
  });

  it("says nothing about persistence when storage works", async () => {
    renderSetup();
    await screen.findByLabelText(/api token/i);
    // Queried by text, not by role: once the notice is a plain hint, a
    // `queryByRole("status")` here would pass against a notice rendered
    // unconditionally — it would be asserting that nothing on /setup has a role
    // it no longer uses.
    expect(screen.queryByText(/will not let mycollections remember your token/i)).toBeNull();
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

  describe("pairing from the link the API printed (#241)", () => {
    it("trades the code for the token and opens the app, without the user typing anything", async () => {
      const pairCalls = stubPairing(async () => ({ status: 200, body: { token: "device-token" } }));
      const { router } = renderSetup(`/setup#pair=${CODE}`);
      await waitFor(() => expect(router.state.location.pathname).toBe("/collections"));
      expect(localStorage.getItem("api_token")).toBe("device-token");
      expect(pairCalls.map((init) => init.body)).toEqual([JSON.stringify({ code: CODE })]);
    });

    it("sends the code exactly once, even when StrictMode runs the effect twice — a second send would spend it", async () => {
      const pairCalls = stubPairing(async () => ({ status: 200, body: { token: "device-token" } }));
      const { router } = renderSetup(`/setup#pair=${CODE}`);
      await waitFor(() => expect(router.state.location.pathname).toBe("/collections"));
      expect(pairCalls).toHaveLength(1);
    });

    it("pairs even when a stale token is stored, instead of redirecting away and dropping the code", async () => {
      localStorage.setItem("api_token", "stale-token");
      stubPairing(async () => ({ status: 200, body: { token: "device-token" } }));
      const { router } = renderSetup(`/setup#pair=${CODE}`);
      await waitFor(() => expect(localStorage.getItem("api_token")).toBe("device-token"));
      expect(router.state.location.pathname).toBe("/collections");
    });

    it("says it is pairing while the request is in flight", async () => {
      stubPairing(() => new Promise(() => {}));
      renderSetup(`/setup#pair=${CODE}`);
      expect(await screen.findByText("Pairing this browser…")).toBeInTheDocument();
    });

    it("explains a refused link in an alert, offers the paste field, and drops the code from the address", async () => {
      stubPairing(async () => ({ status: 401, body: { error: "Unauthorized" } }));
      const { router } = renderSetup(`/setup#pair=${CODE}`);
      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent(
        "That pairing link has expired or was already used. Restart the API for a new one, or paste the API token below.",
      );
      expect(screen.getByLabelText(LABEL)).toBeInTheDocument();
      expect(localStorage.getItem("api_token")).toBeNull();
      expect(router.state.location.pathname).toBe("/setup");
      await waitFor(() => expect(router.state.location.hash).toBe(""));
    });

    it("tells the user the API could not be reached, which is not the same as a bad link", async () => {
      stubPairing(() => Promise.reject(new TypeError("Failed to fetch")));
      renderSetup(`/setup#pair=${CODE}`);
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Could not reach the API to pair this browser. Make sure it is running, then open the link again.",
      );
    });

    it("pairs from a link pasted into the field, for a browser the link could not be opened in", async () => {
      const pairCalls = stubPairing(async () => ({ status: 200, body: { token: "device-token" } }));
      const { router } = renderSetup();
      fireEvent.change(await screen.findByLabelText(LABEL), {
        target: { value: `http://localhost:5173/setup#pair=${CODE}` },
      });
      fireEvent.click(screen.getByRole("button", { name: "Connect" }));
      await waitFor(() => expect(router.state.location.pathname).toBe("/collections"));
      expect(localStorage.getItem("api_token")).toBe("device-token");
      expect(pairCalls).toHaveLength(1);
    });

    it("keeps Connect focusable but refuses a second press while a pasted link is pairing", async () => {
      const pairCalls = stubPairing(() => new Promise(() => {}));
      renderSetup();
      fireEvent.change(await screen.findByLabelText(LABEL), {
        target: { value: `http://localhost:5173/setup#pair=${CODE}` },
      });
      const button = screen.getByRole("button", { name: "Connect" });
      fireEvent.click(button);
      await waitFor(() => expect(button).toHaveAttribute("aria-disabled", "true"));
      expect(button).not.toBeDisabled();
      fireEvent.click(button);
      expect(pairCalls).toHaveLength(1);
    });
  });
});
