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
      expect(within(section).getByRole("status")).toHaveTextContent(
        "Emptied the trash: removed 2 collections and 5 items.",
      ),
    );
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
