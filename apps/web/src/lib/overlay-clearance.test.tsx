import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OVERLAY_CLEARANCE_PROPERTY, OVERLAY_GAP_PX, useOverlayClearance } from "./overlay-clearance.js";

/** jsdom has no ResizeObserver; this one lets a test say when the region resized. */
let notifyResize: () => void = () => {};
class FakeResizeObserver {
  constructor(callback: () => void) {
    notifyResize = callback;
  }
  observe() {}
  disconnect() {}
}

function Region({ showing }: { showing: boolean }) {
  const ref = useOverlayClearance();
  return (
    <div ref={ref} className="region">
      {showing && <div className="undo-toast">Deleted</div>}
    </div>
  );
}

/** A page whose region only arrives once its data has, as the collection page's does. */
function Late({ ready }: { ready: boolean }) {
  const ref = useOverlayClearance();
  if (!ready) return <p>Loading</p>;
  return (
    <div ref={ref}>
      <div className="undo-toast">Deleted</div>
    </div>
  );
}

function clearance(): string {
  return document.documentElement.style.getPropertyValue(OVERLAY_CLEARANCE_PROPERTY);
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  vi.stubGlobal("innerHeight", 720);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ top: 578 } as DOMRect);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useOverlayClearance (#372)", () => {
  it("claims nothing while the region holds nothing", () => {
    render(<Region showing={false} />);
    notifyResize();
    expect(clearance()).toBe("");
  });

  it("claims the viewport from the region's top edge down, plus a gap, while it holds something", () => {
    const { rerender } = render(<Region showing={false} />);
    rerender(<Region showing />);
    notifyResize();
    // 720 − 578 = 142, the whole strip from the toast's top to the viewport's
    // foot, which on a phone includes the bottom nav under it.
    expect(clearance()).toBe(`${720 - 578 + OVERLAY_GAP_PX}px`);
  });

  it("measures a region that arrives after the page mounted, as it does behind a skeleton", () => {
    const { rerender } = render(<Late ready={false} />);
    rerender(<Late ready />);
    notifyResize();
    expect(clearance()).toBe(`${720 - 578 + OVERLAY_GAP_PX}px`);
  });

  it("gives the space back when the region empties, and when the page goes", () => {
    const { rerender, unmount } = render(<Region showing />);
    notifyResize();
    expect(clearance()).not.toBe("");

    rerender(<Region showing={false} />);
    notifyResize();
    expect(clearance()).toBe("");

    rerender(<Region showing />);
    notifyResize();
    unmount();
    expect(clearance()).toBe("");
  });
});
