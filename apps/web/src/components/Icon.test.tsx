import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ICON_NAMES, Icon } from "./Icon.js";

afterEach(cleanup);

/**
 * The icon set is hand-rolled inline SVG (no dependency), so the invariants a
 * library would guarantee are asserted here instead: decorative by default,
 * colored by the surrounding text, sized in em so it tracks the font.
 */
describe("Icon", () => {
  it("renders every named icon as an svg with drawing content on the 24px grid", () => {
    for (const name of ICON_NAMES) {
      const { container } = render(<Icon name={name} />);
      const svg = container.querySelector("svg");
      expect(svg, `<Icon name="${name}"> must render an <svg>`).not.toBeNull();
      expect(svg?.getAttribute("viewBox"), `${name} must use the 24px grid`).toBe("0 0 24 24");
      const shapes = svg?.querySelectorAll("path, circle, rect, line, polyline") ?? [];
      expect(shapes.length, `${name} must draw something`).toBeGreaterThan(0);
      cleanup();
    }
  });

  it("is hidden from assistive technology and from tab order by default", () => {
    const { container } = render(<Icon name="settings" />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).toHaveAttribute("focusable", "false");
  });

  it("becomes an accessible image when given a label", () => {
    render(<Icon name="check" label="Yes" />);
    const svg = screen.getByRole("img", { name: "Yes" });
    expect(svg).not.toHaveAttribute("aria-hidden");
  });

  it("inherits text color: every icon strokes currentColor and hardcodes no color", () => {
    for (const name of ICON_NAMES) {
      const { container } = render(<Icon name={name} />);
      const svg = container.querySelector("svg");
      expect(svg?.getAttribute("stroke"), `${name} must stroke with currentColor`).toBe("currentColor");
      expect(svg?.getAttribute("fill"), `${name} must not paint a hardcoded fill`).toBe("none");
      expect(svg?.getAttribute("stroke-width"), `${name} must use the 1.5px Cabinet & Paper stroke`).toBe("1.5");
      expect(svg?.outerHTML ?? "", `${name} must not hardcode a color`).not.toMatch(/#[0-9a-fA-F]{3,6}|rgb\(/);
      cleanup();
    }
  });

  it("scales with the surrounding font size (em-based sizing lives on the .icon class)", () => {
    const { container } = render(<Icon name="add" />);
    expect(container.querySelector("svg")).toHaveClass("icon");
  });

  /**
   * The arrow follows the file, not the data: export writes a backup down onto
   * the device ("Download all your collections as a JSON backup file"), import
   * lifts a chosen file up out of it. That is the direction every browser's own
   * download UI uses, so the icons must not read as its opposite.
   */
  it("points the export arrow down and the import arrow up", () => {
    const arrowhead = (name: "import" | "export") => {
      const { container } = render(<Icon name={name} />);
      const points = container.querySelector("polyline")?.getAttribute("points") ?? "";
      const ys = points
        .split(" ")
        .map(Number)
        .filter((_, index) => index % 2 === 1);
      cleanup();
      // left flank, tip, right flank — the middle y is the point of the arrow.
      const [left = 0, tip = 0, right = 0] = ys;
      expect(ys, `${name} must draw a three-point arrowhead`).toHaveLength(3);
      return { tip, sides: [left, right] };
    };

    const exported = arrowhead("export");
    expect(exported.tip, "export arrowhead must point down, toward the device").toBeGreaterThan(
      Math.max(...exported.sides),
    );

    const imported = arrowhead("import");
    expect(imported.tip, "import arrowhead must point up, away from the device").toBeLessThan(
      Math.min(...imported.sides),
    );
  });

  it("keeps caller-supplied classes alongside the base class", () => {
    const { container } = render(<Icon name="logo" className="logo-mark" />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveClass("icon");
    expect(svg).toHaveClass("logo-mark");
  });
});
