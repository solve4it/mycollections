import type { FieldDefinition } from "@mycollections/core";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../i18n/index.js";
import { DynamicItemForm } from "./DynamicItemForm.js";

afterEach(cleanup);

const FIELDS: FieldDefinition[] = [
  { id: "title", label: "Title", type: "text", required: true },
  { id: "year", label: "Year", type: "number", required: false },
  { id: "owned", label: "Owned", type: "boolean", required: false },
  { id: "platform", label: "Platform", type: "select", required: false, options: ["PC", "Switch"] },
  { id: "labels", label: "Labels", type: "tags", required: false },
];

describe("DynamicItemForm", () => {
  it("renders a status selector defaulting to owned", () => {
    render(<DynamicItemForm fields={FIELDS} onSubmit={vi.fn()} />);
    const status = screen.getByLabelText(/status/i);
    expect(status).toHaveValue("owned");
  });

  it("renders an input for each field labelled by its label", () => {
    render(<DynamicItemForm fields={FIELDS} onSubmit={vi.fn()} />);
    expect(screen.getByLabelText("Title")).toBeInTheDocument();
    expect(screen.getByLabelText("Year")).toBeInTheDocument();
    expect(screen.getByLabelText("Owned")).toBeInTheDocument();
    expect(screen.getByLabelText("Platform")).toBeInTheDocument();
    expect(screen.getByLabelText("Labels")).toBeInTheDocument();
  });

  it("renders a number input for number fields", () => {
    render(<DynamicItemForm fields={FIELDS} onSubmit={vi.fn()} />);
    expect(screen.getByLabelText("Year")).toHaveAttribute("type", "number");
  });

  it("renders a checkbox for boolean fields", () => {
    render(<DynamicItemForm fields={FIELDS} onSubmit={vi.fn()} />);
    expect(screen.getByLabelText("Owned")).toHaveAttribute("type", "checkbox");
  });

  it("renders select options for select fields", () => {
    render(<DynamicItemForm fields={FIELDS} onSubmit={vi.fn()} />);
    expect(screen.getByRole("option", { name: "PC" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Switch" })).toBeInTheDocument();
  });

  it("submits typed field values keyed by field id", () => {
    const onSubmit = vi.fn();
    render(<DynamicItemForm fields={FIELDS} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Zelda" } });
    fireEvent.change(screen.getByLabelText("Year"), { target: { value: "2017" } });
    fireEvent.click(screen.getByLabelText("Owned"));
    fireEvent.change(screen.getByLabelText("Platform"), { target: { value: "Switch" } });
    fireEvent.change(screen.getByLabelText("Labels"), { target: { value: "rpg, classic" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith({
      status: "owned",
      fields: {
        title: "Zelda",
        year: 2017,
        owned: true,
        platform: "Switch",
        labels: ["rpg", "classic"],
      },
    });
  });

  it("changes status when a different status is selected", () => {
    const onSubmit = vi.fn();
    render(<DynamicItemForm fields={[FIELDS[0] as FieldDefinition]} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "X" } });
    fireEvent.change(screen.getByLabelText(/status/i), { target: { value: "wanted" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(onSubmit).toHaveBeenCalledWith({ status: "wanted", fields: { title: "X" } });
  });

  it("pre-fills values when editing an existing item", () => {
    render(
      <DynamicItemForm
        fields={FIELDS}
        initialStatus="wanted"
        initialValues={{ title: "Mario", year: 1985 }}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Title")).toHaveValue("Mario");
    expect(screen.getByLabelText("Year")).toHaveValue(1985);
    expect(screen.getByLabelText(/status/i)).toHaveValue("wanted");
  });

  // R16 (#42): the add-item form under the Remaining tab starts on Wanted, so
  // the item a user adds there lands in the tab they are looking at. The page
  // changes the prop when the tab changes; the form follows it, and so does a
  // reset after a save.
  it("follows a change of initialStatus, and resets back to it after a save", () => {
    const onSubmit = vi.fn();
    const title = [FIELDS[0] as FieldDefinition];
    const { rerender } = render(<DynamicItemForm fields={title} onSubmit={onSubmit} resetSignal={0} />);
    expect(screen.getByLabelText(/status/i)).toHaveValue("owned");

    rerender(<DynamicItemForm fields={title} onSubmit={onSubmit} initialStatus="wanted" resetSignal={0} />);
    expect(screen.getByLabelText(/status/i)).toHaveValue("wanted");

    // A status the user chose themselves is theirs until the tab changes again.
    fireEvent.change(screen.getByLabelText(/status/i), { target: { value: "ordered" } });
    rerender(<DynamicItemForm fields={title} onSubmit={onSubmit} initialStatus="wanted" resetSignal={0} />);
    expect(screen.getByLabelText(/status/i)).toHaveValue("ordered");
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Penny" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(onSubmit).toHaveBeenLastCalledWith({ status: "ordered", fields: { title: "Penny" } });

    rerender(<DynamicItemForm fields={title} onSubmit={onSubmit} initialStatus="wanted" resetSignal={1} />);
    expect(screen.getByLabelText(/status/i)).toHaveValue("wanted");

    rerender(<DynamicItemForm fields={title} onSubmit={onSubmit} resetSignal={1} />);
    expect(screen.getByLabelText(/status/i)).toHaveValue("owned");
  });

  // #369: the collection screen renders two of these at once — the add-item
  // form and a row's editor — built from the same fields. With hardcoded ids,
  // `<label for>` resolved both labels to the first instance in tree order, so
  // one form's controls were named twice ("Title Title") and the other's not at
  // all. Asserted on the computed names, which is what a screen reader reads.
  it("keeps every control labelled by its own form when two instances share a screen", () => {
    render(
      <>
        <DynamicItemForm fields={FIELDS} onSubmit={vi.fn()} label="Edit Zelda" initialValues={{ title: "Zelda" }} />
        <DynamicItemForm fields={FIELDS} onSubmit={vi.fn()} label="Add item" />
      </>,
    );
    const editor = screen.getByRole("form", { name: "Edit Zelda" });
    const adder = screen.getByRole("form", { name: "Add item" });

    for (const form of [editor, adder]) {
      expect(within(form).getByRole("combobox", { name: "Status" })).toBeInTheDocument();
      expect(within(form).getByRole("textbox", { name: "Title" })).toBeInTheDocument();
      expect(within(form).getByRole("spinbutton", { name: "Year" })).toBeInTheDocument();
      expect(within(form).getByRole("checkbox", { name: "Owned" })).toBeInTheDocument();
      expect(within(form).getByRole("combobox", { name: "Platform" })).toBeInTheDocument();
      expect(within(form).getByRole("textbox", { name: "Labels" })).toBeInTheDocument();
      // Every label points into the form it sits in, not into its twin.
      for (const label of form.querySelectorAll("label[for]")) {
        expect(form.contains((label as HTMLLabelElement).control)).toBe(true);
      }
    }
    expect(within(editor).getByRole("textbox", { name: "Title" })).toHaveValue("Zelda");
    expect(within(adder).getByRole("textbox", { name: "Title" })).toHaveValue("");

    const ids = Array.from(document.querySelectorAll("[id]"), (el) => el.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // A field id is any non-empty string, and an HTML id may not contain
  // whitespace. Two ids that differ only in a space and an underscore must not
  // collapse into one either.
  it("labels fields whose ids contain spaces, without colliding with similar ids", () => {
    render(
      <DynamicItemForm
        fields={[
          { id: "release year", label: "Release year", type: "text", required: false },
          { id: "release_year", label: "Year released", type: "text", required: false },
        ]}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByRole("textbox", { name: "Release year" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Year released" })).toBeInTheDocument();
    for (const el of document.querySelectorAll("[id]")) expect(el.id).not.toMatch(/\s/);
  });
});
