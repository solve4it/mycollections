import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { BUILT_IN_FIELD_TYPES } from "@mycollections/core";
import { describe, expect, it } from "vitest";
import { declaration, parseRules, rulesFor, winningDeclaration } from "./css-rules.js";

/**
 * Forms, buttons and status tags (#224). These resolve the cascade against a
 * real DOM rather than matching selector strings, because #259 shipped an
 * invisible nav tab where every selector looked right and a later rule quietly
 * won. jsdom applies no stylesheet, so global.css is parsed from disk.
 */

const css = readFileSync(resolve("src/styles/global.css"), "utf8");
const RULES = parseRules(css);
const paints = (element: Element, property: string, pseudo?: string) =>
  winningDeclaration(element, property, RULES, pseudo);

function mount(html: string): Element {
  document.body.innerHTML = html;
  const root = document.body.firstElementChild;
  if (!root) throw new Error("fixture rendered nothing");
  return root;
}

/**
 * One `.form-row` per built-in field type, with the control DynamicItemForm
 * actually emits for it. The map is exhaustive over BUILT_IN_FIELD_TYPES, so a
 * new field type fails this file until the stylesheet covers its control.
 */
const CONTROL_FOR_TYPE: Record<string, string> = {
  text: '<input type="text">',
  number: '<input type="number">',
  boolean: '<label class="checkbox-row"><input type="checkbox">Yes</label>',
  date: '<input type="date">',
  url: '<input type="url">',
  email: '<input type="email">',
  select: "<select><option>a</option></select>",
  multiselect: '<label class="checkbox-row"><input type="checkbox">a</label>',
  rating: "<select><option>1</option></select>",
  currency: '<input type="number" step="0.01">',
  image: '<input type="url">',
  tags: '<input type="text">',
};

describe("form controls", () => {
  it("covers every built-in field type — the map itself cannot go stale", () => {
    expect(Object.keys(CONTROL_FOR_TYPE).sort()).toEqual([...BUILT_IN_FIELD_TYPES].sort());
  });

  it.each(BUILT_IN_FIELD_TYPES)("styles the control a %s field renders", (type) => {
    // The old selector list enumerated input[type="text"] and [type="password"]
    // only, so number, date, url and email fields — six of the twelve types —
    // rendered bare UA controls on the card surface.
    const row = mount(`<div class="form-row"><label>L</label>${CONTROL_FOR_TYPE[type]}</div>`);
    const control = row.querySelector('input:not([type="checkbox"]), select, textarea');
    if (!control) return; // boolean and multiselect are checkbox rows, asserted below

    expect(paints(control, "background"), `${type} control must sit on the card surface`).toBe("var(--card)");
    expect(paints(control, "color"), `${type} control must use body ink`).toBe("var(--ink)");
    expect(paints(control, "border"), `${type} control must carry the palette border`).toContain("var(--line)");
    expect(paints(control, "min-height"), `${type} control must meet the touch target`).toBe(
      "var(--touch-target-size)",
    );
  });

  it("actually lays the checkbox row out as a row", () => {
    // A <label> is inline by default, so the flex-direction and gap this rule
    // has always declared did nothing until `display: flex` joined them — the
    // box rendered flush against its text.
    const row = mount('<div class="form-row"><label class="checkbox-row"><input type="checkbox">Yes</label></div>');
    const label = row.querySelector(".checkbox-row");
    if (!label) throw new Error("fixture is missing the checkbox row");
    expect(paints(label, "display")).toBe("flex");
    expect(paints(label, "gap")).toBe("var(--space-2)");
    expect(paints(label, "min-height")).toBe("var(--touch-target-size)");
  });

  it("themes the native checkbox rather than replacing it", () => {
    const row = mount('<div class="form-row"><label class="checkbox-row"><input type="checkbox">Yes</label></div>');
    const box = row.querySelector('input[type="checkbox"]');
    if (!box) throw new Error("fixture is missing the checkbox");
    expect(paints(box, "accent-color")).toBe("var(--stamp)");
  });

  it("does not stretch checkboxes to the touch-target height", () => {
    // A 44px-tall checkbox is a 44px-wide box, not a bigger hit area. The row
    // that wraps it carries the target instead.
    const row = mount('<div class="form-row"><label class="checkbox-row"><input type="checkbox">Yes</label></div>');
    const box = row.querySelector('input[type="checkbox"]');
    if (!box) throw new Error("fixture is missing the checkbox");
    expect(paints(box, "min-height")).toBeUndefined();
    expect(paints(box, "background")).toBeUndefined();
  });

  it("styles the file picker that Settings uses", () => {
    const row = mount('<div class="import-row"><input type="file" class="touch-target"></div>');
    const file = row.querySelector('input[type="file"]');
    if (!file) throw new Error("fixture is missing the file input");
    expect(paints(file, "color")).toBe("var(--ink)");
  });

  it("styles the setup screen's token field", () => {
    // The first screen a new user sees. Its label and input used to be direct
    // children of the <form>, so every .form-row-scoped rule missed them and it
    // rendered a bare UA control; setup.test.tsx pins the wrapper that fixes it.
    const page = mount(
      '<div class="setup-page"><form><div class="form-row"><label>Token</label><input type="password"></div></form></div>',
    );
    const input = page.querySelector("input");
    if (!input) throw new Error("fixture is missing the token input");
    expect(paints(input, "background")).toBe("var(--card)");
  });
});

