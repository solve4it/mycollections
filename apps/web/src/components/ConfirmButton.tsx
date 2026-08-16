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
          className="touch-target button-danger"
          disabled={pending}
          onClick={onConfirm}
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
