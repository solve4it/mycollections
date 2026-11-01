import { useEffect, useRef, useState } from "react";
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
   * identical "Delete forever" buttons, and the `role="alert"` beside each was
   * announced when it was inserted rather than being part of any name.
   */
  accessibleLabel?: string;
  onConfirm: () => void;
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
 * the prompt is announced (`role="alert"`), focus lands on the safe option
 * rather than falling to the body when the trigger unmounts, and cancelling
 * hands focus back to the button the user pressed.
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
      <p role="alert" className="confirm-prompt">
        {prompt}
      </p>
      <div className="confirm-actions">
        <button
          ref={triggerRef}
          type="button"
          aria-label={accessibleLabel}
          className="touch-target button-danger"
          // `aria-disabled`, never `disabled` (#368): Chrome drops focus to
          // <body> when the focused control is disabled, so the confirm the
          // user just pressed would take their place on the page with it. The
          // handler is what refuses the second press.
          aria-disabled={pending || undefined}
          onClick={() => {
            if (pending) return;
            onConfirm();
          }}
        >
          {confirmLabel}
        </button>
        <button
          ref={cancelRef}
          type="button"
          className="touch-target button-quiet"
          onClick={() => {
            returnFocus.current = true;
            setAsking(false);
          }}
        >
          {cancelLabel}
        </button>
      </div>
    </div>
  );
}
