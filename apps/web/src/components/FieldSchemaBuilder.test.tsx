import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../i18n/index.js";
import { AnnouncerProvider } from "../lib/announcer.js";
import { type FieldDraft, FieldSchemaBuilder } from "./FieldSchemaBuilder.js";

afterEach(cleanup);

function draft(key: string, label: string): FieldDraft {
  return { key, label, type: "text", required: false, optionsText: "" };
}

function Harness({ initial }: { initial: FieldDraft[] }) {
  const [fields, setFields] = useState(initial);
  return <FieldSchemaBuilder fields={fields} onChange={setFields} />;
}

function NoFields({ error }: { error?: string }) {
  const [fields, setFields] = useState<FieldDraft[]>([]);
  return <FieldSchemaBuilder fields={fields} onChange={setFields} noFieldsError={error} />;
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

  // The server refuses a field without a label (core: `label: z.string().min(1)`),
  // and the forms used to drop such rows — or, with no labelled row at all,
  // refuse the submit without a word (#42).
  describe("a field's label", () => {
    it("is required, so an empty one stops the submit at that row", () => {
      render(<Harness initial={[draft("a", "Title"), draft("b", "")]} />);
      const [title, blank] = labelInputs() as [HTMLInputElement, HTMLInputElement];
      expect(title).toBeRequired();
      expect(title).toBeValid();
      expect(blank).toBeRequired();
      expect(blank).toBeInvalid();
      expect(blank.validity.valueMissing).toBe(true);
    });

    it("of only spaces is marked invalid, saying why", () => {
      render(<Harness initial={[draft("a", "Title")]} />);
      const [label] = labelInputs() as [HTMLInputElement];
      fireEvent.change(label, { target: { value: "   " } });
      expect(label).toBeInvalid();
      expect(label.validationMessage).toBe("Enter a label for this field.");

      fireEvent.change(label, { target: { value: " Year " } });
      expect(label).toBeValid();
    });
  });

  describe("with no field left", () => {
    it("shows nothing until the form says the submit was refused", () => {
      render(<NoFields />);
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Add field" })).not.toHaveAccessibleDescription();
    });

    it("says why at Add field, the control that fixes it", () => {
      render(<NoFields error="A collection needs at least one field. Add one to continue." />);
      expect(screen.getByRole("alert")).toHaveTextContent(
        "A collection needs at least one field. Add one to continue.",
      );
      expect(screen.getByRole("button", { name: "Add field" })).toHaveAccessibleDescription(
        "A collection needs at least one field. Add one to continue.",
      );
    });
  });

  // #377: a sighted user sees the row appear or go; a screen-reader user was
  // only ever moved, and had to infer the rest.
  describe("announces", () => {
    function announced(initial: FieldDraft[]) {
      const announce = vi.fn();
      render(
        <AnnouncerProvider value={announce}>
          <Harness initial={initial} />
        </AnnouncerProvider>,
      );
      return announce;
    }

    it("a removal, naming the field", () => {
      const announce = announced([draft("a", "Title"), draft("b", "Year")]);
      fireEvent.click(screen.getAllByRole("button", { name: "Remove field" })[1] as HTMLElement);
      expect(announce.mock.calls).toEqual([["Removed field “Year”"]]);
    });

    it("a removal of a field with no label yet, without an empty name", () => {
      const announce = announced([draft("a", "Title"), draft("b", "   ")]);
      fireEvent.click(screen.getAllByRole("button", { name: "Remove field" })[1] as HTMLElement);
      expect(announce.mock.calls).toEqual([["Removed a field"]]);
    });

    it("a removal by the label as it reads, not padded with spaces", () => {
      const announce = announced([draft("a", "  Title ")]);
      fireEvent.click(screen.getByRole("button", { name: "Remove field" }));
      expect(announce.mock.calls).toEqual([["Removed field “Title”"]]);
    });

    it("an addition", () => {
      const announce = announced([draft("a", "Title")]);
      fireEvent.click(screen.getByRole("button", { name: "Add field" }));
      expect(labelInputs()).toHaveLength(2);
      expect(announce.mock.calls).toEqual([["Added a field"]]);
    });
  });
});
