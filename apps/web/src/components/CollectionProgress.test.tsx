import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "../i18n/index.js";
import { CollectionProgress } from "./CollectionProgress.js";

afterEach(cleanup);

const FINITE_OF_FIVE = { isFiniteSet: true, targetCount: 5 };

/** The rendered widget, found by the class every surface styles it by. */
function widget(container: HTMLElement): HTMLElement {
  const found = container.querySelector<HTMLElement>("p.collection-progress");
  if (!found) throw new Error("no p.collection-progress rendered");
  return found;
}

function fill(container: HTMLElement): HTMLElement {
  const found = container.querySelector<HTMLElement>(".collection-progress-fill");
  if (!found) throw new Error("no .collection-progress-fill rendered");
  return found;
}

describe("CollectionProgress", () => {
  it("renders nothing for a collection that is not a finite set", () => {
    const { container } = render(
      <CollectionProgress collection={{ isFiniteSet: false, targetCount: null }} ownedCount={3} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing for a finite set whose size is not known yet (#42 R6)", () => {
    const { container } = render(
      <CollectionProgress collection={{ isFiniteSet: true, targetCount: null }} ownedCount={3} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("says how many of the target are collected, in words, and fills the track to match", () => {
    const { container } = render(<CollectionProgress collection={FINITE_OF_FIVE} ownedCount={3} />);
    expect(widget(container)).toHaveTextContent(/^3 of 5 collected$/);
    expect(fill(container).style.inlineSize).toBe("60%");
    expect(screen.queryByText("Complete")).not.toBeInTheDocument();
    expect(widget(container)).not.toHaveClass("collection-progress-complete");
  });

  it("shows an empty set as an empty track, never as a missing bar", () => {
    const { container } = render(<CollectionProgress collection={FINITE_OF_FIVE} ownedCount={0} />);
    expect(widget(container)).toHaveTextContent(/^0 of 5 collected$/);
    expect(fill(container).style.inlineSize).toBe("0%");
    expect(screen.queryByText("Complete")).not.toBeInTheDocument();
  });

  it("marks a set complete in words, not by color alone, once owned reaches the target", () => {
    const { container } = render(<CollectionProgress collection={FINITE_OF_FIVE} ownedCount={5} />);
    expect(widget(container)).toHaveTextContent(/^5 of 5 collected\s*Complete$/);
    expect(widget(container)).toHaveClass("collection-progress-complete");
    expect(fill(container).style.inlineSize).toBe("100%");
    // The badge's tick repeats the word beside it, so it is hidden.
    const badge = screen.getByText("Complete");
    expect(badge.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("states an over-target count honestly while the fill stops at full", () => {
    const { container } = render(<CollectionProgress collection={FINITE_OF_FIVE} ownedCount={6} />);
    expect(widget(container)).toHaveTextContent(/^6 of 5 collected\s*Complete$/);
    expect(fill(container).style.inlineSize).toBe("100%");
  });

  it("is one short of complete with no badge at owned = target - 1", () => {
    const { container } = render(<CollectionProgress collection={FINITE_OF_FIVE} ownedCount={4} />);
    expect(widget(container)).toHaveTextContent(/^4 of 5 collected$/);
    expect(screen.queryByText("Complete")).not.toBeInTheDocument();
  });

  it("pluralizes on the target, as the locale's plural rules ask", () => {
    const { container } = render(
      <CollectionProgress collection={{ isFiniteSet: true, targetCount: 1 }} ownedCount={0} />,
    );
    expect(widget(container)).toHaveTextContent(/^0 of 1 collected$/);
  });

  it("hides the track and fill, which only repeat the words, and never sets the --progress color token", () => {
    const { container } = render(<CollectionProgress collection={FINITE_OF_FIVE} ownedCount={2} />);
    const track = container.querySelector(".collection-progress-track");
    expect(track?.tagName).toBe("SPAN");
    expect(track).toHaveAttribute("aria-hidden", "true");
    expect(fill(container).tagName).toBe("SPAN");
    expect(track?.contains(fill(container))).toBe(true);
    // --progress is the manila-ink color (global.css). Declared on an element it
    // would shadow that token for the subtree and paint the fill invalid (#42).
    for (const element of container.querySelectorAll<HTMLElement>("[style]")) {
      expect(element.getAttribute("style")).not.toMatch(/--progress\s*:/);
    }
    // Not a <progress>/<meter>/progressbar: inside a card's link those double the
    // name, and <progress> clamps an over-target value (DESIGN.md).
    expect(container.querySelector("progress, meter, [role='progressbar'], [role='meter']")).toBeNull();
  });
});
