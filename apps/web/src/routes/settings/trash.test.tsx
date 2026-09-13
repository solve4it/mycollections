import type { Collection, DeletedItem } from "@mycollections/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rootRoute } from "../__root.js";
import { setupRoute } from "../setup/index.js";
import { settingsRoute } from "./index.js";

vi.mock("../../lib/api-client.js", () => ({
  clearToken: vi.fn(),
  getToken: vi.fn(() => "test-token"),
  isTokenSessionOnly: vi.fn(() => false),
  exportData: vi.fn(),
  importData: vi.fn(),
  listTrash: vi.fn(),
  restoreItem: vi.fn(),
  restoreCollection: vi.fn(),
  purgeItem: vi.fn(),
  purgeCollection: vi.fn(),
  emptyTrash: vi.fn(),
}));

import {
  emptyTrash,
  listTrash,
  purgeCollection,
  purgeItem,
  restoreCollection,
  restoreItem,
} from "../../lib/api-client.js";

const testRouteTree = rootRoute.addChildren([settingsRoute, setupRoute]);

const RECORDS: Collection = {
  id: "col-records",
  name: "Records",
  description: "Vinyl",
  fields: [],
  isFiniteSet: false,
  createdAt: "2026-07-01T12:00:00.000Z",
  updatedAt: "2026-08-10T12:00:00.000Z",
  deletedAt: "2026-08-10T12:00:00.000Z",
};

const DUNE: DeletedItem = {
  id: "item-dune",
  collectionId: "col-books",
  collectionName: "Books",
  status: "owned",
  fields: { title: "Dune", author: "Frank Herbert" },
  createdAt: "2026-07-02T12:00:00.000Z",
  updatedAt: "2026-08-12T12:00:00.000Z",
  deletedAt: "2026-08-12T12:00:00.000Z",
};

function renderSettings() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const history = createMemoryHistory({ initialEntries: ["/settings"] });
  const router = createRouter({ routeTree: testRouteTree, history });
  render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

/** The trash section, so a query for "Records" cannot accidentally match elsewhere on the page. */
async function trashSection(): Promise<HTMLElement> {
  const heading = await screen.findByRole("heading", { name: "Trash" });
  const section = heading.closest("section");
  if (!section) throw new Error("Trash heading is not inside a section");
  return section;
}

/**
 * The trash section's live region (#326). Queried by class, not by role or by a
 * bare `[aria-live]`: the region carries `aria-live` and no `role="status"`, and
 * this file renders the real root route, so the shell's announcer and the Data
 * section's import region are both in the same document.
 */
function trashLiveRegion(): HTMLElement {
  const regions = document.querySelectorAll<HTMLElement>(".trash-live");
  expect(regions, "the page must own exactly one trash live region").toHaveLength(1);
  const region = regions[0];
  if (!region) throw new Error("no trash live region");
  return region;
}

/** The <li> whose text names `text`, once it has loaded. Row-scoped queries keep one row's buttons out of another's. */
async function row(text: string): Promise<HTMLElement> {
  const section = await trashSection();
  return waitFor(() => {
    const found = within(section)
      .queryAllByRole("listitem")
      .find((item) => item.textContent?.includes(text));
    if (!found) throw new Error(`no trash row for "${text}"`);
    return found;
  });
}

