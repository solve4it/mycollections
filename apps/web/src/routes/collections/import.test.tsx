import type { Collection } from "@mycollections/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rootRoute } from "../__root.js";
import { authenticatedRoute } from "../_authenticated.js";
import { importItemsRoute } from "./import.js";

/** Importing items from a CSV file into one collection (#44). */

vi.mock("../../lib/api-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api-client.js")>();
  return {
    ApiError: actual.ApiError,
    getCollection: vi.fn(),
    importItems: vi.fn(),
    getToken: vi.fn(() => "test-token"),
  };
});

import { ApiError, getCollection, importItems } from "../../lib/api-client.js";

const testRouteTree = rootRoute.addChildren([authenticatedRoute.addChildren([importItemsRoute])]);

const COLLECTION: Collection = {
  id: "11111111-1111-1111-1111-111111111111",
  name: "Books",
  fields: [
    { id: "f-title", label: "Title", type: "text", required: true },
    { id: "f-year", label: "Year", type: "number", required: false },
    { id: "f-cover", label: "Cover", type: "image", required: false },
  ],
  isFiniteSet: false,
  targetCount: null,
  itemView: "list",
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T00:00:00.000Z",
  deletedAt: null,
};

const CSV = "Title,Year,Status,Shelf\nDune,1965,wanted,A1\nEmma,eighteen,,A2\nPersuasion,,Owned,A3\n";

function renderImport() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const history = createMemoryHistory({ initialEntries: [`/collections/${COLLECTION.id}/import`] });
  const router = createRouter({ routeTree: testRouteTree, history });
  render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

async function chooseFile(text: string) {
  const input = await screen.findByLabelText("CSV file");
  fireEvent.change(input, { target: { files: [new File([text], "books.csv", { type: "text/csv" })] } });
}

const select = (name: string) => screen.getByRole("combobox", { name }) as HTMLSelectElement;
const addButton = () => screen.getByRole("button", { name: /^Add \d+ items?$/ });

beforeEach(() => {
  localStorage.setItem("api_token", "test-token");
  vi.resetAllMocks();
  vi.mocked(getCollection).mockResolvedValue(COLLECTION);
  vi.mocked(importItems).mockResolvedValue({ created: 2 });
});

afterEach(() => {
  cleanup();
});

