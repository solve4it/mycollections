import { act, cleanup, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { useFocusHandoff } from "./focus-handoff.js";

afterEach(cleanup);

/**
 * A host whose control is removed *before* the handoff is asked for — what a
 * real browser does when a list fetched again commits ahead of the mutation's
 * onSuccess (#41): focus is already on <body> when `handOffFocus` runs.
 */
function Host() {
  const handOffFocus = useFocusHandoff();
  const [tick, setTick] = useState(0);
  return (
    <>
      <button type="button" data-testid="destination">
        Destination
      </button>
      <button
        type="button"
        data-testid="ask"
        onClick={() => {
          (document.activeElement as HTMLElement | null)?.blur();
          handOffFocus(() => screen.getByTestId("destination"));
          setTick(tick + 1);
        }}
      >
        Ask {tick}
      </button>
    </>
  );
}

/**
 * The same, with a host that has no reason of its own to render again — what
 * the collection page is when a row's Save is hidden by a search (#42): the
 * list fetched again has already committed, and the page's callback only asks for
 * the handoff and announces through the shell. Nothing else commits the page.
 */
function QuietHost() {
  const handOffFocus = useFocusHandoff();
  return (
    <>
      <button type="button" data-testid="destination">
        Destination
      </button>
      <button
        type="button"
        data-testid="ask"
        onClick={() => {
          (document.activeElement as HTMLElement | null)?.blur();
          handOffFocus(() => screen.getByTestId("destination"));
        }}
      >
        Ask
      </button>
    </>
  );
}

describe("useFocusHandoff", () => {
  it("rescues focus that had already fallen to <body> when the handoff was asked for", () => {
    render(<Host />);
    act(() => screen.getByTestId("ask").click());
    expect(document.activeElement).toBe(screen.getByTestId("destination"));
  });

  it("completes even when the host would not otherwise commit again", () => {
    render(<QuietHost />);
    act(() => screen.getByTestId("ask").click());
    expect(document.activeElement).toBe(screen.getByTestId("destination"));
  });
});
