import type { FieldDefinition } from "@mycollections/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
});
