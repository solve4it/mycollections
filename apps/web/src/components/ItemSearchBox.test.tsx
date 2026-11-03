import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../i18n/index.js";
import { ItemSearchBox, SEARCH_DEBOUNCE_MS } from "./ItemSearchBox.js";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function box() {
  return screen.getByRole("searchbox", { name: "Search items" });
}

describe("ItemSearchBox (#41)", () => {
  it("is a labelled search box inside a search landmark", () => {
    const { container } = render(<ItemSearchBox value="" onSearch={vi.fn()} />);
    // jsdom has no implicit role for <search>; e2e asserts the landmark in Chromium.
    expect(container.querySelector("search")).toContainElement(box());
    expect(box()).toHaveAttribute("maxLength", "200");
  });

  it("shows the search it was given", () => {
    render(<ItemSearchBox value="dune" onSearch={vi.fn()} />);
    expect(box()).toHaveValue("dune");
  });

  it("searches once typing pauses, not on every keystroke", () => {
    const onSearch = vi.fn();
    render(<ItemSearchBox value="" onSearch={onSearch} />);
    fireEvent.change(box(), { target: { value: "d" } });
    fireEvent.change(box(), { target: { value: "du" } });
    act(() => vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 1));
    expect(onSearch).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onSearch).toHaveBeenCalledTimes(1);
    expect(onSearch).toHaveBeenCalledWith("du");
  });

  it("searches at once on Enter, and does not search again when the pause runs out", () => {
    const onSearch = vi.fn();
    render(<ItemSearchBox value="" onSearch={onSearch} />);
    fireEvent.change(box(), { target: { value: "dune" } });
    fireEvent.submit(box());
    expect(onSearch).toHaveBeenCalledWith("dune");
    act(() => vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS));
    expect(onSearch).toHaveBeenCalledTimes(1);
  });

  it("follows a search changed from outside — back or forward — without losing what is being typed", () => {
    const onSearch = vi.fn();
    const { rerender } = render(<ItemSearchBox value="dune" onSearch={onSearch} />);

    // The URL moving on its own (Back) replaces the text.
    rerender(<ItemSearchBox value="emma" onSearch={onSearch} />);
    expect(box()).toHaveValue("emma");

    // The URL catching up with what this box pushed does not reset newer typing.
    fireEvent.change(box(), { target: { value: "emm" } });
    act(() => vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS));
    fireEvent.change(box(), { target: { value: "emma w" } });
    rerender(<ItemSearchBox value="emm" onSearch={onSearch} />);
    expect(box()).toHaveValue("emma w");
  });
});
