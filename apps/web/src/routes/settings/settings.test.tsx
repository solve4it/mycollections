import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rootRoute } from "../__root.js";
import { setupRoute } from "../setup/index.js";
import { settingsRoute } from "./index.js";

vi.mock("../../lib/api-client.js", () => ({
  clearToken: vi.fn(() => localStorage.removeItem("api_token")),
  getToken: vi.fn(() => "test-token"),
  exportData: vi.fn(),
  importData: vi.fn(),
}));

import { exportData, importData } from "../../lib/api-client.js";

const testRouteTree = rootRoute.addChildren([settingsRoute, setupRoute]);

function renderSettings() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const history = createMemoryHistory({ initialEntries: ["/settings"] });
  const router = createRouter({ routeTree: testRouteTree, history });
  render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router };
}

function selectFile(input: HTMLElement, contents: string, name = "backup.json") {
  const file = new File([contents], name, { type: "application/json" });
  fireEvent.change(input, { target: { files: [file] } });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(exportData).mockResolvedValue(new Blob(["{}"], { type: "application/json" }));
  vi.mocked(importData).mockResolvedValue({
    collectionsImported: 2,
    collectionsSkipped: 1,
    itemsImported: 5,
    itemsSkipped: 3,
  });
});

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

describe("SettingsPage data export", () => {
  it("renders an Export button", async () => {
    renderSettings();
    expect(await screen.findByRole("button", { name: /export data/i })).toBeInTheDocument();
  });

  it("downloads a backup file when Export is clicked", async () => {
    const createObjectURL = vi.fn(() => "blob:backup");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL });

    renderSettings();
    fireEvent.click(await screen.findByRole("button", { name: /export data/i }));

    await waitFor(() => expect(exportData).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1));
    vi.unstubAllGlobals();
  });

  it("shows an error when export fails", async () => {
    vi.mocked(exportData).mockRejectedValue(new Error("boom"));
    renderSettings();
    fireEvent.click(await screen.findByRole("button", { name: /export data/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/export failed/i);
  });
});

describe("SettingsPage data import", () => {
  it("renders a file picker for import", async () => {
    renderSettings();
    expect(await screen.findByLabelText(/choose backup file/i)).toBeInTheDocument();
  });

  it("imports a chosen file and reports the counts", async () => {
    renderSettings();
    const input = await screen.findByLabelText(/choose backup file/i);
    selectFile(input, JSON.stringify({ version: 1, exportedAt: "x", collections: [], items: [] }));

    await waitFor(() => expect(importData).toHaveBeenCalledTimes(1));
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent(/imported 2 collections and 5 items/i);
    expect(status).toHaveTextContent(/1 collections and 3 items already present were skipped/i);
  });

  it("rejects a file that is not valid JSON", async () => {
    renderSettings();
    const input = await screen.findByLabelText(/choose backup file/i);
    selectFile(input, "this is not json");

    expect(await screen.findByRole("alert")).toHaveTextContent(/import failed/i);
    expect(importData).not.toHaveBeenCalled();
  });

  it("shows an error when the server rejects the import", async () => {
    vi.mocked(importData).mockRejectedValue(new Error("400"));
    renderSettings();
    const input = await screen.findByLabelText(/choose backup file/i);
    selectFile(input, JSON.stringify({ version: 999 }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/import failed/i);
  });
});
