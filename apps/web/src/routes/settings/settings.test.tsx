import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rootRoute } from "../__root.js";
import { setupRoute } from "../setup/index.js";
import { settingsRoute } from "./index.js";

vi.mock("../../lib/api-client.js", () => ({
  clearToken: vi.fn(() => localStorage.removeItem("api_token")),
  getToken: vi.fn(() => "test-token"),
  isTokenSessionOnly: vi.fn(() => false),
  exportData: vi.fn(),
  importData: vi.fn(),
  // The page's Trash section calls these; trash.test.tsx is where they are exercised.
  listTrash: vi.fn(),
  restoreItem: vi.fn(),
  restoreCollection: vi.fn(),
  purgeItem: vi.fn(),
  purgeCollection: vi.fn(),
  emptyTrash: vi.fn(),
}));

import { exportData, type ImportSummary, importData, isTokenSessionOnly, listTrash } from "../../lib/api-client.js";
import { isErrorReportingEnabled, setErrorReportingEnabled } from "../../lib/error-reporter.js";
import { getThemePreference, setThemePreference } from "../../lib/theme.js";

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

/**
 * The Data section. Import progress is asserted inside it because the page now
 * holds a second live region — the Trash section announces its own load — and a
 * page-wide `role="status"` query would let one answer for the other.
 */
async function dataSection(): Promise<HTMLElement> {
  const heading = await screen.findByRole("heading", { name: "Data" });
  const section = heading.closest("section");
  if (!section) throw new Error("Data heading is not inside a section");
  return section;
}

function selectFile(input: HTMLElement, contents: string, name = "backup.json") {
  const file = new File([contents], name, { type: "application/json" });
  fireEvent.change(input, { target: { files: [file] } });
}

const IMPORT_SUMMARY: ImportSummary = {
  collectionsImported: 2,
  collectionsSkipped: 1,
  itemsImported: 5,
  itemsSkipped: 3,
};

/** A promise the test settles by hand, so the import can be held in flight. */
function deferred<T>() {
  let settle!: (value: T) => void;
  let fail!: (reason: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });
  return { promise, settle, fail };
}

beforeEach(() => {
  localStorage.clear();
  // documentElement is shared across a file — never let a theme leak into a neighbor.
  document.documentElement.removeAttribute("data-theme");
  vi.resetAllMocks();
  vi.mocked(exportData).mockResolvedValue(new Blob(["{}"], { type: "application/json" }));
  vi.mocked(importData).mockResolvedValue(IMPORT_SUMMARY);
  vi.mocked(listTrash).mockResolvedValue({ collections: [], items: [] });
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

  it("says the token is not saved when it is only held for the session", async () => {
    // The re-prompt after a reload is expected, not a bug — the Connection
    // section is where someone goes looking for why (#279).
    vi.mocked(isTokenSessionOnly).mockReturnValue(true);
    renderSettings();
    const notice = await screen.findByText(/token is not saved on this device/i);
    expect(notice).toHaveAttribute("role", "status");
  });

  it("says nothing about the token when it is stored normally", async () => {
    vi.mocked(isTokenSessionOnly).mockReturnValue(false);
    renderSettings();
    await screen.findByRole("button", { name: /disconnect/i });
    expect(screen.queryByText(/token is not saved on this device/i)).toBeNull();
  });

  it("clearing the connection removes the stored token and goes to /setup", async () => {
    localStorage.setItem("api_token", "some-token");
    const { router } = renderSettings();
    fireEvent.click(await screen.findByRole("button", { name: /disconnect/i }));
    expect(localStorage.getItem("api_token")).toBeNull();
    await waitFor(() => expect(router.state.location.pathname).toBe("/setup"));
  });
});

describe("SettingsPage privacy", () => {
  it("renders an error-reporting toggle that is on by default", async () => {
    renderSettings();
    const toggle = await screen.findByRole("checkbox", { name: /error report/i });
    expect(toggle).toBeChecked();
  });

  it("unchecking the toggle opts out of error reporting", async () => {
    renderSettings();
    const toggle = await screen.findByRole("checkbox", { name: /error report/i });
    fireEvent.click(toggle);
    expect(toggle).not.toBeChecked();
    expect(isErrorReportingEnabled()).toBe(false);
  });

  it("reflects a previously saved opt-out", async () => {
    setErrorReportingEnabled(false);
    renderSettings();
    const toggle = await screen.findByRole("checkbox", { name: /error report/i });
    expect(toggle).not.toBeChecked();
  });

  it("re-checking the toggle opts back in", async () => {
    setErrorReportingEnabled(false);
    renderSettings();
    const toggle = await screen.findByRole("checkbox", { name: /error report/i });
    fireEvent.click(toggle);
    expect(toggle).toBeChecked();
    expect(isErrorReportingEnabled()).toBe(true);
  });
});

