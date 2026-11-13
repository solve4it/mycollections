import { useEffect, useState } from "react";

/** The custom property on `<html>` that `global.css` reads into `scroll-padding-bottom` and `.shell-main`'s padding. */
export const OVERLAY_CLEARANCE_PROPERTY = "--overlay-clearance";

/** Room left between a focused control's ring and the overlay's top edge. */
export const OVERLAY_GAP_PX = 8;

/**
 * Keeps the page clear of a region fixed over its foot (#372) — the undo toast
 * strip, which paints over whatever scrolls beneath it.
 *
 * WCAG 2.2's 2.4.11 Focus Not Obscured asks that a control taking focus is not
 * hidden behind author content. The strip stays fixed — where the thumb is, by
 * design — and instead the page learns how much of the viewport it covers:
 * `scroll-padding-bottom` makes the browser's own focus scrolling stop short of
 * it, a `focusin` check does the same for focus moved by script, and the same amount added to `<main>`'s foot gives the last control on the
 * page room to scroll up into.
 *
 * Measured rather than a constant. The strip's height is whatever is in it: a
 * one-line toast, a toast wrapped onto two lines at 390px, a celebration above
 * it, a restore error beside it. And from the region's top edge to the
 * viewport's foot, rather than the region's height, so the bottom nav it sits
 * above on a phone is counted too.
 *
 * Returns a callback ref for the region rather than taking a ref object: the
 * page renders its skeleton first, so the region is not in the document when
 * the page mounts, and an effect keyed on a ref object never hears that it
 * arrived later.
 *
 * Claims nothing while the region is empty — it is in the document permanently
 * (#308), and a page that kept a strip of padding for a toast that is not there
 * would just be a page with a gap at the bottom.
 */
export function useOverlayClearance(): (region: HTMLElement | null) => void {
  const [element, setElement] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (!element) return;
    const root = document.documentElement;
    let recheck = 0;

    /** The region's top edge, when it holds anything; null while it is empty. */
    function occupiedTop(): number | null {
      if (!element || (element.textContent ?? "").trim() === "") return null;
      return element.getBoundingClientRect().top;
    }

    function measure() {
      const top = occupiedTop();
      if (top === null) {
        root.style.removeProperty(OVERLAY_CLEARANCE_PROPERTY);
        return;
      }
      const covered = Math.max(0, window.innerHeight - top);
      root.style.setProperty(OVERLAY_CLEARANCE_PROPERTY, `${Math.ceil(covered) + OVERLAY_GAP_PX}px`);
      // Focus can land before the region is measured — a handoff in the same
      // commit as the toast's arrival — and then there was no room yet to
      // scroll into. Now there is, so the focused control is checked again: on
      // the next frame, not now, because the room is `<main>`'s padding and the
      // reduced-motion block in global.css gives *every* property a 0.01ms
      // transition, padding included, so it has not grown yet at this point.
      cancelAnimationFrame(recheck);
      recheck = requestAnimationFrame(() => {
        if (document.activeElement instanceof HTMLElement) clear(document.activeElement);
      });
    }

    // `scroll-padding` steers Tab, but Chromium's scroll-if-needed for a
    // scripted `focus()` ignores it — and every focus handoff in the app is a
    // scripted `focus()` (#367). So a control that takes focus with its foot
    // under the region is scrolled up by exactly the overlap. Focus inside the
    // region is on the toast itself and stays put.
    function clear(target: HTMLElement) {
      const top = occupiedTop();
      if (top === null || target === document.body || element?.contains(target)) return;
      const overlap = target.getBoundingClientRect().bottom - (top - OVERLAY_GAP_PX);
      if (overlap > 0) window.scrollBy({ top: overlap, behavior: "instant" });
    }

    function keepClear(event: FocusEvent) {
      if (event.target instanceof HTMLElement) clear(event.target);
    }

    // The region's size changes exactly when something arrives in it or leaves
    // it; the viewport's size moves its top edge without resizing it.
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    window.addEventListener("resize", measure);
    document.addEventListener("focusin", keepClear);
    measure();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
      document.removeEventListener("focusin", keepClear);
      cancelAnimationFrame(recheck);
      root.style.removeProperty(OVERLAY_CLEARANCE_PROPERTY);
    };
  }, [element]);

  return setElement;
}
