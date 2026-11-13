import { cleanup, render, screen } from "@testing-library/react";
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
    <>
      <button type="button">Save</button>
      <div ref={ref} className="region">
        {showing && (
          <div className="undo-toast">
            Deleted <button type="button">Undo</button>
          </div>
        )}
      </div>
    </>
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
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    // The region's top edge, and a Save button lying across it.
    return (this.textContent === "Save" ? { top: 600, bottom: 644 } : { top: 578, bottom: 640 }) as DOMRect;
  });
  vi.stubGlobal("scrollBy", vi.fn());
  // Frames run at once, so a check deferred to the next one is observable here.
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
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

  it("scrolls a control focused under the region up clear of it, as focus() alone does not", () => {
    render(<Region showing />);
    notifyResize();
    screen.getByRole("button", { name: "Save" }).focus();
    // The control's foot (644) must clear the region's top (578) by the gap.
    expect(window.scrollBy).toHaveBeenCalledWith({ top: 644 - (578 - OVERLAY_GAP_PX), behavior: "instant" });
  });

  it("checks the focused control again once the region is measured, for focus that landed first", () => {
    const { rerender } = render(<Region showing={false} />);
    screen.getByRole("button", { name: "Save" }).focus();
    rerender(<Region showing />);
    notifyResize();
    expect(window.scrollBy).toHaveBeenCalledWith({ top: 644 - (578 - OVERLAY_GAP_PX), behavior: "instant" });
  });

  it("leaves focus inside the region, and focus while it is empty, where it is", () => {
    const { rerender } = render(<Region showing={false} />);
    notifyResize();
    screen.getByRole("button", { name: "Save" }).focus();
    expect(window.scrollBy).not.toHaveBeenCalled();
    screen.getByRole("button", { name: "Save" }).blur();

    rerender(<Region showing />);
    notifyResize();
    screen.getByRole("button", { name: "Undo" }).focus();
    expect(window.scrollBy).not.toHaveBeenCalled();
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