describe("buttons", () => {
  const primary = () => mount('<button type="submit" class="touch-target">Save</button>');
  const quiet = () => mount('<button type="button" class="touch-target button-quiet">Cancel</button>');

  it("gives the primary action the stamp fill", () => {
    expect(paints(primary(), "background")).toMatch(/--stamp\b|--color-primary/);
    expect(paints(primary(), "color")).toBe("var(--stamp-ink)");
  });

  it("does not ring the stamp fill with a paper-palette border", () => {
    // --line around --stamp is a dark hairline on a bright fill in dark mode.
    expect(paints(primary(), "border")).not.toContain("var(--line)");
  });

  it("gives the quiet variant its own skin rather than styling buttons by position", () => {
    // Three near-duplicate rules used to style secondary buttons by where they
    // sat (.field-row button, .item-actions button, .settings-data button), so
    // the Cancel button in item edit mode — which matched none of them —
    // rendered as a bare UA button.
    const button = quiet();
    expect(paints(button, "background")).toBe("var(--paper)");
    expect(paints(button, "color")).toBe("var(--ink)");
    expect(paints(button, "border")).toContain("var(--line)");
  });

  it("marks the destructive variant in danger ink, not in the quiet skin", () => {
    // The button that goes through with a permanent delete (#35). Sharing the
    // quiet skin would make "Delete forever" look like "Cancel".
    const danger = mount('<button type="button" class="touch-target button-danger">Delete forever</button>');
    expect(paints(danger, "color")).toBe("var(--danger)");
    expect(paints(danger, "border")).toContain("var(--danger)");
    expect(paints(danger, "background")).toBe("var(--paper)");
  });

  it("styles every variant when disabled", () => {
    for (const [name, element] of [
      ["primary", mount('<button type="submit" disabled>Save</button>')],
      ["quiet", mount('<button type="button" class="button-quiet" disabled>Cancel</button>')],
      ["danger", mount('<button type="button" class="button-danger" disabled>Delete forever</button>')],
    ] as const) {
      expect(paints(element, "cursor", ":disabled"), `${name} needs a disabled cursor`).toBe("not-allowed");
      expect(paints(element, "opacity", ":disabled"), `${name} needs a disabled opacity`).toBeDefined();
    }
  });

  it("keeps every button's own icon gap out of the sizing utility", () => {
    // #259's rule: .touch-target sizes, skins paint. A gap on the utility is
    // what closed the settings buttons' icon spacing last time.
    expect(rulesFor(RULES, ".touch-target")[0]?.body).not.toMatch(/(^|[;{])\s*gap\s*:/);
  });
});

describe("status tags", () => {
  /** Two rows with *different* statuses: a copy-paste that gives both the same hue fails. */
  function renderStatuses() {
    document.body.innerHTML = `
      <ul class="item-list">
        <li><div class="item-row"><div class="item-fields">
          <span class="item-status item-status-owned"><span class="status-dot" aria-hidden="true"></span>Owned</span>
        </div></div></li>
        <li><div class="item-row"><div class="item-fields">
          <span class="item-status item-status-wanted"><span class="status-dot" aria-hidden="true"></span>Wanted</span>
        </div></div></li>
        <li><div class="item-row"><div class="item-fields">
          <span class="item-status item-status-ordered"><span class="status-dot" aria-hidden="true"></span>Ordered</span>
        </div></div></li>
      </ul>`;
    const pick = (status: string) => {
      const element = document.querySelector(`.item-status-${status}`);
      if (!element) throw new Error(`fixture is missing the ${status} tag`);
      return element;
    };
    return { owned: pick("owned"), wanted: pick("wanted"), ordered: pick("ordered") };
  }

  it("paints each status in its own token", () => {
    // The markup already emitted item-status-${status}, but no rule matched it,
    // so all three statuses rendered as the same indigo pill.
    const tags = renderStatuses();
    expect(paints(tags.owned, "color")).toBe("var(--owned)");
    expect(paints(tags.wanted, "color")).toBe("var(--wanted)");
    expect(paints(tags.ordered, "color")).toBe("var(--ordered)");
  });

  it("writes the label in the typewritten voice", () => {
    const tags = renderStatuses();
    expect(paints(tags.owned, "font-family")).toBe("var(--font-mono)");
    expect(paints(tags.owned, "text-transform")).toBe("uppercase");
  });

  it("draws the dot with a border so it survives forced-colors mode", () => {
    // A background-painted dot is dropped in forced-colors, where borders keep
    // currentColor — the same reasoning that made the active nav notch a border.
    const dot = rulesFor(RULES, ".status-dot")[0];
    expect(dot, "the status dot needs its own rule").toBeDefined();
    expect(declaration(dot?.body ?? "", "border")).toContain("currentColor");
    expect(declaration(dot?.body ?? "", "background"), "a filled dot vanishes in forced-colors").toBeUndefined();
  });

  it("carries no tint behind the label", () => {
    // --wanted on a 10% wanted tint over card is 4.28:1 — under the 4.5 floor
    // for small text. The flat label is what keeps all three statuses legible.
    const tags = renderStatuses();
    expect(paints(tags.wanted, "background")).toBeUndefined();
  });
});
