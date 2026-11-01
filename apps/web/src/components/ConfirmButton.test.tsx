import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfirmButton } from "./ConfirmButton.js";

afterEach(cleanup);

const PROMPT = "Permanently delete “Records”? This cannot be undone.";

function renderConfirm(pending = false) {
  const onConfirm = vi.fn();
  const props = {
    label: "Delete forever",
    prompt: PROMPT,
    confirmLabel: "Delete forever",
    cancelLabel: "Cancel",
    onConfirm,
  };
  const view = render(<ConfirmButton {...props} pending={pending} />);
  return {
    onConfirm,
    setPending: (next: boolean) => view.rerender(<ConfirmButton {...props} pending={next} />),
  };
}

const trigger = () => screen.getByRole("button", { name: "Delete forever" });

describe("ConfirmButton", () => {
  it("does nothing on the first click — it asks", () => {
    const { onConfirm } = renderConfirm();
    fireEvent.click(trigger());
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(PROMPT);
  });

  it("acts only on the second, deliberate click", () => {
    const { onConfirm } = renderConfirm();
    fireEvent.click(trigger());
    fireEvent.click(trigger());
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("puts focus on Cancel, so the destructive button is never the one already under the keyboard", () => {
    renderConfirm();
    fireEvent.click(trigger());
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
  });

  it("cancelling withdraws the question, calls nothing, and hands focus back", () => {
    const { onConfirm } = renderConfirm();
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(trigger()).toHaveFocus();
  });

  // Marked rather than disabled (#368): Chrome drops focus to <body> the moment
  // the focused control becomes disabled, so the confirm the user just pressed
  // would take their place on the page with it. `aria-disabled` announces the
  // same state and keeps them where they are; the refusal moves to the handler,
  // which is what this asserts rather than the attribute alone.
  it("holds the question open while the action runs, marking the confirm busy against a double send", () => {
    const { onConfirm, setPending } = renderConfirm();
    fireEvent.click(trigger());
    fireEvent.click(trigger());
    expect(onConfirm).toHaveBeenCalledTimes(1);

    setPending(true);
    expect(screen.getByRole("alert")).toHaveTextContent(PROMPT);
    expect(trigger()).toHaveAttribute("aria-disabled", "true");
    expect(trigger(), "`disabled` is what loses focus — the state is marked, not enforced").toBeEnabled();

    // And the mark is not decoration: a second press while it is in flight is
    // refused by the handler.
    fireEvent.click(trigger());
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled();
  });

  it("closes once the action it started has finished", () => {
    const { setPending } = renderConfirm();
    fireEvent.click(trigger());
    setPending(true);
    setPending(false);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(trigger()).toBeEnabled();
    expect(trigger()).not.toHaveAttribute("aria-disabled");
  });

  it("stays shut when something else on the page finishes a request", () => {
    // pending flipping without this button having opened must not pop a prompt.
    const { setPending } = renderConfirm();
    setPending(true);
    setPending(false);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
