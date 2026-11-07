import { TARGET_COUNT_MAX } from "@mycollections/core";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import "../i18n/index.js";
import { FiniteSetFields, targetCountFromDraft, targetCountToDraft } from "./FiniteSetFields.js";

afterEach(cleanup);

const FINITE = "Finite set (a fixed, known number of items)";
const TARGET = "Number of items in the set";
const HINT = "Optional. A whole number from 1 to 100,000 — leave it empty if you do not know it yet.";

function Harness({ finite = false, target = "" }: { finite?: boolean; target?: string }) {
  const [isFiniteSet, setIsFiniteSet] = useState(finite);
  const [targetCount, setTargetCount] = useState(target);
  return (
    <FiniteSetFields
      isFiniteSet={isFiniteSet}
      targetCount={targetCount}
      onFiniteSetChange={setIsFiniteSet}
      onTargetCountChange={setTargetCount}
    />
  );
}

describe("FiniteSetFields", () => {
  it("asks for the target only once the collection is a finite set", () => {
    render(<Harness />);
    const finite = screen.getByRole("checkbox", { name: FINITE });
    expect(finite).not.toBeChecked();
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();

    fireEvent.click(finite);

    expect(finite).toBeChecked();
    expect(screen.getByRole("spinbutton", { name: TARGET })).toHaveValue(null);
  });

  it("offers a whole-number input bounded by the server's own limits, described by its rule", () => {
    render(<Harness finite target="151" />);
    const target = screen.getByRole("spinbutton", { name: TARGET });
    expect(target).toHaveValue(151);
    expect(target).toHaveAttribute("type", "number");
    expect(target).toHaveAttribute("inputmode", "numeric");
    expect(target).toHaveAttribute("min", "1");
    expect(target).toHaveAttribute("max", String(TARGET_COUNT_MAX));
    expect(target).toHaveAttribute("step", "1");
    expect(target).not.toBeRequired();
    expect(target).toHaveAccessibleDescription(HINT);
  });

  it("keeps the drafted target while finite is unchecked and checked again", () => {
    render(<Harness finite target="" />);
    fireEvent.change(screen.getByRole("spinbutton", { name: TARGET }), { target: { value: "42" } });

    fireEvent.click(screen.getByRole("checkbox", { name: FINITE }));
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox", { name: FINITE }));
    expect(screen.getByRole("spinbutton", { name: TARGET })).toHaveValue(42);
  });

  // #369: a literal id names the first copy twice and the second not at all.
  it("keeps two copies on one screen from sharing ids", () => {
    render(
      <>
        <section aria-label="First">
          <Harness finite target="3" />
        </section>
        <section aria-label="Second">
          <Harness finite target="7" />
        </section>
      </>,
    );
    const first = within(screen.getByRole("region", { name: "First" }));
    const second = within(screen.getByRole("region", { name: "Second" }));
    expect(first.getByRole("spinbutton", { name: TARGET })).toHaveValue(3);
    expect(second.getByRole("spinbutton", { name: TARGET })).toHaveValue(7);
    expect(second.getByRole("spinbutton", { name: TARGET })).toHaveAccessibleDescription(HINT);
    expect(first.getByRole("checkbox", { name: FINITE }).id).not.toBe(
      second.getByRole("checkbox", { name: FINITE }).id,
    );

    const ids = Array.from(document.querySelectorAll("[id]"), (element) => element.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("targetCountFromDraft", () => {
  it.each([
    ["a finite set with a target", true, "12", 12],
    ["a finite set at the upper bound", true, "100000", 100_000],
    ["a finite set with the box left empty", true, "", null],
    ["a collection that is not a finite set, whatever was drafted", false, "12", null],
    ["a collection that is not a finite set with nothing drafted", false, "", null],
  ])("sends %s as %s", (_label, isFiniteSet, draft, expected) => {
    expect(targetCountFromDraft(isFiniteSet, draft)).toBe(expected);
  });
});

describe("targetCountToDraft", () => {
  it("fills the box with a stored target and leaves it empty without one", () => {
    expect(targetCountToDraft(151)).toBe("151");
    expect(targetCountToDraft(null)).toBe("");
  });
});
