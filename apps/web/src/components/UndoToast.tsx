import { useEffect, useState } from "react";
import { Icon } from "./Icon.js";

/** How long the shortcut stays on screen. Long enough to read the name and reach the button. */
export const UNDO_WINDOW_MS = 10_000;

interface UndoToastProps {
  /** What happened, naming the thing it happened to. */
  message: string;
  actionLabel: string;
  dismissLabel: string;
  onAction: () => void;
  onDismiss: () => void;
  /** Milliseconds the toast stays up. Defaults to `UNDO_WINDOW_MS`. */
  duration?: number;
}

/**
 * The undo shortcut shown after a delete (#33).
 *
 * `role="status"` rather than `role="alert"`: nothing has gone wrong, so the
 * confirmation is announced politely and does not interrupt whatever the user is
 * typing. The action is a real `<button>` inside the region, reachable in tab
 * order — not a click handler on the toast itself.
 *
 * On the timeout and WCAG 2.2.1 (Timing Adjustable): the window limits the
 * *shortcut*, never the outcome. A delete is soft, so once the toast goes the
 * item is still in the trash and still restorable from Settings — nothing is
 * lost by missing it. The timer is held open while the pointer is over the toast
 * or focus is inside it, so reading it or tabbing to the button cannot time a
 * user out mid-reach; leaving restarts the full window rather than resuming a
 * nearly-expired one, so the button does not vanish as the pointer moves away.
 *
 * The entrance is a CSS animation, so the global `prefers-reduced-motion` opt-out
 * in `global.css` removes it without this component knowing anything about it.
 */
export function UndoToast({
  message,
  actionLabel,
  dismissLabel,
  onAction,
  onDismiss,
  duration = UNDO_WINDOW_MS,
}: UndoToastProps) {
  const [held, setHeld] = useState(false);

  useEffect(() => {
    if (held) return;
    const timer = setTimeout(onDismiss, duration);
    return () => clearTimeout(timer);
  }, [held, duration, onDismiss]);

  return (
    // The mouse handlers only pause the auto-dismiss timer — no behavior is
    // mouse-only: every action has its own button, and the focus/blur pair beside
    // them is the keyboard equivalent of hovering.
    <div
      className="undo-toast"
      role="status"
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
    >
      <span className="undo-toast-message">{message}</span>
      <button type="button" className="touch-target undo-toast-action" onClick={onAction}>
        {actionLabel}
      </button>
      <button type="button" className="touch-target undo-toast-dismiss" aria-label={dismissLabel} onClick={onDismiss}>
        <Icon name="cross" />
      </button>
    </div>
  );
}
