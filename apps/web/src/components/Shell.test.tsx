import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { routeTree } from "../routeTree.js";

function makeRouter(initialPath = "/collections") {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [initialPath] }),
  });
  return router;
}

describe("Shell layout", () => {
  it("renders sidebar navigation", async () => {
    render(<RouterProvider router={makeRouter()} />);
    expect(await screen.findByRole("navigation", { name: /main navigation/i })).toBeInTheDocument();
  });

  it("renders bottom navigation", async () => {
    render(<RouterProvider router={makeRouter()} />);
    expect(await screen.findByRole("navigation", { name: /bottom navigation/i })).toBeInTheDocument();
  });

  it("renders a skip-to-content link for keyboard users", async () => {
    render(<RouterProvider router={makeRouter()} />);
    expect(await screen.findByRole("link", { name: /skip to main content/i })).toBeInTheDocument();
  });

  it("has a main landmark for the content area", async () => {
    render(<RouterProvider router={makeRouter()} />);
    expect(await screen.findByRole("main")).toBeInTheDocument();
  });

  it("makes main a focus target so the skip link actually moves focus (#24)", async () => {
    // Safari and Firefox scroll to a fragment target but leave focus where it
    // was unless the target is focusable, which turns the skip link into a
    // no-op for the keyboard users it exists for (WCAG 2.4.1). tabindex="-1"
    // makes it programmatically focusable without adding it to the tab order.
    render(<RouterProvider router={makeRouter()} />);
    const main = await screen.findByRole("main");
    expect(main).toHaveAttribute("id", "main-content");
    expect(main).toHaveAttribute("tabindex", "-1");
  });

  it("nav items carry the touch-target CSS class (≥44px hit area)", async () => {
    render(<RouterProvider router={makeRouter()} />);
    await screen.findByRole("navigation", { name: /main navigation/i });
    const navLinks = screen.getAllByRole("link", { name: /collections|settings/i });
    for (const link of navLinks) {
      expect(link).toHaveClass("touch-target");
    }
  });

  it("nav items use inline SVG icons, hidden from assistive tech (#221)", async () => {
    render(<RouterProvider router={makeRouter()} />);
    await screen.findByRole("navigation", { name: /main navigation/i });
    const navLinks = screen.getAllByRole("link", { name: /collections|settings/i });
    expect(navLinks.length).toBe(4); // two destinations × sidebar + bottom nav
    for (const link of navLinks) {
      const icon = link.querySelector("svg.icon");
      expect(icon, `${link.textContent} must render an inline SVG icon`).not.toBeNull();
      expect(icon).toHaveAttribute("aria-hidden", "true");
      // The label is the accessible name; the icon must not add to it.
      expect(link.textContent).toMatch(/^(Collections|Settings)$/);
    }
  });

  it("shows the drawer mark beside the wordmark (#221)", async () => {
    render(<RouterProvider router={makeRouter()} />);
    const logo = (await screen.findByText("MyCollections")).closest(".sidebar-logo");
    expect(logo?.querySelector("svg.icon")).toBeInTheDocument();
  });

  it("stamps the build version into the cabinet footer (#222)", async () => {
    render(<RouterProvider router={makeRouter()} />);
    const footer = (await screen.findByText(/LOCAL-FIRST/)).closest(".sidebar-foot");
    // The version is injected at build time from the release-please manifest, so
    // assert the real value rather than a loose "contains a v" pattern.
    expect(footer).toHaveTextContent(`LOCAL-FIRST · v${__APP_VERSION__}`);
    expect(__APP_VERSION__, "the injected version must look like a semver").toMatch(/^\d+\.\d+\.\d+/);
  });

  it("Collections nav links point to /collections", async () => {
    render(<RouterProvider router={makeRouter()} />);
    await screen.findByRole("navigation", { name: /main navigation/i });
    const links = screen.getAllByRole("link", { name: /^collections$/i });
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link).toHaveAttribute("href", "/collections");
    }
  });
});
