import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import "../i18n/index.js";
import { type FieldDraft, FieldSchemaBuilder } from "./FieldSchemaBuilder.js";

afterEach(cleanup);

function draft(key: string, label: string): FieldDraft {
  return { key, label, type: "text", required: false, optionsText: "" };
}

function Harness({ initial }: { initial: FieldDraft[] }) {
  const [fields, setFields] = useState(initial);
  return <FieldSchemaBuilder fields={fields} onChange={setFields} />;
}

const labelInputs = () => screen.getAllByRole("textbox", { name: "Field label" }) as HTMLInputElement[];

describe("FieldSchemaBuilder", () => {
  // #369: ids were keyed by array index while React keys rows by field key, so
  // removing a row renumbered the ids underneath every row that survived it.
  it("keeps a surviving row's ids when an earlier row is removed", () => {
    render(<Harness initial={[draft("a", "Title"), draft("b", "Year"), draft("c", "Signed")]} />);
    const year = labelInputs()[1] as HTMLInputElement;
    expect(year).toHaveValue("Year");
    const idBefore = year.id;

    fireEvent.click(screen.getAllByRole("button", { name: "Remove field" })[0] as HTMLElement);

    expect(labelInputs().map((input) => input.value)).toEqual(["Year", "Signed"]);
    expect(year.id).toBe(idBefore);
    expect(screen.getAllByRole("textbox", { name: "Field label" })[0]).toBe(year);
  });

  it("keeps two builders on one screen from sharing ids", () => {
    render(
      <>
        <section aria-label="First">
          <Harness initial={[draft("a", "Title")]} />
        </section>
        <section aria-label="Second">
          <Harness initial={[draft("a", "Name")]} />
        </section>
      </>,
    );
    const first = screen.getByRole("region", { name: "First" });
    const second = screen.getByRole("region", { name: "Second" });
    expect(within(first).getByRole("textbox", { name: "Field label" })).toHaveValue("Title");
    expect(within(second).getByRole("textbox", { name: "Field label" })).toHaveValue("Name");
    expect(within(first).getByRole("combobox", { name: "Field type" })).toBeInTheDocument();
    expect(within(second).getByRole("combobox", { name: "Field type" })).toBeInTheDocument();
    expect(within(second).getByRole("checkbox", { name: "Required" })).toBeInTheDocument();

    const ids = Array.from(document.querySelectorAll("[id]"), (el) => el.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // Field ids are any non-empty string (core's schema), so a collection that
  // came in through the API or an import can have one with a space in it. An
  // id is whitespace-free by definition, and `aria-describedby` is a
  // space-separated list — a raw key would split the reference and drop the hint.
  it("keeps the locked-type hint attached when a field key contains a space", () => {
    render(
      <FieldSchemaBuilder
        fields={[draft("release year", "Year"), draft("release_year", "Also year")]}
        onChange={() => {}}
        lockedTypeKeys={new Set(["release year", "release_year"])}
        lockedTypeHint="This field already has values."
      />,
    );
    const types = screen.getAllByRole("combobox", { name: "Field type" });
    expect(types).toHaveLength(2);
    for (const type of types) {
      expect(type).toHaveAccessibleDescription("This field already has values.");
    }
    expect(labelInputs().map((input) => input.value)).toEqual(["Year", "Also year"]);
    for (const el of document.querySelectorAll("[id]")) expect(el.id).not.toMatch(/\s/);
  });

  // One row's type select and another row's lock hint must not share an id when
  // the keys are chosen so that part-plus-key spells the same string.
  it("keeps ids unique when one key is another prefixed with a part name", () => {
    render(
      <FieldSchemaBuilder
        fields={[draft("hint-foo", "First"), draft("foo", "Second")]}
        onChange={() => {}}
        lockedTypeKeys={new Set(["hint-foo", "foo"])}
        lockedTypeHint="This field already has values."
      />,
    );
    for (const type of screen.getAllByRole("combobox", { name: "Field type" })) {
      expect(type).toHaveAccessibleDescription("This field already has values.");
    }
    const ids = Array.from(document.querySelectorAll("[id]"), (el) => el.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // The Remove field handoff (#367) used to find its destination by positional
  // id; it now names the successor by key, and must land in the same places.
  it("hands focus to the next row's label when a middle row is removed", async () => {
    render(<Harness initial={[draft("a", "Title"), draft("b", "Year"), draft("c", "Signed")]} />);
    const remove = screen.getAllByRole("button", { name: "Remove field" })[1] as HTMLElement;
    remove.focus();
    fireEvent.click(remove);

    await waitFor(() => expect(document.activeElement).toHaveValue("Signed"));
    expect(labelInputs().map((input) => input.value)).toEqual(["Title", "Signed"]);
  });

  it("hands focus to Add field when the last row is removed", async () => {
    render(<Harness initial={[draft("a", "Title"), draft("b", "Year")]} />);
    const remove = screen.getAllByRole("button", { name: "Remove field" })[1] as HTMLElement;
    remove.focus();
    fireEvent.click(remove);

    await waitFor(() => expect(screen.getByRole("button", { name: "Add field" })).toHaveFocus());
  });
});
