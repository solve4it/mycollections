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
 * This component carries no live region of its own, and that is the point
 * (#308). It is mounted with its message already inside it, and a live region
 * inserted with its content is announced by VoiceOver but usually not by NVDA or
 * JAWS — so the `role="status"` this used to declare was the one announcement in
 * the app with a deadline on it going unheard by a large share of screen-reader
 * users. The region belongs to the page instead (`routes/collections/$id.tsx`):
 * it is in the document from the moment the screen renders, empty, and this
 * toast is what arrives in it.
 *
 * Putting a role back here would take the announcement away again rather than
 * double it: a mutation is announced by the *nearest* live-region ancestor, so
 * this element would own its own insertion — and its insertion is the thing
 * screen readers do not reliably announce.
 *
 * It is announced politely rather than assertively because nothing has gone
 * wrong: the confirmation must not interrupt whatever the user is typing. The
 * action is a real `<button>`, reachable in tab order — not a click handler on
 * the toast itself.
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
    //
    // The lint rule below wants a role on anything carrying handlers, and the
    // role that would fit is exactly the `role="status"` this element must not
    // have (#308) — it would make the toast the nearest live region for its own
    // insertion and silence the page's region.
    //
    // biome-ignore lint/a11y/noStaticElementInteractions: see above — timer only
    <div
      className="undo-toast"
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