describe("SettingsPage theme", () => {
  it("renders a theme selector that defaults to following the system", async () => {
    renderSettings();
    const select = await screen.findByRole("combobox", { name: /theme/i });
    expect(select).toHaveValue("system");
  });

  it("offers exactly light, dark and system", async () => {
    renderSettings();
    const select = await screen.findByRole("combobox", { name: /theme/i });
    const options = within(select).getAllByRole("option");
    expect(options.map((option) => (option as HTMLOptionElement).value)).toEqual(["system", "light", "dark"]);
    expect(options.map((option) => option.textContent)).toEqual(["Match system", "Light", "Dark"]);
  });

  it("choosing dark stamps the override on the document and remembers it", async () => {
    renderSettings();
    const select = await screen.findByRole("combobox", { name: /theme/i });
    fireEvent.change(select, { target: { value: "dark" } });
    expect(select).toHaveValue("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(getThemePreference()).toBe("dark");
  });

  it("reflects a previously saved choice", async () => {
    setThemePreference("light");
    renderSettings();
    expect(await screen.findByRole("combobox", { name: /theme/i })).toHaveValue("light");
  });

  it("switching back to system drops the override so the OS decides again", async () => {
    setThemePreference("dark");
    renderSettings();
    const select = await screen.findByRole("combobox", { name: /theme/i });
    fireEvent.change(select, { target: { value: "system" } });
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
    expect(getThemePreference()).toBe("system");
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
    const status = await within(await dataSection()).findByRole("status");
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

  it("announces progress while the import is in flight and stops once it succeeds", async () => {
    const inFlight = deferred<ImportSummary>();
    vi.mocked(importData).mockReturnValue(inFlight.promise);

    renderSettings();
    const input = await screen.findByLabelText(/choose backup file/i);
    selectFile(input, JSON.stringify({ version: 1, exportedAt: "x", collections: [], items: [] }));

    const data = within(await dataSection());
    expect(await data.findByRole("status")).toHaveTextContent("Importing your backup…");

    inFlight.settle(IMPORT_SUMMARY);

    await waitFor(() => expect(data.getByRole("status")).toHaveTextContent(/imported 2 collections and 5 items/i));
    expect(screen.queryByText("Importing your backup…")).not.toBeInTheDocument();
  });

  it("disables the file picker while the import is in flight and re-enables it afterwards", async () => {
    const inFlight = deferred<ImportSummary>();
    vi.mocked(importData).mockReturnValue(inFlight.promise);

    renderSettings();
    const input = await screen.findByLabelText(/choose backup file/i);
    selectFile(input, JSON.stringify({ version: 1, exportedAt: "x", collections: [], items: [] }));

    await waitFor(() => expect(input).toBeDisabled());
    // A disabled control still has to say what it is.
    expect(input).toHaveAccessibleName("Choose backup file");

    inFlight.settle(IMPORT_SUMMARY);

    await waitFor(() => expect(input).toBeEnabled());
  });

  it("stops announcing progress when the import fails", async () => {
    const inFlight = deferred<ImportSummary>();
    vi.mocked(importData).mockReturnValue(inFlight.promise);

    renderSettings();
    const input = await screen.findByLabelText(/choose backup file/i);
    selectFile(input, JSON.stringify({ version: 1, exportedAt: "x", collections: [], items: [] }));

    const data = within(await dataSection());
    expect(await data.findByRole("status")).toHaveTextContent("Importing your backup…");

    inFlight.fail(new Error("500"));

    expect(await data.findByRole("alert")).toHaveTextContent(/import failed/i);
    expect(data.queryByRole("status")).not.toBeInTheDocument();
    expect(input).toBeEnabled();
  });

  it("shows an error when the server rejects the import", async () => {
    vi.mocked(importData).mockRejectedValue(new Error("400"));
    renderSettings();
    const input = await screen.findByLabelText(/choose backup file/i);
    selectFile(input, JSON.stringify({ version: 999 }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/import failed/i);
  });
});
