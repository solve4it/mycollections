import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { rootRoute } from "../__root.js";
import { setupRoute } from "../setup/index.js";
import { settingsRoute } from "./index.js";

const testRouteTree = rootRoute.addChildren([settingsRoute, setupRoute]);

function renderSettings() {
  const history = createMemoryHistory({ initialEntries: ["/settings"] });
  const router = createRouter({ routeTree: testRouteTree, history });
  render(<RouterProvider router={router} />);
  return { router };
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

  it("renders a Disconnect button", async () => {
    renderSettings();
    expect(await screen.findByRole("button", { name: /disconnect/i })).toBeInTheDocument();
  });

  it("clearing the connection removes the stored token and goes to /setup", async () => {
    localStorage.setItem("api_token", "some-token");
    const { router } = renderSettings();
    fireEvent.click(await screen.findByRole("button", { name: /disconnect/i }));
    expect(localStorage.getItem("api_token")).toBeNull();
    await waitFor(() => expect(router.state.location.pathname).toBe("/setup"));
  });
});
