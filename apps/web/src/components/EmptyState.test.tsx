import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { EmptyState } from "./EmptyState.js";

afterEach(cleanup);

/**
 * The empty state is the "cabinet is empty" pattern (#225): the drawer mark with
 * a drawer pulled open, a plain-verb title, an explanation, and — where there is
 * one — the action that fills it. The illustration carries no information, so
 * these tests hold it decorative and hold the words as the accessible content.
 */
describe("EmptyState", () => {
  it("shows the title and description it is given", () => {
    render(<EmptyState title="No collections yet" description="Create your first collection to start tracking." />);
    expect(screen.getByText("No collections yet")).toBeInTheDocument();
    expect(screen.getByText("Create your first collection to start tracking.")).toBeInTheDocument();
  });

  it("draws the open-drawer mark and hides it from assistive technology", () => {
    // The words already say the cabinet is empty; announcing the drawing too
    // would make a screen reader read the same fact twice.
    const { container } = render(<EmptyState title="No items yet" description="Add your first item below." />);
    const mark = container.querySelector("svg.empty-mark");
    expect(mark).not.toBeNull();
    expect(mark).toHaveAttribute("aria-hidden", "true");
    expect(mark?.querySelectorAll("path, rect, line").length ?? 0).toBeGreaterThan(0);
  });

  it("titles a page-owning empty state as the page heading", () => {
    render(<EmptyState titleAs="h1" title="No collections yet" description="Create your first collection." />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("No collections yet");
  });

  it("titles a region empty state without inventing a heading", () => {
    // The items empty state sits under the page's own <h1> and an <h2> "Items".
    // A third heading here would claim an outline level it does not own.
    render(<EmptyState title="No items yet" description="Add your first item below." />);
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
    expect(screen.getByText("No items yet")).toBeInTheDocument();
  });

  it("renders the action it is handed", () => {
    render(
      <EmptyState title="No collections yet" description="Create your first collection.">
        <button type="button">Create collection</button>
      </EmptyState>,
    );
    expect(screen.getByRole("button", { name: "Create collection" })).toBeInTheDocument();
  });
});
