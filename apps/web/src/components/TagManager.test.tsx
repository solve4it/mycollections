import type { FieldDefinition } from "@mycollections/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../i18n/index.js";

vi.mock("../lib/api-client.js", () => ({ getTagValues: vi.fn(), renameTag: vi.fn(), removeTag: vi.fn() }));

import { AnnouncerProvider } from "../lib/announcer.js";
import { getTagValues, removeTag, renameTag } from "../lib/api-client.js";
import { TagManager } from "./TagManager.js";

const FIELDS: FieldDefinition[] = [
  { id: "title", type: "text", label: "Title", required: true },
  { id: "tags", type: "tags", label: "Tags", required: false },
];

let tags: { value: string; count: number }[];
const announce = vi.fn();

function renderManager() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <AnnouncerProvider value={announce}>
        <TagManager collectionId="c1" fields={FIELDS} />
      </AnnouncerProvider>
    </QueryClientProvider>,
  );
}

function rowNames(): string[] {
  return screen.getAllByRole("button", { name: /^Rename “/ }).map((b) => b.getAttribute("aria-label") ?? "");
}

beforeEach(() => {
  announce.mockReset();
  tags = [
    { value: "signed", count: 3 },
    { value: "mono", count: 2 },
    { value: "promo", count: 1 },
  ];
  vi.mocked(getTagValues).mockImplementation(async (_c, _f, q) => ({
    values: q ? tags.filter((t) => t.value.includes(q)) : tags,
    truncated: false,
  }));
});
afterEach(cleanup);

