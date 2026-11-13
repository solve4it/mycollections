import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSeen } from "./in-view.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function Probe({ onSeen }: { onSeen: (seen: boolean) => void }) {
  const [ref, seen] = useSeen<HTMLDivElement>();
  onSeen(seen);
  return <div ref={ref} />;
}

describe("useSeen (#37)", () => {
  it("is false until the element nears the viewport, then stays true", () => {
    let fire: (entries: { isIntersecting: boolean }[]) => void = () => {};
    const disconnect = vi.fn();
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
          fire = callback;
        }
        observe() {}
        disconnect = disconnect;
      },
    );
    const seen: boolean[] = [];
    render(<Probe onSeen={(value) => seen.push(value)} />);
    expect(seen.at(-1)).toBe(false);
    act(() => fire([{ isIntersecting: false }]));
    expect(seen.at(-1)).toBe(false);
    act(() => fire([{ isIntersecting: true }]));
    expect(seen.at(-1)).toBe(true);
    expect(disconnect).toHaveBeenCalled();
  });

  it("counts everything as seen where there is no IntersectionObserver", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    const seen: boolean[] = [];
    render(<Probe onSeen={(value) => seen.push(value)} />);
    expect(seen.at(-1)).toBe(true);
  });
});
