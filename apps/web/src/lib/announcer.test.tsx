import { act, cleanup, render, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ANNOUNCEMENT_LIFETIME_MS, Announcer, useAnnounce, useAnnouncements } from "./announcer.js";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function Harness({ onReady }: { onReady: (announce: (message: string) => void) => void }) {
  const { messages, announce } = useAnnouncements();
  onReady(announce);
  return <Announcer messages={messages} />;
}

function mount() {
  let announce: (message: string) => void = () => {};
  render(
    <Harness
      onReady={(fn) => {
        announce = fn;
      }}
    />,
  );
  const region = document.querySelector<HTMLElement>('[aria-live="polite"]');
  if (!region) throw new Error("no region");
  return { region, say: (message: string) => act(() => announce(message)) };
}

describe("Announcer", () => {
  it("is a persistent, empty, hidden polite region with no role and no aria-atomic", () => {
    const { region } = mount();
    expect(region).toBeEmptyDOMElement();
    expect(region).toHaveClass("visually-hidden");
    expect(region).not.toHaveAttribute("role");
    // Atomic would re-read every message still held in the region whenever one is added.
    expect(region).not.toHaveAttribute("aria-atomic");
  });

  it("speaks the same words twice by inserting a new node each time", () => {
    const { region, say } = mount();
    say("2 items match");
    const first = region.firstElementChild;
    say("2 items match");

    // Identical text in place would be no change at all, so nothing would be
    // read. A new node is an addition, which a polite region always reports.
    expect(region.children).toHaveLength(2);
    expect(region.children[1]).not.toBe(first);
    expect(region.children[1]).toHaveTextContent("2 items match");
  });

  it("keeps both of two messages said in one tick, rather than the last one winning", () => {
    const { region, say } = mount();
    say("Games · MyCollections");
    say("3 items match");
    expect(Array.from(region.children, (node) => node.textContent)).toEqual(["Games · MyCollections", "3 items match"]);
  });

  it("keeps the region and drops each message once it has had time to be read", () => {
    vi.useFakeTimers();
    const { region, say } = mount();
    say("first");
    act(() => vi.advanceTimersByTime(ANNOUNCEMENT_LIFETIME_MS / 2));
    say("second");
    act(() => vi.advanceTimersByTime(ANNOUNCEMENT_LIFETIME_MS / 2));

    expect(Array.from(region.children, (node) => node.textContent)).toEqual(["second"]);
    act(() => vi.advanceTimersByTime(ANNOUNCEMENT_LIFETIME_MS));
    expect(region).toBeEmptyDOMElement();
    expect(document.querySelector('[aria-live="polite"]')).toBe(region);
  });

  it("ignores an empty message", () => {
    const { region, say } = mount();
    say("");
    expect(region).toBeEmptyDOMElement();
  });
});

describe("useAnnounce", () => {
  it("is a harmless no-op outside the shell, so a screen can render on its own in a test", () => {
    const { result } = renderHook(() => useAnnounce());
    expect(() => result.current("nobody is listening")).not.toThrow();
  });
});