describe("TagManager (#41)", () => {
  it("lists the tags in use for each tags field, with how many items carry each", async () => {
    renderManager();
    const section = await screen.findByRole("region", { name: "Tags in use: Tags" });
    expect(await within(section).findByText("3 items")).toBeInTheDocument();
    expect(rowNames()).toEqual(["Rename “signed”", "Rename “mono”", "Rename “promo”"]);
    expect(within(section).getByRole("button", { name: "Remove “signed”" })).toBeInTheDocument();
  });

  it("renames in a form of its own, then hands focus to the renamed tag and says what changed", async () => {
    vi.mocked(renameTag).mockImplementation(async () => {
      tags = [
        { value: "autographed", count: 3 },
        { value: "mono", count: 2 },
        { value: "promo", count: 1 },
      ];
      return { updated: 3, trashed: 0, merged: false };
    });
    renderManager();
    const rename = await screen.findByRole("button", { name: "Rename “signed”" });
    rename.focus();
    fireEvent.click(rename);

    const input = screen.getByRole("textbox", { name: "New name for “signed”" });
    expect(input).toHaveFocus();
    expect(input).toHaveValue("signed");
    fireEvent.change(input, { target: { value: "autographed" } });
    fireEvent.submit(input);

    await waitFor(() =>
      expect(vi.mocked(renameTag)).toHaveBeenCalledWith("c1", { field: "tags", from: "signed", to: "autographed" }),
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "Rename “autographed”" })).toHaveFocus());
    expect(announce).toHaveBeenCalledWith("Renamed “signed” to “autographed” on 3 items");
  });

  it("says it merged when the new name is a tag already in use, and focus goes to that tag", async () => {
    vi.mocked(renameTag).mockImplementation(async () => {
      tags = [
        { value: "signed", count: 4 },
        { value: "mono", count: 2 },
      ];
      return { updated: 1, trashed: 0, merged: true };
    });
    renderManager();
    fireEvent.click(await screen.findByRole("button", { name: "Rename “promo”" }));
    const input = screen.getByRole("textbox", { name: "New name for “promo”" });
    fireEvent.change(input, { target: { value: "Signed" } });
    fireEvent.submit(input);
    await waitFor(() => expect(screen.getByRole("button", { name: "Rename “signed”" })).toHaveFocus());
    expect(announce).toHaveBeenCalledWith("Merged “promo” into “Signed” on 1 item");
  });

  it("refuses a comma before sending, and Escape cancels back to Rename", async () => {
    renderManager();
    const rename = await screen.findByRole("button", { name: "Rename “mono”" });
    rename.focus();
    fireEvent.click(rename);
    const input = screen.getByRole("textbox", { name: "New name for “mono”" });
    fireEvent.change(input, { target: { value: "rock, pop" } });
    fireEvent.submit(input);
    expect(vi.mocked(renameTag)).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("A tag cannot contain a comma.");

    fireEvent.keyDown(input, { key: "Escape" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Rename “mono”" })).toHaveFocus());
  });

  it("removes after confirming, hands focus to the tag in its place, and says how many items changed", async () => {
    vi.mocked(removeTag).mockImplementation(async () => {
      tags = tags.filter((t) => t.value !== "mono");
      return { updated: 2, trashed: 0 };
    });
    renderManager();
    const remove = await screen.findByRole("button", { name: "Remove “mono”" });
    remove.focus();
    fireEvent.click(remove);
    // The confirm carries the same name as the trigger (ConfirmButton's
    // accessibleLabel); its visible label, "Remove", sits inside that name.
    expect(screen.getByText("Remove “mono” from 2 items? This cannot be undone.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove “mono”" }));

    await waitFor(() => expect(vi.mocked(removeTag)).toHaveBeenCalledWith("c1", { field: "tags", value: "mono" }));
    await waitFor(() => expect(rowNames()).toEqual(["Rename “signed”", "Rename “promo”"]));
    await waitFor(() => expect(screen.getByRole("button", { name: "Rename “promo”" })).toHaveFocus());
    expect(announce).toHaveBeenCalledWith("Removed “mono” from 2 items");
  });

  it("finds a tag by part of its name", async () => {
    renderManager();
    await screen.findByRole("button", { name: "Rename “signed”" });
    fireEvent.change(screen.getByRole("searchbox", { name: "Find a tag in Tags" }), { target: { value: "pro" } });
    await waitFor(() => expect(rowNames()).toEqual(["Rename “promo”"]));
    expect(vi.mocked(getTagValues)).toHaveBeenLastCalledWith("c1", "tags", "pro");
  });

  it("says when only the most used tags are shown", async () => {
    vi.mocked(getTagValues).mockResolvedValue({ values: tags, truncated: true });
    renderManager();
    expect(await screen.findByText(/Showing the 50 most used tags/)).toBeInTheDocument();
  });

  it("renders nothing for a collection with no tags field", () => {
    const qc = new QueryClient();
    const { container } = render(
      <QueryClientProvider client={qc}>
        <TagManager collectionId="c1" fields={[FIELDS[0] as FieldDefinition]} />
      </QueryClientProvider>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("hands focus to the search box when the renamed tag is no longer in the list it was found in", async () => {
    vi.mocked(renameTag).mockImplementation(async () => {
      tags = [
        { value: "autographed", count: 3 },
        { value: "mono", count: 2 },
      ];
      return { updated: 3, trashed: 0, merged: false };
    });
    renderManager();
    await screen.findByRole("button", { name: "Rename “signed”" });
    const search = screen.getByRole("searchbox", { name: "Find a tag in Tags" });
    fireEvent.change(search, { target: { value: "sig" } });
    await waitFor(() => expect(rowNames()).toEqual(["Rename “signed”"]));
    fireEvent.click(screen.getByRole("button", { name: "Rename “signed”" }));
    const input = screen.getByRole("textbox", { name: "New name for “signed”" });
    fireEvent.change(input, { target: { value: "autographed" } });
    fireEvent.submit(input);
    await waitFor(() => expect(search).toHaveFocus());
    expect(announce).toHaveBeenCalledWith("Renamed “signed” to “autographed” on 3 items");
  });

  it("takes the server's word for a merge, even when the tag joined is not in view", async () => {
    vi.mocked(renameTag).mockResolvedValue({ updated: 1, trashed: 0, merged: true });
    renderManager();
    fireEvent.click(await screen.findByRole("button", { name: "Rename “promo”" }));
    const input = screen.getByRole("textbox", { name: "New name for “promo”" });
    fireEvent.change(input, { target: { value: "elsewhere" } });
    fireEvent.submit(input);
    await waitFor(() => expect(announce).toHaveBeenCalledWith("Merged “promo” into “elsewhere” on 1 item"));
  });

  it("saving the name unchanged tidies the other spellings, and says so", async () => {
    vi.mocked(renameTag).mockResolvedValue({ updated: 2, trashed: 0, merged: false });
    renderManager();
    fireEvent.click(await screen.findByRole("button", { name: "Rename “signed”" }));
    fireEvent.submit(screen.getByRole("textbox", { name: "New name for “signed”" }));
    await waitFor(() =>
      expect(vi.mocked(renameTag)).toHaveBeenCalledWith("c1", { field: "tags", from: "signed", to: "signed" }),
    );
    await waitFor(() => expect(announce).toHaveBeenCalledWith("Made “signed” the one spelling on 2 items"));
  });

  it("counts trashed items apart from the live ones the prompt asked about", async () => {
    vi.mocked(removeTag).mockImplementation(async () => {
      tags = tags.filter((t) => t.value !== "promo");
      return { updated: 1, trashed: 2 };
    });
    renderManager();
    fireEvent.click(await screen.findByRole("button", { name: "Remove “promo”" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove “promo”" }));
    await waitFor(() =>
      expect(announce).toHaveBeenCalledWith("Removed “promo” from 1 item, and from 2 items in the trash"),
    );
  });

  it("holds other tag actions while one is in flight, so none loses its result", async () => {
    let finish: () => void = () => {};
    vi.mocked(renameTag).mockReturnValue(
      new Promise((resolve) => {
        finish = () => resolve({ updated: 3, trashed: 0, merged: false });
      }),
    );
    renderManager();
    fireEvent.click(await screen.findByRole("button", { name: "Rename “signed”" }));
    const input = screen.getByRole("textbox", { name: "New name for “signed”" });
    fireEvent.change(input, { target: { value: "x" } });
    fireEvent.submit(input);
    await waitFor(() => expect(vi.mocked(renameTag)).toHaveBeenCalled());

    const other = screen.getByRole("button", { name: "Rename “mono”" });
    expect(other).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(other);
    expect(screen.queryByRole("textbox", { name: "New name for “mono”" })).not.toBeInTheDocument();
    finish();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Rename “mono”" })).not.toHaveAttribute("aria-disabled"),
    );
  });
});
