import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rootRoute } from "../__root.js";
import { authenticatedRoute } from "../_authenticated.js";
import { setupRoute } from "../setup/index.js";
import { settingsRoute } from "./index.js";

vi.mock("../../lib/api-client.js", () => ({
  // Real enough for the page to tell a 413 from a 409 by `status` (#45).
  ApiError: class ApiError extends Error {
    constructor(readonly status: number) {
      super(`API error ${status}`);
    }
  },
  clearToken: vi.fn(() => localStorage.removeItem("api_token")),
  getToken: vi.fn(() => "test-token"),
  isTokenSessionOnly: vi.fn(() => false),
  exportData: vi.fn(),
  importData: vi.fn(),
  getImportJob: vi.fn(),
  getCurrentImport: vi.fn(),
  // The page's Trash section calls these; trash.test.tsx is where they are exercised.
  listTrash: vi.fn(),
  restoreItem: vi.fn(),
  restoreCollection: vi.fn(),
  purgeItem: vi.fn(),
  purgeCollection: vi.fn(),
  emptyTrash: vi.fn(),
}));

import {
  ApiError,
  exportData,
  getCurrentImport,
  getImportJob,
  getToken,
  type ImportJob,
  type ImportResult,
  type ImportSummary,
  importData,
  isTokenSessionOnly,
  listTrash,
} from "../../lib/api-client.js";
import { isErrorReportingEnabled, setErrorReportingEnabled } from "../../lib/error-reporter.js";
import { importPolling } from "../../lib/queries.js";
import { getThemePreference, setThemePreference } from "../../lib/theme.js";

const testRouteTree = rootRoute.addChildren([authenticatedRoute.addChildren([settingsRoute]), setupRoute]);

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
 * The Data section. Import messages are asserted inside it because the page owns
 * more than one live region — the Trash section has its own — and a page-wide
 * query would let one answer for the other.
 */
async function dataSection(): Promise<HTMLElement> {
  const heading = await screen.findByRole("heading", { name: "Data" });
  const section = heading.closest("section");
  if (!section) throw new Error("Data heading is not inside a section");
  return section;
}

/**
 * The import's live region (#326). Queried by class, not by role or by a bare
 * `[aria-live]`: the region carries `aria-live` and no `role="status"`, and this
 * file renders the real root route, so the shell's announcer and the Trash
 * section's region are both in the same document.
 */
function importLiveRegion(): HTMLElement {
  const regions = document.querySelectorAll<HTMLElement>(".import-live");
  expect(regions, "the page must own exactly one import live region").toHaveLength(1);
  const region = regions[0];
  if (!region) throw new Error("no import live region");
  return region;
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
  mediaImported: 4,
  mediaAttached: 0,
  mediaSkipped: 0,
  mediaOverLimit: 0,
};

/** A file that starts like every zip does (`PK\x03\x04`), as an export archive would (#45). */
function selectArchive(input: HTMLElement) {
  const file = new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3])], "backup.zip", { type: "application/zip" });
  fireEvent.change(input, { target: { files: [file] } });
  return file;
}

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
  vi.mocked(importData).mockResolvedValue({ summary: IMPORT_SUMMARY });
  vi.mocked(getCurrentImport).mockResolvedValue(null);
  // Polled fast here; a second is the real interval.
  importPolling.intervalMs = 10;
  vi.mocked(listTrash).mockResolvedValue({ collections: [], items: [] });
});

afterEach(cleanup);