describe("the CSV import page (#44)", () => {
  it("names the collection and says what file it takes", async () => {
    renderImport();
    expect(await screen.findByRole("heading", { level: 1, name: "Import items into Books" })).toBeInTheDocument();
    expect(screen.getByLabelText("CSV file")).toHaveAccessibleDescription(/UTF-8 CSV file whose first row names/);
    expect(screen.getByRole("link", { name: "Back to Books" })).toHaveAttribute(
      "href",
      `/collections/${COLLECTION.id}`,
    );
  });

  it("suggests a target for each column, and offers every field but images", async () => {
    renderImport();
    await chooseFile(CSV);
    const heading = await screen.findByRole("heading", { level: 2, name: "Match columns" });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(select("Title").value).toBe("field:f-title");
    expect(select("Year").value).toBe("field:f-year");
    expect(select("Status").value).toBe("status");
    expect(select("Shelf").value).toBe("skip");
    expect(
      within(select("Shelf"))
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["Don’t import", "Status", "Title", "Year"]);
    expect(select("Shelf")).toHaveAccessibleDescription("First value: A1");
  });

  it("previews what will be added and lists each skipped row with its reason", async () => {
    renderImport();
    await chooseFile(CSV);
    expect(await screen.findByText("2 rows will be added.")).toBeInTheDocument();
    expect(screen.getByText("1 row will be skipped.")).toBeInTheDocument();
    const preview = screen.getByRole("table", { name: "The first rows to be added" });
    expect(
      within(preview)
        .getAllByRole("row")
        .map((row) => row.textContent),
    ).toEqual(["RowTitleYearStatus", "1Dune1965Wanted", "3Persuasion—Owned"]);
    const skipped = screen.getByRole("list", { name: "Rows that will be skipped" });
    expect(skipped).toHaveTextContent("Row 2");
    expect(skipped).toHaveTextContent("Year: not a number");
    expect(addButton()).toHaveAccessibleName("Add 2 items");
  });

  it("sends only the rows that convert, typed", async () => {
    renderImport();
    await chooseFile(CSV);
    fireEvent.click(await screen.findByRole("button", { name: "Add 2 items" }));
    await waitFor(() => expect(importItems).toHaveBeenCalledTimes(1));
    expect(importItems).toHaveBeenCalledWith(COLLECTION.id, [
      { status: "wanted", fields: { "f-title": "Dune", "f-year": 1965 } },
      { status: "owned", fields: { "f-title": "Persuasion", "f-year": null } },
    ]);
  });

  it("refuses to import while a required field has no column, and says which", async () => {
    renderImport();
    await chooseFile(CSV);
    fireEvent.change(await screen.findByRole("combobox", { name: "Title" }), { target: { value: "skip" } });
    expect(screen.getByText("Choose a column for “Title”, which is required.")).toBeInTheDocument();
    const button = screen.getByRole("button", { name: "Add 0 items" });
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).not.toBeDisabled();
    fireEvent.click(button);
    expect(importItems).not.toHaveBeenCalled();
  });

  it("refuses a target chosen for two columns", async () => {
    renderImport();
    await chooseFile(CSV);
    fireEvent.change(await screen.findByRole("combobox", { name: "Shelf" }), { target: { value: "field:f-year" } });
    expect(screen.getByText("“Year” is chosen for more than one column. Choose it once.")).toBeInTheDocument();
    expect(select("Shelf")).toHaveAttribute("aria-invalid", "true");
    fireEvent.click(addButton());
    expect(importItems).not.toHaveBeenCalled();
  });

  it("refuses a second press while the import is on its way", async () => {
    let finish!: (value: { created: number }) => void;
    vi.mocked(importItems).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    renderImport();
    await chooseFile(CSV);
    const button = await screen.findByRole("button", { name: "Add 2 items" });
    fireEvent.click(button);
    await waitFor(() => expect(button).toHaveAttribute("aria-disabled", "true"));
    fireEvent.click(button);
    expect(importItems).toHaveBeenCalledTimes(1);
    finish({ created: 2 });
    await screen.findByRole("heading", { level: 2, name: "Added 2 items to Books." });
  });

  it("says what was added and skipped, in a heading that takes focus from the removed button", async () => {
    renderImport();
    await chooseFile(CSV);
    fireEvent.click(await screen.findByRole("button", { name: "Add 2 items" }));
    const done = await screen.findByRole("heading", { level: 2, name: "Added 2 items to Books." });
    await waitFor(() => expect(done).toHaveFocus());
    expect(screen.getByText("1 row was skipped.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Match columns" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import another file" })).toBeInTheDocument();
  });

  it.each([
    ["Title\n", "That file has no rows under its header row."],
    ['Title\n"Dune\n', "That file could not be read as CSV. Check for a quote that is never closed."],
  ])("explains a file it cannot read (%j)", async (text, message) => {
    renderImport();
    await chooseFile(text);
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(screen.queryByRole("heading", { name: "Match columns" })).not.toBeInTheDocument();
  });

  it.each([
    [413, "That import is too large for the server. Split the file and import each part."],
    [404, "This collection is no longer here. It may have been moved to the trash."],
    [400, "The collection’s fields changed. Choose the file again to check it against them."],
    [500, "The import failed and nothing was added. Please try again."],
  ])("explains a refused import (%i) and keeps the rows to try again", async (status, message) => {
    vi.mocked(importItems).mockRejectedValue(new ApiError(status));
    renderImport();
    await chooseFile(CSV);
    fireEvent.click(await screen.findByRole("button", { name: "Add 2 items" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(screen.getByRole("button", { name: "Add 2 items" })).not.toHaveAttribute("aria-disabled");
  });
});
