import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UndoToast } from "./UndoToast.js";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function renderToast(overrides: Partial<Parameters<typeof UndoToast>[0]> = {}) {
  const onAction = vi.fn();
  const onDismiss = vi.fn();
  render(
    <UndoToast
      message="Deleted “Zelda”"
      actionLabel="Undo"
      dismissLabel="Dismiss"
      onAction={onAction}
      onDismiss={onDismiss}
      {...overrides}
    />,
  );
  return { onAction, onDismiss };
}

describe("UndoToast", () => {
  it("announces the message politely and offers the action as a real button", () => {
    renderToast();
    const toast = screen.getByRole("status");
    expect(toast).toHaveTextContent("Deleted “Zelda”");
    // role="status" is polite: a confirmation must not interrupt what the user
    // is doing, and it must not be role="alert" — nothing has gone wrong.
    expect(toast).not.toHaveAttribute("role", "alert");
    expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument();
  });

  it("runs the action when the undo button is pressed", () => {
    const { onAction, onDismiss } = renderToast();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("dismisses itself after the undo window, and only once", () => {
    vi.useFakeTimers();
    const { onDismiss } = renderToast({ duration: 10_000 });

    vi.advanceTimersByTime(9_999);
    expect(onDismiss).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(60_000);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("can be dismissed by hand without running the action", () => {
    const { onAction, onDismiss } = renderToast();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onAction).not.toHaveBeenCalled();
  });

  it("holds the window open while the pointer is over it", () => {
    vi.useFakeTimers();
    const { onDismiss } = renderToast({ duration: 10_000 });
    const toast = screen.getByRole("status");

    fireEvent.mouseEnter(toast);
    vi.advanceTimersByTime(30_000);
    expect(onDismiss).not.toHaveBeenCalled();

    // Leaving restarts the window rather than resuming a nearly-expired one, so
    // the undo does not vanish the instant the pointer moves away.
    fireEvent.mouseLeave(toast);
    vi.advanceTimersByTime(9_999);
    expect(onDismiss).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("holds the window open while focus is inside it, so a keyboard user is not timed out", () => {
    vi.useFakeTimers();
    const { onDismiss } = renderToast({ duration: 10_000 });
    const toast = screen.getByRole("status");

    fireEvent.focus(screen.getByRole("button", { name: "Undo" }));
    vi.advanceTimersByTime(30_000);
    expect(onDismiss).not.toHaveBeenCalled();

    fireEvent.blur(toast);
    vi.advanceTimersByTime(10_000);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("gives both controls a 44px touch target", () => {
    renderToast();
    expect(screen.getByRole("button", { name: "Undo" })).toHaveClass("touch-target");
    expect(screen.getByRole("button", { name: "Dismiss" })).toHaveClass("touch-target");
  });

  it("stops its timer when unmounted", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    const { unmount } = render(
      <UndoToast
        message="Deleted “Zelda”"
        actionLabel="Undo"
        dismissLabel="Dismiss"
        duration={10_000}
        onAction={vi.fn()}
        onDismiss={onDismiss}
      />,
    );
    unmount();
    vi.advanceTimersByTime(30_000);
    expect(onDismiss).not.toHaveBeenCalled();
  });
});
