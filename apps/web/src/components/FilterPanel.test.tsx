import type { FieldDefinition, ItemFilter } from "@mycollections/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../i18n/index.js";

vi.mock("../lib/api-client.js", () => ({ getTagValues: vi.fn() }));

import { getTagValues } from "../lib/api-client.js";
import { AppliedFilters, FilterPanel } from "./FilterPanel.js";

const FIELDS: FieldDefinition[] = [
  { id: "title", type: "text", label: "Title", required: true },
  { id: "genre", type: "select", label: "Genre", required: false, options: ["Jazz", "Blues"] },
  { id: "tags", type: "tags", label: "Tags", required: false },
  { id: "year", type: "number", label: "Year", required: false },
  { id: "boxed", type: "boolean", label: "Boxed", required: false },
];

function wrap(children: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.mocked(getTagValues).mockResolvedValue({
    values: [
      { value: "signed", count: 3 },
      { value: "mono", count: 1 },
    ],
    truncated: false,
  });
});
afterEach(cleanup);

function toggle() {
  return screen.getByRole("button", { name: /^Filters/ });
}

describe("FilterPanel (#41)", () => {
  it("is a disclosure: closed, then open with one facet per filterable field and no text field", async () => {
    render(wrap(<FilterPanel collectionId="c1" fields={FIELDS} filters={[]} onApply={vi.fn()} />));
    expect(toggle()).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("group", { name: "Genre" })).not.toBeInTheDocument();

    fireEvent.click(toggle());
    expect(toggle()).toHaveAttribute("aria-expanded", "true");
    const form = screen.getByRole("form", { name: "Filters" });
    expect(toggle()).toHaveAttribute("aria-controls", form.id);
    expect(within(form).getByRole("group", { name: "Genre" })).toBeInTheDocument();
    expect(within(form).getByRole("group", { name: "Year" })).toBeInTheDocument();
    expect(within(form).getByRole("group", { name: "Boxed" })).toBeInTheDocument();
    expect(within(form).queryByRole("group", { name: "Title" })).not.toBeInTheDocument();
    // Tag choices come from the collection's tags in use.
    expect(await within(form).findByRole("checkbox", { name: "signed" })).toBeInTheDocument();
    expect(vi.mocked(getTagValues)).toHaveBeenCalledWith("c1", "tags");
  });

  it("applies what was ticked and typed only when Apply is pressed", async () => {
    const onApply = vi.fn();
    render(wrap(<FilterPanel collectionId="c1" fields={FIELDS} filters={[]} onApply={onApply} />));
    fireEvent.click(toggle());

    fireEvent.click(screen.getByRole("checkbox", { name: "Jazz" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: "Minimum" }), { target: { value: "1959" } });
    fireEvent.click(screen.getByRole("radio", { name: "No" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: "signed" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "mono" }));
    fireEvent.click(screen.getByRole("radio", { name: "All of these" }));
    expect(onApply).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Apply filters" }));
    expect(onApply).toHaveBeenCalledWith([
      { field: "genre", op: "in", value: ["Jazz"] },
      { field: "tags", op: "all", value: ["signed", "mono"] },
      { field: "year", op: "gte", value: 1959 },
      { field: "boxed", op: "eq", value: false },
    ]);
  });

  it("shows the filters in force, and follows them when they change from outside", () => {
    const applied: ItemFilter[] = [{ field: "genre", op: "in", value: ["Blues"] }];
    const { rerender } = render(
      wrap(<FilterPanel collectionId="c1" fields={FIELDS} filters={applied} onApply={vi.fn()} />),
    );
    expect(toggle()).toHaveTextContent("Filters (1 applied)");
    fireEvent.click(toggle());
    expect(screen.getByRole("checkbox", { name: "Blues" })).toBeChecked();

    rerender(wrap(<FilterPanel collectionId="c1" fields={FIELDS} filters={[]} onApply={vi.fn()} />));
    expect(screen.getByRole("checkbox", { name: "Blues" })).not.toBeChecked();
  });

  it("refuses more choices than the API accepts, saying so instead of sending them", async () => {
    const many = Array.from({ length: 21 }, (_, i) => ({ value: `t${i}`, count: 1 }));
    vi.mocked(getTagValues).mockResolvedValue({ values: many, truncated: false });
    const onApply = vi.fn();
    render(wrap(<FilterPanel collectionId="c1" fields={FIELDS} filters={[]} onApply={onApply} />));
    fireEvent.click(toggle());
    await screen.findByRole("checkbox", { name: "t0" });
    for (const { value } of many) fireEvent.click(screen.getByRole("checkbox", { name: value }));
    fireEvent.click(screen.getByRole("button", { name: "Apply filters" }));
    expect(onApply).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/more than can be applied/));
  });
});

