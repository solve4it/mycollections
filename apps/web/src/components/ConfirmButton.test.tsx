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
  /**
   * The question is spoken as part of landing on Cancel, not by a live region
   * (#335). Focus moves to Cancel the moment the prompt opens, and a focused
   * control's description is read with its name and role by every screen
   * reader — no insert-timing race, and no `role="alert"` claiming a question
   * is a failure. The confirm carries it too, so tabbing to the destructive
   * button re-reads the consequence before it can be pressed.
   */
  it("speaks the question with the control focus lands on, and with the confirm", () => {
    renderConfirm();
    fireEvent.click(trigger());
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveAccessibleDescription(PROMPT);
    expect(trigger()).toHaveAccessibleDescription(PROMPT);
  });

  it("is not an alert — a confirmation is a question, not a failure (#335)", () => {
    renderConfirm();
    fireEvent.click(trigger());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText(PROMPT)).not.toHaveAttribute("aria-live");
  });

  it("gives each instance its own prompt id, so two open questions never describe each other's buttons", () => {
    const props = {
      label: "Delete forever",
      confirmLabel: "Delete forever",
      cancelLabel: "Cancel",
      onConfirm: vi.fn(),
    };
    render(
      <>
        <ConfirmButton {...props} prompt="First question?" />
        <ConfirmButton {...props} prompt="Second question?" />
      </>,
    );
    for (const button of screen.getAllByRole("button", { name: "Delete forever" })) fireEvent.click(button);
    const cancels = screen.getAllByRole("button", { name: "Cancel" });
    expect(cancels[0]).toHaveAccessibleDescription("First question?");
    expect(cancels[1]).toHaveAccessibleDescription("Second question?");
  });

  it("does nothing on the first click — it asks", () => {
    const { onConfirm } = renderConfirm();
    fireEvent.click(trigger());
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByText(PROMPT)).toBeInTheDocument();
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
    expect(screen.queryByText(PROMPT)).not.toBeInTheDocument();
    expect(trigger()).toHaveFocus();
  });

  it("Escape withdraws the question from either button, calls nothing, and hands focus back (#376)", () => {
    const { onConfirm } = renderConfirm();
    fireEvent.click(trigger());
    fireEvent.keyDown(screen.getByRole("button", { name: "Cancel" }), { key: "Escape" });
    expect(screen.queryByText(PROMPT)).not.toBeInTheDocument();
    expect(trigger()).toHaveFocus();

    fireEvent.click(trigger());
    fireEvent.keyDown(trigger(), { key: "Escape" });
    expect(screen.queryByText(PROMPT)).not.toBeInTheDocument();
    expect(trigger()).toHaveFocus();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("ignores Escape while the confirmed action is in flight, as the confirm ignores a second press (#376)", () => {
    const { setPending } = renderConfirm();
    fireEvent.click(trigger());
    fireEvent.click(trigger());
    setPending(true);
    fireEvent.keyDown(trigger(), { key: "Escape" });
    expect(screen.getByText(PROMPT)).toBeInTheDocument();
  });

  it("leaves other keys alone", () => {
    renderConfirm();
    fireEvent.click(trigger());
    fireEvent.keyDown(screen.getByRole("button", { name: "Cancel" }), { key: "a" });
    expect(screen.getByText(PROMPT)).toBeInTheDocument();
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
    expect(screen.getByText(PROMPT)).toBeInTheDocument();
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
    expect(screen.queryByText(PROMPT)).not.toBeInTheDocument();
    expect(trigger()).toBeEnabled();
    expect(trigger()).not.toHaveAttribute("aria-disabled");
  });

  it("stays shut when something else on the page finishes a request", () => {
    // pending flipping without this button having opened must not pop a prompt.
    const { setPending } = renderConfirm();
    setPending(true);
    setPending(false);
    expect(screen.queryByText(PROMPT)).not.toBeInTheDocument();
  });
});
