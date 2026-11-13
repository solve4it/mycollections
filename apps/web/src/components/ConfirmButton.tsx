import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { Icon, type IconName } from "./Icon.js";

interface ConfirmButtonProps {
  /** The resting button: the verb, before anything is asked. */
  label: string;
  /** What is about to happen, spelled out. Names the thing and says it cannot be undone. */
  prompt: string;
  /** The button that goes through with it. Repeating the verb beats a bare "Yes". */
  confirmLabel: string;
  cancelLabel: string;
  /**
   * The accessible name for both the trigger and the confirm, where the visible
   * label alone would not say what is being acted on (#375).
   *
   * Every trash row offers the same "Delete forever", so a screen-reader user
   * tabbing a list hears the same two words per row with nothing tying a press
   * to a record. The caller composes the name from a locale string — never this
   * component, which has no business building user-visible text — and must keep
   * the visible label inside it as a contiguous run, which WCAG 2.5.3 Label in
   * Name (Level A) requires and axe's `label-content-name-mismatch` checks.
   *
   * Both buttons take it, and the confirm needs it as much as the trigger:
   * `asking` is per-instance state and nothing closes the others, so several
   * prompts can stand open at once — at which point the page carries several
   * identical "Delete forever" buttons, and the prompt beside each is only their
   * description, never part of the name — which is also what tells those
   * open Cancels apart.
   */
  accessibleLabel?: string;
  /**
   * Receives the confirm button, which goes with the question once the action
   * lands: a caller handing focus on names it as the control being removed.
   */
  onConfirm: (confirm: HTMLButtonElement) => void;
  /** True while the confirmed action is in flight. Holds the question open and blocks a second send. */
  pending?: boolean;
  icon?: IconName;
  className?: string;
}

/**
 * A destructive action that asks first (#35). The trash is where deletes stop
 * being reversible, so every button in it that destroys data goes through this.
 *
 * Inline rather than a modal `<dialog>`: the standard element is the right
 * answer for a page-blocking decision, but these are row-scoped — the question
 * belongs beside the row it is about, and a modal would rip context away from
 * a one-line confirmation. What the dialog would have given us is kept by hand:
 * the prompt is announced, focus lands on the safe option rather than falling
 * to the body when the trigger unmounts, cancelling hands focus back to the
 * button the user pressed, and Escape cancels (#376).
 *
 * The announcement rides on focus, not on a live region (#335). Both answers
 * take the prompt as their `aria-describedby`, and focus lands on Cancel the
 * moment the question opens, so a screen reader speaks "Cancel, button" and
 * then the question — the way a `<dialog>` announces itself on focus entry,
 * with no insert-timing race. It used to be a `<p role="alert">`, which also
 * painted a question in the failure treatment. Not `role="alertdialog"`
 * either: that pattern is modal — trapped focus, an inert page — and these are
 * not; several can stand open at once. Nor focus on the prompt itself (a
 * `<p tabIndex={-1}>`): it would be spoken everywhere, but it costs a stop that
 * is not a control and leaves Cancel a Tab away. The trade is VoiceOver with
 * hints turned off in its verbosity settings, which skips descriptions on every
 * control; the sentence still sits right before the buttons in reading order.
 */
export function ConfirmButton({
  label,
  prompt,
  confirmLabel,
  cancelLabel,
  accessibleLabel,
  onConfirm,
  pending = false,
  icon,
  className,
}: ConfirmButtonProps) {
  const [asking, setAsking] = useState(false);
  const promptId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);
  const wasPending = useRef(pending);

  useEffect(() => {
    if (asking) cancelRef.current?.focus();
  }, [asking]);

  useEffect(() => {
    if (returnFocus.current) {
      returnFocus.current = false;
      triggerRef.current?.focus();
    }
  });

  // The action this button started has landed — success or failure, the question
  // has been answered and must not stay on screen. Guarded on the transition, so
  // a `pending` that belongs to some other control never opens this one.
  useEffect(() => {
    if (wasPending.current && !pending) setAsking(false);
    wasPending.current = pending;
  }, [pending]);

  function withdraw() {
    returnFocus.current = true;
    setAsking(false);
  }

  // Escape is Cancel by key (#376) — the one thing a modal <dialog> gives for
  // free that this hand-rolled version had dropped. On the buttons rather than
  // their row, which is not interactive and would need a role to carry a
  // handler. Refused while the action is in flight, like a second press of the
  // confirm: the question is held open until the answer lands, and withdrawing
  // it then would bring the trigger back only for the landing to remove it.
  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== "Escape" || pending) return;
    event.preventDefault();
    withdraw();
  }

  if (!asking) {
    return (
      <button
        ref={triggerRef}
        type="button"
        aria-label={accessibleLabel}
        className={className ? `touch-target ${className}` : "touch-target button-quiet"}
        onClick={() => setAsking(true)}
      >
        {icon && <Icon name={icon} />}
        {label}
      </button>
    );
  }

  return (
    <div className="confirm-row">
      <p id={promptId} className="confirm-prompt">
        {prompt}
      </p>
      <div className="confirm-actions">
        <button
          ref={triggerRef}
          type="button"
          aria-label={accessibleLabel}
          aria-describedby={promptId}
          className="touch-target button-danger"
          // `aria-disabled`, never `disabled` (#368): Chrome drops focus to
          // <body> when the focused control is disabled, so the confirm the
          // user just pressed would take their place on the page with it. The
          // handler is what refuses the second press.
          aria-disabled={pending || undefined}
          onClick={(event) => {
            if (pending) return;
            onConfirm(event.currentTarget);
          }}
          onKeyDown={handleKeyDown}
        >
          {confirmLabel}
        </button>
        <button
          ref={cancelRef}
          type="button"
          aria-describedby={promptId}
          className="touch-target button-quiet"
          onClick={withdraw}
          onKeyDown={handleKeyDown}
        >
          {cancelLabel}
        </button>
      </div>
    </div>
  );
}