beforeEach(() => {
  localStorage.setItem("api_token", "test-token");
  vi.resetAllMocks();
  vi.mocked(listTrash).mockResolvedValue({ collections: [RECORDS], items: [DUNE] });
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("Settings trash listing", () => {
  it("lists a trashed collection by name, with the date it went in", async () => {
    renderSettings();
    const records = await row("Records");
    expect(records).toHaveTextContent("Records");
    expect(records).toHaveTextContent("Deleted Aug 10, 2026");
  });

  it("names a trashed item by its first filled field and says which collection it came from", async () => {
    renderSettings();
    const dune = await row("Dune");
    expect(dune).toHaveTextContent("Dune");
    expect(dune).toHaveTextContent("in Books");
  });

  it("says the trash is empty rather than showing bare headings", async () => {
    vi.mocked(listTrash).mockResolvedValue({ collections: [], items: [] });
    renderSettings();
    const section = await trashSection();
    await waitFor(() => expect(section).toHaveTextContent("The trash is empty."));
    expect(within(section).queryByRole("listitem")).not.toBeInTheDocument();
  });

  it("reports a failed load instead of showing it as empty", async () => {
    vi.mocked(listTrash).mockRejectedValue(new Error("500"));
    renderSettings();
    const section = await trashSection();
    await waitFor(() => expect(within(section).getByRole("alert")).toHaveTextContent(/could not load the trash/i));
    expect(section).not.toHaveTextContent("The trash is empty.");
  });
});

describe("Settings trash restore", () => {
  it("restores a collection through the collection route", async () => {
    renderSettings();
    const records = await row("Records");
    fireEvent.click(within(records).getByRole("button", { name: "Restore" }));
    await waitFor(() => expect(restoreCollection).toHaveBeenCalledWith("col-records"));
  });

  it("restores an item into the collection it came from", async () => {
    renderSettings();
    const dune = await row("Dune");
    fireEvent.click(within(dune).getByRole("button", { name: "Restore" }));
    await waitFor(() => expect(restoreItem).toHaveBeenCalledWith("col-books", "item-dune"));
  });

  it("drops the row once the restore lands", async () => {
    vi.mocked(restoreCollection).mockResolvedValue({ ...RECORDS, deletedAt: null });
    vi.mocked(listTrash)
      .mockResolvedValueOnce({ collections: [RECORDS], items: [DUNE] })
      .mockResolvedValue({ collections: [], items: [DUNE] });

    renderSettings();
    const records = await row("Records");
    fireEvent.click(within(records).getByRole("button", { name: "Restore" }));

    await waitFor(async () => expect(await trashSection()).not.toHaveTextContent("Records"));
  });

  it("says so when a restore fails, and keeps the row", async () => {
    vi.mocked(restoreCollection).mockRejectedValue(new Error("500"));
    renderSettings();
    const records = await row("Records");
    fireEvent.click(within(records).getByRole("button", { name: "Restore" }));
    await waitFor(() => expect(within(records).getByRole("alert")).toHaveTextContent(/could not restore/i));
    expect(records).toHaveTextContent("Records");
  });
});

describe("Settings trash permanent delete", () => {
  it("asks before destroying a collection, naming it and its contents", async () => {
    renderSettings();
    const records = await row("Records");
    fireEvent.click(within(records).getByRole("button", { name: "Delete forever" }));
    expect(within(records).getByRole("alert")).toHaveTextContent(
      "Permanently delete “Records” and every item in it? This cannot be undone.",
    );
    expect(purgeCollection).not.toHaveBeenCalled();
  });

  it("destroys the collection only after the confirmation", async () => {
    renderSettings();
    const records = await row("Records");
    fireEvent.click(within(records).getByRole("button", { name: "Delete forever" }));
    fireEvent.click(within(records).getByRole("button", { name: "Delete forever" }));
    await waitFor(() => expect(purgeCollection).toHaveBeenCalledWith("col-records"));
  });

  it("destroys an item only after the confirmation", async () => {
    renderSettings();
    const dune = await row("Dune");
    fireEvent.click(within(dune).getByRole("button", { name: "Delete forever" }));
    expect(within(dune).getByRole("alert")).toHaveTextContent("Permanently delete “Dune”? This cannot be undone.");
    fireEvent.click(within(dune).getByRole("button", { name: "Delete forever" }));
    await waitFor(() => expect(purgeItem).toHaveBeenCalledWith("item-dune"));
  });

  it("cancelling destroys nothing", async () => {
    renderSettings();
    const dune = await row("Dune");
    fireEvent.click(within(dune).getByRole("button", { name: "Delete forever" }));
    fireEvent.click(within(dune).getByRole("button", { name: "Cancel" }));
    expect(purgeItem).not.toHaveBeenCalled();
    expect(within(dune).getByRole("button", { name: "Delete forever" })).toBeInTheDocument();
  });
});

describe("Settings empty trash", () => {
  it("asks with the real counts before emptying", async () => {
    renderSettings();
    const section = await trashSection();
    fireEvent.click(await within(section).findByRole("button", { name: "Empty trash" }));
    expect(within(section).getByRole("alert")).toHaveTextContent(
      "Permanently delete 1 collection and 1 item? This cannot be undone.",
    );
    expect(emptyTrash).not.toHaveBeenCalled();
  });

  it("empties on confirmation and says what it removed", async () => {
    vi.mocked(emptyTrash).mockResolvedValue({ collections: 2, items: 5 });
    vi.mocked(listTrash)
      .mockResolvedValueOnce({ collections: [RECORDS], items: [DUNE] })
      .mockResolvedValue({ collections: [], items: [] });

    renderSettings();
    const section = await trashSection();
    fireEvent.click(await within(section).findByRole("button", { name: "Empty trash" }));
    fireEvent.click(within(section).getByRole("button", { name: "Empty trash" }));

    await waitFor(() => expect(emptyTrash).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(trashLiveRegion()).toHaveTextContent("Emptied the trash: removed 2 collections and 5 items."),
    );
  });

  it("fills a live region that was already in the document, rather than inserting one with its message inside (#326)", async () => {
    // The sequence is the whole point, so it is asserted as a sequence: a region
    // that appears already holding its text is announced by VoiceOver but
    // usually not by NVDA or JAWS, and a test that only inspected the final DOM
    // would pass against exactly that bug.
    vi.mocked(emptyTrash).mockResolvedValue({ collections: 2, items: 5 });
    vi.mocked(listTrash)
      .mockResolvedValueOnce({ collections: [RECORDS], items: [DUNE] })
      .mockResolvedValue({ collections: [], items: [] });

    renderSettings();
    const section = await trashSection();
    await within(section).findByRole("button", { name: "Empty trash" });

    const before = trashLiveRegion();
    expect(before).toHaveAttribute("aria-live", "polite");
    // No role="status" on the region: a role implies `aria-live`, so the message
    // would become the nearest live region for its own insertion and the
    // announcement would be lost rather than doubled.
    expect(before).not.toHaveAttribute("role");
    expect(before).not.toHaveAttribute("aria-atomic");
    expect(before, "the region must already be in the document, and empty").toBeEmptyDOMElement();

    fireEvent.click(within(section).getByRole("button", { name: "Empty trash" }));
    fireEvent.click(within(section).getByRole("button", { name: "Empty trash" }));

    await waitFor(() => expect(trashLiveRegion()).toHaveTextContent("Emptied the trash"));
    // Identity, not shape: a region torn down and rebuilt with the message in it
    // satisfies every "the text is there" assertion and announces nothing.
    expect(trashLiveRegion(), "the message must land in the node that was already there").toBe(before);
    // And the message inside carries no role of its own, for the same reason.
    expect(within(before).getByText(/emptied the trash/i)).not.toHaveAttribute("role");
  });

  it("keeps the live region out of the branch that swaps between loading, error, and the lists", async () => {
    // The region has to be a direct child of the section, not of the component
    // that returns three different shapes: parked inside that, it would be torn
    // down and rebuilt whenever the branch changed, losing the identity the
    // announcement depends on. Its one constant is the section itself.
    vi.mocked(listTrash).mockReturnValue(new Promise(() => {}));
    renderSettings();
    const section = await trashSection();

    const whileLoading = trashLiveRegion();
    expect(whileLoading.parentElement).toBe(section);
    expect(whileLoading).toBeEmptyDOMElement();
  });

  it("does not make the loading message a live region — it is only ever in the section's first commit (#326)", async () => {
    // `useTrash` keeps its data while it fetches again, so this branch cannot return
    // once the trash has loaded: the message is in the section's first commit or
    // not at all, and a live region that arrives with the page announces
    // nothing. The role only made page-level status queries ambiguous.
    vi.mocked(listTrash).mockReturnValue(new Promise(() => {}));
    renderSettings();
    const section = await trashSection();

    const loading = await within(section).findByText("Loading the trash…");
    expect(loading).not.toHaveAttribute("role");
    expect(loading.closest(".trash-live"), "the loading message is not inside the live region").toBeNull();
  });

  it("offers nothing to empty when the trash is already empty", async () => {
    vi.mocked(listTrash).mockResolvedValue({ collections: [], items: [] });
    renderSettings();
    const section = await trashSection();
    await waitFor(() => expect(section).toHaveTextContent("The trash is empty."));
    expect(within(section).queryByRole("button", { name: "Empty trash" })).not.toBeInTheDocument();
  });

  it("reports a failed empty", async () => {
    vi.mocked(emptyTrash).mockRejectedValue(new Error("500"));
    renderSettings();
    const section = await trashSection();
    fireEvent.click(await within(section).findByRole("button", { name: "Empty trash" }));
    fireEvent.click(within(section).getByRole("button", { name: "Empty trash" }));
    await waitFor(() => expect(within(section).getByText(/could not empty the trash/i)).toBeInTheDocument());
  });
});
