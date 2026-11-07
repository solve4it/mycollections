import type { FieldDefinition } from "@mycollections/core";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../i18n/index.js";
import { ItemSortSelect } from "./ItemSortSelect.js";

afterEach(cleanup);

const FIELDS: FieldDefinition[] = [
  { id: "title", type: "text", label: "Title", required: true },
  { id: "year", type: "number", label: "Year", required: false },
  { id: "released", type: "date", label: "Released", required: false },
  { id: "signed", type: "boolean", label: "Signed", required: false },
  { id: "tags", type: "tags", label: "Tags", required: false },
];

function select() {
  return screen.getByRole("combobox", { name: "Sort by" });
}

function optionLabels(): string[] {
  return within(select())
    .getAllByRole("option")
    .map((option) => option.textContent ?? "");
}

describe("ItemSortSelect (#41)", () => {
  it("offers the built-in orders, then each sortable field in words that fit its type", () => {
    render(<ItemSortSelect value={undefined} searching={false} fields={FIELDS} onSort={vi.fn()} />);
    expect(optionLabels()).toEqual([
      "Date added, oldest first",
      "Date added, newest first",
      "Recently updated",
      "Name, A to Z",
      "Name, Z to A",
      "Status, collected first",
      "Status, still to get first",
      "Title, A to Z",
      "Title, Z to A",
      "Year, low to high",
      "Year, high to low",
      "Released, oldest first",
      "Released, newest first",
      "Signed, no first",
      "Signed, yes first",
    ]);
    // A tags field has no single value to order by, so it is not offered.
    expect(screen.queryByText(/^Tags/)).not.toBeInTheDocument();
    expect(within(select()).getByRole("group", { name: "Year" })).toBeInTheDocument();
  });

  it("leads with Best match while a search is in force, and keeps an explicit date order", () => {
    render(<ItemSortSelect value={undefined} searching fields={FIELDS} onSort={vi.fn()} />);
    expect(optionLabels().slice(0, 3)).toEqual(["Best match", "Date added, oldest first", "Date added, newest first"]);
    expect(select()).toHaveValue("");
  });

  it("shows the sort in force and reports a new one, or none for the default", () => {
    const onSort = vi.fn();
    render(<ItemSortSelect value="-field:year" searching={false} fields={FIELDS} onSort={onSort} />);
    expect(select()).toHaveValue("-field:year");

    fireEvent.change(select(), { target: { value: "name" } });
    expect(onSort).toHaveBeenLastCalledWith("name");
    fireEvent.change(select(), { target: { value: "" } });
    expect(onSort).toHaveBeenLastCalledWith(undefined);
  });

  it("offers the status orders, shows one in force, and reports each (#42)", () => {
    const onSort = vi.fn();
    render(<ItemSortSelect value="-status" searching={false} fields={[]} onSort={onSort} />);
    expect(select()).toHaveValue("-status");
    expect(within(select()).getByRole("option", { name: "Status, still to get first" })).toHaveValue("-status");
    expect(within(select()).getByRole("option", { name: "Status, collected first" })).toHaveValue("status");

    fireEvent.change(select(), { target: { value: "status" } });
    expect(onSort).toHaveBeenLastCalledWith("status");
    fireEvent.change(select(), { target: { value: "-status" } });
    expect(onSort).toHaveBeenLastCalledWith("-status");
  });

  it("offers the status orders while searching too (#42)", () => {
    render(<ItemSortSelect value="status" searching fields={FIELDS} onSort={vi.fn()} />);
    expect(select()).toHaveValue("status");
    expect(optionLabels()).toContain("Status, still to get first");
  });

  it("takes its id from useId, so two on a screen do not share a label", () => {
    render(
      <>
        <ItemSortSelect value={undefined} searching={false} fields={FIELDS} onSort={vi.fn()} />
        <ItemSortSelect value={undefined} searching={false} fields={FIELDS} onSort={vi.fn()} />
      </>,
    );
    const [first, second] = screen.getAllByRole("combobox", { name: "Sort by" });
    expect(first?.id).toBeTruthy();
    expect(first?.id).not.toBe(second?.id);
  });
});
