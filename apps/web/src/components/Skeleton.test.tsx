import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CollectionGridSkeleton, ItemListSkeleton } from "./Skeleton.js";

afterEach(cleanup);

/**
 * Skeletons replace the text-only "Loading…" screens (#225). They are a picture
 * of the content that is coming, so the blocks themselves are decorative and the
 * wait is announced once, in words, by the surrounding role="status" — a screen
 * reader must not be handed a dozen empty boxes to read.
 */
describe("CollectionGridSkeleton", () => {
  it("announces the wait in words rather than as a pile of boxes", () => {
    render(<CollectionGridSkeleton label="Loading collections…" />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading collections…");
  });

  it("lays placeholder cards out in the same grid the real cards use", () => {
    const { container } = render(<CollectionGridSkeleton label="Loading collections…" count={3} />);
    const grid = container.querySelector(".collection-grid");
    expect(grid).not.toBeNull();
    expect(grid?.querySelectorAll(".skeleton-card")).toHaveLength(3);
  });

  it("gives every placeholder card a cover block, so the grid does not resize when the data lands", () => {
    const { container } = render(<CollectionGridSkeleton label="Loading collections…" count={2} />);
    expect(container.querySelectorAll(".skeleton-card .skeleton-cover")).toHaveLength(2);
  });

  it("hides the placeholder blocks from assistive technology", () => {
    const { container } = render(<CollectionGridSkeleton label="Loading collections…" />);
    expect(container.querySelector(".collection-grid")).toHaveAttribute("aria-hidden", "true");
  });

  it("keeps the announcement out of sight without hiding it from screen readers", () => {
    // display:none or aria-hidden here would leave the wait silent; the label is
    // clipped instead, which is also what keeps `getByText(/loading/i)` working.
    render(<CollectionGridSkeleton label="Loading collections…" />);
    expect(screen.getByText("Loading collections…")).toHaveClass("visually-hidden");
  });
});

describe("ItemListSkeleton", () => {
  it("announces the wait in words", () => {
    render(<ItemListSkeleton label="Loading items…" />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading items…");
  });

  it("draws placeholder rows in the same list the real items use", () => {
    const { container } = render(<ItemListSkeleton label="Loading items…" count={4} />);
    const list = container.querySelector(".item-list");
    expect(list).not.toBeNull();
    expect(list).toHaveAttribute("aria-hidden", "true");
    expect(list?.querySelectorAll(".skeleton-row")).toHaveLength(4);
  });

  it("shimmers: every placeholder block carries the skeleton skin", () => {
    // The shimmer lives entirely in CSS (motion.integration.test.ts pins it), so
    // what a component test can hold is that the blocks opt into it.
    const { container } = render(<ItemListSkeleton label="Loading items…" count={2} />);
    const blocks = container.querySelectorAll(".skeleton-row > *");
    expect(blocks.length).toBeGreaterThan(0);
    for (const block of blocks) expect(block).toHaveClass("skeleton");
  });
});
