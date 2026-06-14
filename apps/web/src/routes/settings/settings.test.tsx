import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { rootRoute } from "../__root.js";
import { settingsRoute } from "./index.js";

const testRouteTree = rootRoute.addChildren([settingsRoute]);

function renderSettings() {
  const history = createMemoryHistory({ initialEntries: ["/settings"] });
  const router = createRouter({ routeTree: testRouteTree, history });
  render(<RouterProvider router={router} />);
}

afterEach(cleanup);

describe("SettingsPage", () => {
  it("renders Settings heading", async () => {
    renderSettings();
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("Settings");
  });

  it("renders a language selector labeled 'Language'", async () => {
    renderSettings();
    const select = await screen.findByRole("combobox", { name: /language/i });
    expect(select).toBeInTheDocument();
  });

  it("language selector defaults to English", async () => {
    renderSettings();
    const select = await screen.findByRole("combobox", { name: /language/i });
    expect(select).toHaveValue("en");
  });

  it("English option is available in the selector", async () => {
    renderSettings();
    const option = await screen.findByRole("option", { name: /english/i });
    expect(option).toBeInTheDocument();
  });
});
