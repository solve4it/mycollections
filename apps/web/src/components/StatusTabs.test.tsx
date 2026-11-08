import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../i18n/index.js";
import type { StatusTab } from "../lib/item-search.js";
import { StatusTabs } from "./StatusTabs.js";

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("dir");
});

/** The tabs with their selection held the way the page holds it: the parent decides, the tabs ask. */
function Harness({ initial = "all", onSelect }: { initial?: StatusTab; onSelect?: (tab: StatusTab) => void }) {
  const [tab, setTab] = useState<StatusTab>(initial);
  return (
    <StatusTabs
      value={tab}
      onSelect={(next) => {
        onSelect?.(next);
        setTab(next);
      }}
    >
      <p>Panel content for {tab}</p>
    </StatusTabs>
  );
}

function tabNames(): string[] {
  return screen.getAllByRole("tab").map((tab) => tab.textContent ?? "");
}

function selectedTab(): string {
  return screen.getByRole("tab", { selected: true }).textContent ?? "";
}

describe("StatusTabs (#42)", () => {
  it("is a named tablist of All, Collected and Remaining, with no counts in the labels", () => {
    render(<Harness />);
    const tablist = screen.getByRole("tablist", { name: "Items by status" });
    expect(tablist).toBeInTheDocument();
    expect(tabNames()).toEqual(["All", "Collected", "Remaining"]);
    for (const tab of screen.getAllByRole("tab")) {
      expect(tab.tagName).toBe("BUTTON");
      expect(tab).toHaveAttribute("type", "button");
    }
  });

  it("marks the selected tab, gives it alone the tab stop, and ties it to the panel both ways", () => {
    render(<Harness initial="collected" />);
    const [all, collected, remaining] = screen.getAllByRole("tab") as [HTMLElement, HTMLElement, HTMLElement];
    expect([all, collected, remaining].map((tab) => tab.getAttribute("aria-selected"))).toEqual([
      "false",
      "true",
      "false",
    ]);
    expect([all, collected, remaining].map((tab) => tab.tabIndex)).toEqual([-1, 0, -1]);

    const panel = screen.getByRole("tabpanel", { name: "Collected" });
    expect(panel).toHaveTextContent("Panel content for collected");
    expect(panel.tabIndex).toBe(0);
    expect(panel.getAttribute("aria-labelledby")).toBe(collected.id);
    for (const tab of [all, collected, remaining]) expect(tab.getAttribute("aria-controls")).toBe(panel.id);
  });

  it("selects on click", () => {
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("tab", { name: "Remaining" }));
    expect(onSelect).toHaveBeenLastCalledWith("remaining");
    expect(selectedTab()).toBe("Remaining");
    expect(screen.getByRole("tabpanel", { name: "Remaining" })).toHaveTextContent("Panel content for remaining");
  });

  it("moves and selects with the arrow keys, wrapping at both ends, and jumps with Home and End", () => {
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);
    const all = screen.getByRole("tab", { name: "All" });
    all.focus();

    fireEvent.keyDown(all, { key: "ArrowRight" });
    // Automatic activation: moving focus is selecting.
    expect(screen.getByRole("tab", { name: "Collected" })).toHaveFocus();
    expect(selectedTab()).toBe("Collected");

    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "ArrowRight" });
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "All" }), "Right off the end wraps to the first").toHaveFocus();

    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "ArrowLeft" });
    expect(screen.getByRole("tab", { name: "Remaining" }), "Left off the start wraps to the last").toHaveFocus();

    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Home" });
    expect(screen.getByRole("tab", { name: "All" })).toHaveFocus();
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "End" });
    expect(screen.getByRole("tab", { name: "Remaining" })).toHaveFocus();
    expect(selectedTab()).toBe("Remaining");

    expect(onSelect.mock.calls.map(([tab]) => tab)).toEqual([
      "collected",
      "remaining",
      "all",
      "remaining",
      "all",
      "remaining",
    ]);
  });

  it("reverses Left and Right in a right-to-left document (R12)", () => {
    document.documentElement.setAttribute("dir", "rtl");
    render(<Harness />);
    const all = screen.getByRole("tab", { name: "All" });
    all.focus();

    // In RTL the tabs run right to left, so the next one is to the *left*.
    fireEvent.keyDown(all, { key: "ArrowLeft" });
    expect(screen.getByRole("tab", { name: "Collected" })).toHaveFocus();
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "All" })).toHaveFocus();
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Remaining" }), "Right off the start wraps to the last").toHaveFocus();
    // Home and End are logical, not visual: first and last whatever the direction.
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Home" });
    expect(screen.getByRole("tab", { name: "All" })).toHaveFocus();
  });

  it("leaves every other key alone, so Tab still leaves the tablist and Up and Down still scroll", () => {
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);
    const all = screen.getByRole("tab", { name: "All" });
    all.focus();
    for (const key of ["ArrowDown", "ArrowUp", "Tab", "a"]) {
      const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
      all.dispatchEvent(event);
      expect(event.defaultPrevented, key).toBe(false);
    }
    const handled = new KeyboardEvent("keydown", { key: "End", bubbles: true, cancelable: true });
    all.dispatchEvent(handled);
    expect(handled.defaultPrevented, "a key the tabs handle must not also scroll the page").toBe(true);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("takes its ids from the instance, so two on one screen never share one (#369)", () => {
    render(
      <>
        <Harness />
        <Harness initial="remaining" />
      </>,
    );
    const ids = [...screen.getAllByRole("tab"), ...screen.getAllByRole("tabpanel")].map((element) => element.id);
    expect(ids.every((id) => id !== "")).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    const panels = screen.getAllByRole("tabpanel");
    expect(panels.map((panel) => panel.getAttribute("aria-labelledby"))).toEqual([
      screen.getAllByRole("tab", { name: "All" })[0]?.id,
      screen.getAllByRole("tab", { name: "Remaining" })[1]?.id,
    ]);
  });
});
