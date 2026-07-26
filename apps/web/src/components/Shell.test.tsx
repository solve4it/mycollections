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
