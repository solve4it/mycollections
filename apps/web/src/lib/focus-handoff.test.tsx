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

/**
 * A list whose Delete is pressed without taking focus (a Safari click, an iOS
 * tap) and whose row only goes once the "server" answers, as a list fetched again
 * would. The handoff is asked for before the removal, naming the Delete as the
 * control being removed.
 */
function ListHost() {
  const handOffFocus = useFocusHandoff();
  const [rows, setRows] = useState(["A", "B"]);
  const [, setUnrelated] = useState(0);
  return (
    <ul>
      {rows.map((row, index) => (
        <li key={row}>
          <button type="button" data-edit="">
            Edit {row}
          </button>
          <button
            type="button"
            data-testid={`delete-${row}`}
            onClick={(event) => {
              handOffFocus(() => Array.from(document.querySelectorAll<HTMLElement>("[data-edit]"))[index] ?? null, {
                removing: event.currentTarget,
              });
              // Something unrelated commits the host first (the counts query
              // on a finite set), then the row goes.
              setTimeout(() => setUnrelated((n) => n + 1), 0);
              setTimeout(() => setRows((current) => current.filter((r) => r !== row)), 10);
            }}
          >
            Delete {row}
          </button>
        </li>
      ))}
    </ul>
  );
}

describe("useFocusHandoff", () => {
  it("waits for the named control to leave, even when focus was never on it", async () => {
    render(<ListHost />);
    (document.activeElement as HTMLElement | null)?.blur();
    act(() => screen.getByTestId("delete-A").click());
    // The row being deleted is still here, so its Edit is not a destination.
    expect(document.activeElement).not.toBe(screen.getByText("Edit A"));

    await act(() => new Promise((resolve) => setTimeout(resolve, 30)));

    expect(screen.queryByText("Edit A")).toBeNull();
    expect(document.activeElement).toBe(screen.getByText("Edit B"));
  });

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