describe("SettingsPage", () => {
  it("goes to /setup without a token, like every other guarded screen (#371)", async () => {
    vi.mocked(getToken).mockReturnValue(null);
    const { router } = renderSettings();
    await waitFor(() => expect(router.state.location.pathname).toBe("/setup"));
    // No screen of unauthenticated queries offering to unpair nothing.
    expect(screen.queryByRole("button", { name: "Unpair this browser" })).toBeNull();
    vi.mocked(getToken).mockReturnValue("test-token");
  });

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

  it("offers to unpair this browser, and says plainly that the token is not revoked (#241)", async () => {
    renderSettings();
    expect(await screen.findByRole("button", { name: "Unpair this browser" })).toBeInTheDocument();
    expect(
      screen.getByText(
        "Forget the API token in this browser. To connect again, open a new pairing link from the API's startup output, or paste the token. The token itself is not revoked.",
      ),
    ).toBeInTheDocument();
  });

  it("says the token is not saved when it is only held for the session", async () => {
    // The re-prompt after a reload is expected, not a bug — the Connection
    // section is where someone goes looking for why (#279).
    vi.mocked(isTokenSessionOnly).mockReturnValue(true);
    renderSettings();
    const notice = await screen.findByText(/token is not saved on this device/i);
    // A plain hint, not a live region (#308): it is on screen from the moment
    // the section renders and never changes, so a `role="status"` on it could
    // never fire — it only made every page-level status query ambiguous.
    expect(notice).not.toHaveAttribute("role");
    expect(notice).toHaveClass("form-hint");
  });

  it("says nothing about the token when it is stored normally", async () => {
    vi.mocked(isTokenSessionOnly).mockReturnValue(false);
    renderSettings();
    await screen.findByRole("button", { name: "Unpair this browser" });
    expect(screen.queryByText(/token is not saved on this device/i)).toBeNull();
  });

  it("unpairing removes the stored token and goes to /setup", async () => {
    localStorage.setItem("api_token", "some-token");
    const { router } = renderSettings();
    fireEvent.click(await screen.findByRole("button", { name: "Unpair this browser" }));
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

/**
 * #299: heading navigation is a primary way through a long settings page, so
 * every control has to hang off an <h2>. Asserted structurally — the controls
 * are looked up *within* the section its heading names, so moving a row back
 * out of the section fails here even though the control is still on the page.
 */
describe("SettingsPage outline", () => {
  it("holds the language and theme controls inside the Interface section", async () => {
    renderSettings();
    const heading = await screen.findByRole("heading", { level: 2, name: "Interface" });
    const section = heading.closest("section");
    if (!section) throw new Error("Interface heading is not inside a section");

    const preferences = within(section);
    expect(preferences.getByRole("combobox", { name: /language/i })).toHaveValue("en");
    expect(preferences.getByRole("combobox", { name: /theme/i })).toHaveValue("system");
  });

  it("names every group on the page, in order", async () => {
    renderSettings();
    await screen.findByRole("heading", { level: 2, name: "Interface" });
    const outline = screen.getAllByRole("heading", { level: 2 });
    expect(outline.map((h) => h.textContent)).toEqual(["Interface", "Data", "Trash", "Privacy", "Connection"]);
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

describe("SettingsPage export archives (#45)", () => {
  it("saves the export as a .zip, since it now carries images", async () => {
    const clicks: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicks.push(this.download);
    });
    vi.stubGlobal("URL", { ...URL, createObjectURL: vi.fn(() => "blob:x"), revokeObjectURL: vi.fn() });
    renderSettings();
    fireEvent.click(await screen.findByRole("button", { name: /export data/i }));
    await waitFor(() => expect(clicks).toHaveLength(1));
    expect(clicks[0]).toMatch(/^mycollections-export-\d{4}-\d{2}-\d{2}\.zip$/);
    vi.unstubAllGlobals();
  });

  it("keeps Export focusable but refuses a second press while one export is running", async () => {
    const inFlight = deferred<Blob>();
    vi.mocked(exportData).mockReturnValue(inFlight.promise);
    renderSettings();
    const button = await screen.findByRole("button", { name: /export data/i });
    fireEvent.click(button);
    await waitFor(() => expect(button).toHaveAttribute("aria-disabled", "true"));
    expect(button).not.toBeDisabled();
    fireEvent.click(button);
    expect(exportData).toHaveBeenCalledTimes(1);
  });
});

describe("SettingsPage data import", () => {
  it("sends an export archive as it is, without reading it as JSON (#45)", async () => {
    renderSettings();
    const file = selectArchive(await screen.findByLabelText(/choose backup file/i));
    await waitFor(() => expect(importData).toHaveBeenCalledWith({ archive: file }, "skip"));
  });

  it("offers archives in the file picker as well as JSON backups (#45)", async () => {
    renderSettings();
    const input = await screen.findByLabelText(/choose backup file/i);
    expect(input.getAttribute("accept")?.split(",")).toEqual([".zip", "application/zip", ".json", "application/json"]);
  });

  it("says a backup is too large to import, which is not the same as a broken one (#45)", async () => {
    vi.mocked(importData).mockRejectedValue(new ApiError(413));
    renderSettings();
    selectArchive(await screen.findByLabelText(/choose backup file/i));
    expect(await screen.findByRole("alert")).toHaveTextContent("That backup is larger than an import allows.");
  });

  it("says another import is still running (#45)", async () => {
    vi.mocked(importData).mockRejectedValue(new ApiError(409));
    renderSettings();
    selectArchive(await screen.findByLabelText(/choose backup file/i));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Another import is still running. Try again when it has finished.",
    );
  });

  it("renders a file picker for import", async () => {
    renderSettings();
    expect(await screen.findByLabelText(/choose backup file/i)).toBeInTheDocument();
  });

  it("imports a chosen file and reports the counts", async () => {
    renderSettings();
    const input = await screen.findByLabelText(/choose backup file/i);
    selectFile(input, JSON.stringify({ version: 1, exportedAt: "x", collections: [], items: [] }));

    await waitFor(() => expect(importData).toHaveBeenCalledTimes(1));
    expect(importData).toHaveBeenCalledWith(
      {
        document: { version: 1, exportedAt: "x", collections: [], items: [] },
      },
      "skip",
    );
    await waitFor(() => expect(importLiveRegion()).toHaveTextContent(/imported 2 collections, 5 items and 4 images/i));
    expect(importLiveRegion()).toHaveTextContent(/1 collections, 3 items and 0 images already present were skipped/i);
  });

  it("fills a live region that was already in the document, rather than inserting one with its message inside (#326)", async () => {
    // The sequence is the whole point, so it is asserted as a sequence: a region
    // that appears already holding its text is announced by VoiceOver but
    // usually not by NVDA or JAWS, and a test that only inspected the final DOM
    // would pass against exactly that bug.
    const inFlight = deferred<ImportResult>();
    vi.mocked(importData).mockReturnValue(inFlight.promise);

    renderSettings();
    const input = await screen.findByLabelText(/choose backup file/i);

    const before = importLiveRegion();
    expect(before).toHaveAttribute("aria-live", "polite");
    // No role="status" on the region: a role implies `aria-live`, so the nearest
    // live region for the message's own insertion would be the message itself,
    // and the announcement would be lost rather than doubled. Leaving it off
    // also keeps `getByRole("status")` pointed at the loading skeletons.
    expect(before).not.toHaveAttribute("role");
    // Nor `aria-atomic`: the pending text is replaced in place by the summary,
    // and atomic would re-read the whole region instead of what changed.
    expect(before).not.toHaveAttribute("aria-atomic");
    expect(before, "the region must already be in the document, and empty").toBeEmptyDOMElement();

    selectFile(input, JSON.stringify({ version: 1, exportedAt: "x", collections: [], items: [] }));

    await waitFor(() => expect(importLiveRegion()).toHaveTextContent("Importing your backup…"));
    // Identity, not shape: a region torn down and rebuilt with the message in it
    // satisfies every "the text is there" assertion and announces nothing.
    expect(importLiveRegion(), "the pending message must land in the node that was already there").toBe(before);
    // And the message inside carries no role of its own, for the same reason.
    const pending = within(before).getByText("Importing your backup…");
    expect(pending).not.toHaveAttribute("role");

    inFlight.settle({ summary: IMPORT_SUMMARY });

    await waitFor(() => expect(importLiveRegion()).toHaveTextContent(/imported 2 collections, 5 items and 4 images/i));
    expect(importLiveRegion(), "the summary must replace the pending text in the same node").toBe(before);
  });

  it("rejects a file that is not valid JSON", async () => {
    renderSettings();
    const input = await screen.findByLabelText(/choose backup file/i);
    selectFile(input, "this is not json");

    expect(await screen.findByRole("alert")).toHaveTextContent(/import failed/i);
    expect(importData).not.toHaveBeenCalled();
  });

  it("announces progress while the import is in flight and stops once it succeeds", async () => {
    const inFlight = deferred<ImportResult>();
    vi.mocked(importData).mockReturnValue(inFlight.promise);

    renderSettings();
    const input = await screen.findByLabelText(/choose backup file/i);
    selectFile(input, JSON.stringify({ version: 1, exportedAt: "x", collections: [], items: [] }));

    await screen.findByLabelText(/choose backup file/i);
    await waitFor(() => expect(importLiveRegion()).toHaveTextContent("Importing your backup…"));

    inFlight.settle({ summary: IMPORT_SUMMARY });

    await waitFor(() => expect(importLiveRegion()).toHaveTextContent(/imported 2 collections, 5 items and 4 images/i));
    expect(screen.queryByText("Importing your backup…")).not.toBeInTheDocument();
  });

  // Marked busy rather than disabled (#368). A `disabled` input drops focus to
  // <body>, so a keyboard user who chose a file was thrown out of the page by
  // the import starting; the refusal of a second file moved into the handler.
  it("marks the file picker busy while the import is in flight and clears it afterwards", async () => {
    const inFlight = deferred<ImportResult>();
    vi.mocked(importData).mockReturnValue(inFlight.promise);

    renderSettings();
    const input = await screen.findByLabelText(/choose backup file/i);
    selectFile(input, JSON.stringify({ version: 1, exportedAt: "x", collections: [], items: [] }));

    await waitFor(() => expect(input).toHaveAttribute("aria-disabled", "true"));
    // In the tab order throughout, and still saying what it is.
    expect(input).toBeEnabled();
    expect(input).toHaveAccessibleName("Choose backup file");

    // A second file chosen mid-import is refused rather than queued.
    selectFile(input, JSON.stringify({ version: 1, exportedAt: "x", collections: [], items: [] }));
    expect(vi.mocked(importData)).toHaveBeenCalledTimes(1);

    inFlight.settle({ summary: IMPORT_SUMMARY });

    await waitFor(() => expect(input).not.toHaveAttribute("aria-disabled"));
  });

  it("stops announcing progress when the import fails", async () => {
    const inFlight = deferred<ImportResult>();
    vi.mocked(importData).mockReturnValue(inFlight.promise);

    renderSettings();
    const input = await screen.findByLabelText(/choose backup file/i);
    selectFile(input, JSON.stringify({ version: 1, exportedAt: "x", collections: [], items: [] }));

    const data = within(await dataSection());
    const before = importLiveRegion();
    await waitFor(() => expect(importLiveRegion()).toHaveTextContent("Importing your backup…"));

    inFlight.fail(new Error("500"));

    expect(await data.findByRole("alert")).toHaveTextContent(/import failed/i);
    // The region stays — the same node, emptied. Asserting "no status role in
    // the section" would pass vacuously now that nothing here carries one, and
    // would not notice the region being torn down. Emptying it is also what
    // stops the announcement: a polite region's default relevance is
    // "additions text", so removing the pending words says nothing, and the
    // failure is spoken by the `role="alert"` beside the region instead.
    expect(importLiveRegion()).toBe(before);
    expect(importLiveRegion()).toBeEmptyDOMElement();
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

/** A background import's state (#452), running unless the overrides say otherwise. */
function job(overrides: Partial<ImportJob> = {}): ImportJob {
  return {
    id: "0b1c2d3e-4f50-4617-8293-a4b5c6d7e8f9",
    phase: "images",
    imagesDone: 0,
    imagesTotal: 8,
    summary: null,
    failure: null,
    ...overrides,
  };
}

/** The shell's hidden announcer, where milestone messages go. */
function announcer(): HTMLElement {
  const region = document.querySelector<HTMLElement>(".visually-hidden[aria-live]");
  if (!region) throw new Error("no shell announcer");
  return region;
}

describe("SettingsPage background archive imports (#452)", () => {
  it("shows the job's progress outside the live region, then its summary inside it", async () => {
    vi.mocked(importData).mockResolvedValue({ job: job() });
    vi.mocked(getImportJob)
      .mockResolvedValueOnce(job({ imagesDone: 3 }))
      .mockResolvedValueOnce(job({ phase: "saving", imagesDone: 8 }))
      .mockResolvedValue(job({ phase: "done", imagesDone: 8, summary: IMPORT_SUMMARY }));
    renderSettings();
    const input = await screen.findByLabelText(/choose backup file/i);
    const before = importLiveRegion();
    selectArchive(input);

    const progress = await screen.findByRole("progressbar", { name: "Importing images" });
    await waitFor(() => expect(progress).toHaveAttribute("value", "3"));
    expect(progress).toHaveAttribute("max", "8");
    expect(screen.getByText("3 of 8 images")).toBeInTheDocument();
    // Each poll changes the count; inside the live region, every one would be read out.
    expect(importLiveRegion()).not.toContainElement(progress);
    expect(importLiveRegion()).toHaveTextContent("Importing your backup…");

    await waitFor(() => expect(importLiveRegion()).toHaveTextContent(/imported 2 collections, 5 items and 4 images/i));
    expect(importLiveRegion()).toBe(before);
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(getImportJob).toHaveBeenCalledWith("0b1c2d3e-4f50-4617-8293-a4b5c6d7e8f9");
  });

  it("drops the value while saving, so the bar reads as indeterminate", async () => {
    vi.mocked(importData).mockResolvedValue({ job: job() });
    vi.mocked(getImportJob).mockResolvedValue(job({ phase: "saving", imagesDone: 8 }));
    renderSettings();
    selectArchive(await screen.findByLabelText(/choose backup file/i));
    await waitFor(() => expect(screen.getByText("Saving your collections…")).toBeInTheDocument());
    expect(screen.getByRole("progressbar", { name: "Importing images" })).not.toHaveAttribute("value");
  });

  it("keeps the file picker busy until the job ends, not just until the upload is accepted", async () => {
    vi.mocked(importData).mockResolvedValue({ job: job() });
    vi.mocked(getImportJob).mockResolvedValue(job({ imagesDone: 1 }));
    renderSettings();
    const input = await screen.findByLabelText(/choose backup file/i);
    selectArchive(input);
    await screen.findByRole("progressbar");
    expect(input).toHaveAttribute("aria-disabled", "true");
    selectArchive(input);
    expect(importData).toHaveBeenCalledTimes(1);

    vi.mocked(getImportJob).mockResolvedValue(job({ phase: "done", imagesDone: 8, summary: IMPORT_SUMMARY }));
    await waitFor(() => expect(input).not.toHaveAttribute("aria-disabled"));
  });

  it("finds a running import again after a reload, and reports it when it ends", async () => {
    vi.mocked(getCurrentImport).mockResolvedValue(job({ imagesDone: 2 }));
    vi.mocked(getImportJob)
      .mockResolvedValueOnce(job({ imagesDone: 2 }))
      .mockResolvedValue(job({ phase: "done", imagesDone: 8, summary: IMPORT_SUMMARY }));
    renderSettings();
    expect(await screen.findByRole("progressbar", { name: "Importing images" })).toBeInTheDocument();
    expect(await screen.findByLabelText(/choose backup file/i)).toHaveAttribute("aria-disabled", "true");
    await waitFor(() => expect(importLiveRegion()).toHaveTextContent(/imported 2 collections/i));
    expect(importData).not.toHaveBeenCalled();
  });

  it("says nothing about an import that had already finished before the page opened", async () => {
    vi.mocked(getCurrentImport).mockResolvedValue(job({ phase: "done", summary: IMPORT_SUMMARY }));
    renderSettings();
    await screen.findByLabelText(/choose backup file/i);
    await waitFor(() => expect(getCurrentImport).toHaveBeenCalled());
    expect(importLiveRegion()).toBeEmptyDOMElement();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it.each([
    ["invalid", "Import failed. Make sure you chose a valid MyCollections backup file."],
    ["server", "The server could not finish the import. Nothing from it was kept; try again."],
  ] as const)("says why a job failed (%s), with the fixed text for that reason", async (failure, text) => {
    vi.mocked(importData).mockResolvedValue({ job: job() });
    vi.mocked(getImportJob).mockResolvedValue(job({ phase: "failed", failure }));
    renderSettings();
    selectArchive(await screen.findByLabelText(/choose backup file/i));
    const data = within(await dataSection());
    expect(await data.findByRole("alert")).toHaveTextContent(text);
    expect(importLiveRegion()).toBeEmptyDOMElement();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("says the import was interrupted when the server no longer knows the job", async () => {
    vi.mocked(importData).mockResolvedValue({ job: job() });
    vi.mocked(getImportJob).mockRejectedValue(new ApiError(404));
    renderSettings();
    const input = await screen.findByLabelText(/choose backup file/i);
    selectArchive(input);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The import was interrupted, most likely by the server restarting. Nothing from it was kept; try again.",
    );
    expect(input).not.toHaveAttribute("aria-disabled");
  });

  it("announces each quarter of the way through, not every image, and not the end", async () => {
    vi.mocked(importData).mockResolvedValue({ job: job() });
    vi.mocked(getImportJob)
      .mockResolvedValueOnce(job({ imagesDone: 1 }))
      .mockResolvedValueOnce(job({ imagesDone: 2 }))
      .mockResolvedValueOnce(job({ imagesDone: 3 }))
      .mockResolvedValueOnce(job({ imagesDone: 5 }))
      .mockResolvedValueOnce(job({ imagesDone: 7 }))
      .mockResolvedValue(job({ phase: "done", imagesDone: 8, summary: IMPORT_SUMMARY }));
    renderSettings();
    selectArchive(await screen.findByLabelText(/choose backup file/i));
    await waitFor(() => expect(importLiveRegion()).toHaveTextContent(/imported 2 collections/i));
    const said = Array.from(announcer().children, (node) => node.textContent).filter((text) =>
      text?.startsWith("Import"),
    );
    expect(said).toEqual(["Import 25% done", "Import 50% done", "Import 75% done"]);
  });
});

describe("SettingsPage attaching photos to items already here (#453)", () => {
  it("sends the attach mode only when the box is ticked", async () => {
    renderSettings();
    const box = await screen.findByRole("checkbox", { name: "Also add photos to items you already have" });
    expect(box).not.toBeChecked();
    const input = screen.getByLabelText(/choose backup file/i);
    const first = selectArchive(input);
    await waitFor(() => expect(importData).toHaveBeenLastCalledWith({ archive: first }, "skip"));
    await waitFor(() => expect(importLiveRegion()).toHaveTextContent(/imported/i));

    fireEvent.click(box);
    const second = selectArchive(input);
    await waitFor(() => expect(importData).toHaveBeenLastCalledWith({ archive: second }, "attach-media"));
  });

  it("reports attached images, and images left out over an item's limit", async () => {
    vi.mocked(importData).mockResolvedValue({
      summary: { ...IMPORT_SUMMARY, mediaAttached: 6, mediaOverLimit: 2 },
    });
    renderSettings();
    selectArchive(await screen.findByLabelText(/choose backup file/i));
    await waitFor(() => expect(importLiveRegion()).toHaveTextContent(/imported 2 collections/i));
    expect(importLiveRegion()).toHaveTextContent("Added 6 images to items you already had.");
    expect(importLiveRegion()).toHaveTextContent(
      "Left out 2 images whose items already hold as many images as an item may.",
    );
  });

  it("does not mention attaching or the limit when neither happened", async () => {
    renderSettings();
    selectArchive(await screen.findByLabelText(/choose backup file/i));
    await waitFor(() => expect(importLiveRegion()).toHaveTextContent(/imported 2 collections/i));
    expect(importLiveRegion()).not.toHaveTextContent(/added|left out/i);
  });
});
