import { act, cleanup, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { REMOVAL_DEADLINE_MS, useFocusHandoff } from "./focus-handoff.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

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

/**
 * A control whose removal was asked for but never comes: a delete that landed
 * while the list could not be fetched again, so the row stays. The request must
 * not linger and move focus whenever the control finally goes, long after the
 * user stopped waiting on it (#42 review).
 */
function StuckHost() {
  const handOffFocus = useFocusHandoff();
  const [present, setPresent] = useState(true);
  const [tick, setTick] = useState(0);
  return (
    <>
      <button type="button" data-testid="destination">
        Destination
      </button>
      {present && (
        <button
          type="button"
          data-testid="stuck"
          onClick={(event) => handOffFocus(() => screen.getByTestId("destination"), { removing: event.currentTarget })}
        >
          Stuck
        </button>
      )}
      <button type="button" data-testid="commit" onClick={() => setTick(tick + 1)}>
        Commit {tick}
      </button>
      <button type="button" data-testid="remove" onClick={() => setPresent(false)}>
        Remove
      </button>
    </>
  );
}

describe("useFocusHandoff", () => {
  it("drops a request whose named control is still there once REMOVAL_DEADLINE_MS has passed", () => {
    const start = Date.now();
    const now = vi.spyOn(Date, "now").mockReturnValue(start);
    render(<StuckHost />);
    (document.activeElement as HTMLElement | null)?.blur();
    act(() => screen.getByTestId("stuck").click());

    // Just inside the bound a commit keeps it waiting: a slow delete keeps its handoff.
    now.mockReturnValue(start + REMOVAL_DEADLINE_MS - 1);
    act(() => screen.getByTestId("commit").click());
    expect(document.activeElement).toBe(document.body);
    // Past it, the next commit drops the request…
    now.mockReturnValue(start + REMOVAL_DEADLINE_MS + 1);
    act(() => screen.getByTestId("commit").click());
    // …so the control going later moves nothing.
    act(() => screen.getByTestId("remove").click());
    expect(document.activeElement).toBe(document.body);
  });

  it("still completes a request whose control goes just inside REMOVAL_DEADLINE_MS", () => {
    const start = Date.now();
    const now = vi.spyOn(Date, "now").mockReturnValue(start);
    render(<StuckHost />);
    (document.activeElement as HTMLElement | null)?.blur();
    act(() => screen.getByTestId("stuck").click());
    now.mockReturnValue(start + REMOVAL_DEADLINE_MS - 1);
    act(() => screen.getByTestId("remove").click());
    expect(document.activeElement).toBe(screen.getByTestId("destination"));
  });

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