describe("FilterPanel limits (#41)", () => {
  it("refuses filters whose encoded URL would be too long for the server to accept", async () => {
    const long = Array.from({ length: 12 }, (_, i) => ({ value: `${"€".repeat(150)}${i}`, count: 1 }));
    vi.mocked(getTagValues).mockResolvedValue({ values: long, truncated: false });
    const onApply = vi.fn();
    render(wrap(<FilterPanel collectionId="c1" fields={FIELDS} filters={[]} onApply={onApply} />));
    fireEvent.click(toggle());
    await screen.findByRole("checkbox", { name: long[0]?.value });
    for (const { value } of long) fireEvent.click(screen.getByRole("checkbox", { name: value }));
    fireEvent.click(screen.getByRole("button", { name: "Apply filters" }));
    expect(onApply).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/more than can be applied/));
  });
});

describe("FilterPanel review cases (#41)", () => {
  it("keeps unsaved ticks in other facets when a filter is removed from outside", () => {
    const applied: ItemFilter[] = [{ field: "year", op: "gte", value: 1959 }];
    const { rerender } = render(
      wrap(<FilterPanel collectionId="c1" fields={FIELDS} filters={applied} onApply={vi.fn()} />),
    );
    fireEvent.click(toggle());
    fireEvent.click(screen.getByRole("checkbox", { name: "Jazz" }));
    rerender(wrap(<FilterPanel collectionId="c1" fields={FIELDS} filters={[]} onApply={vi.fn()} />));
    expect(screen.getByRole("checkbox", { name: "Jazz" })).toBeChecked();
    expect(screen.getByRole("spinbutton", { name: "Minimum" })).toHaveValue(null);
  });

  it("says the tags are loading, and that they could not be loaded, rather than that there are none", async () => {
    let fail: (reason: Error) => void = () => {};
    vi.mocked(getTagValues).mockReturnValue(new Promise((_resolve, reject) => (fail = reject)));
    render(wrap(<FilterPanel collectionId="c1" fields={FIELDS} filters={[]} onApply={vi.fn()} />));
    fireEvent.click(toggle());
    const tags = screen.getByRole("group", { name: "Tags" });
    expect(within(tags).getByText("Loading tags…")).toBeInTheDocument();
    expect(within(tags).queryByText("No tags in use yet.")).not.toBeInTheDocument();
    fail(new Error("down"));
    expect(await within(tags).findByRole("alert")).toHaveTextContent("Could not load the tags in use.");
  });

  it("keeps offering a tag it showed, even once a refetch no longer lists it", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <FilterPanel collectionId="c1" fields={FIELDS} filters={[]} onApply={vi.fn()} />
      </QueryClientProvider>,
    );
    fireEvent.click(toggle());
    const mono = await screen.findByRole("checkbox", { name: "mono" });
    mono.focus();
    vi.mocked(getTagValues).mockResolvedValue({ values: [{ value: "signed", count: 3 }], truncated: false });
    await qc.invalidateQueries();
    await waitFor(() => expect(vi.mocked(getTagValues)).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("checkbox", { name: "mono" })).toHaveFocus();
  });
});

describe("AppliedFilters (#41)", () => {
  it("names each filter on a button that removes it, and offers Clear filters", () => {
    const onRemove = vi.fn();
    const onClear = vi.fn();
    render(
      <AppliedFilters
        fields={FIELDS}
        filters={[
          { field: "genre", op: "in", value: ["Jazz", "Blues"] },
          { field: "year", op: "gte", value: 1959 },
          { field: "boxed", op: "empty" },
        ]}
        onRemove={onRemove}
        onClear={onClear}
      />,
    );
    const list = screen.getByRole("list", { name: "Applied filters" });
    expect(
      within(list)
        .getAllByRole("button")
        .map((b) => b.getAttribute("aria-label")),
    ).toEqual(["Remove filter Genre: Jazz, Blues", "Remove filter Year: from 1959", "Remove filter Boxed: not set"]);
    fireEvent.click(within(list).getByRole("button", { name: "Remove filter Year: from 1959" }));
    expect(onRemove).toHaveBeenCalledWith(1);
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(onClear).toHaveBeenCalled();
  });

  it("renders nothing while no filter applies", () => {
    const { container } = render(<AppliedFilters fields={FIELDS} filters={[]} onRemove={vi.fn()} onClear={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});
