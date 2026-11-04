import { useCallback, useEffect, useRef } from "react";

/**
 * Where focus should go once the control holding it has been removed.
 *
 * A function rather than a ref, because two of the destinations cannot be held
 * as one: the row that takes a deleted row's place is a sibling component this
 * one has no reference to, and the row an Undo restores does not exist yet at
 * the moment focus is lost.
 *
 * Returning `null` means "not in the document yet" and is not a failure — the
 * handoff keeps asking on each commit until it is there or the bounds below run
 * out.
 */
export type FocusDestination = () => HTMLElement | null;

/**
 * How long a handoff waits for a destination that has not arrived.
 *
 * Both bounds, because either alone has a hole. Commits stop happening if the
 * action fails and nothing re-renders, so a count alone can leave a request
 * parked until some unrelated render much later picks it up and moves focus the
 * user has long since placed somewhere else. And a deadline alone would spin
 * through however many commits a busy screen produces inside it.
 */
const MAX_COMMITS = 20;
const DEADLINE_MS = 3_000;

interface Handoff {
  destination: FocusDestination;
  /** What held focus when the handoff was asked for. */
  from: Element | null;
  requestedAt: number;
  commits: number;
}

/**
 * Hands focus to a named destination when the control holding it goes away
 * (#367).
 *
 * Six actions in this app remove the control the user is standing on — a row's
 * Edit becomes a form, Cancel turns the form back into a row, Delete takes the
 * row, Undo and Dismiss take the toast, Remove field takes the field row, a
 * confirmed purge takes the trash row and its own trigger with it. Chrome puts
 * focus on `<body>` in every one of those cases: the tab sequence resumes
 * roughly in place, but a screen reader's virtual cursor drops to the top of
 * the page and nothing says where the user now is (WCAG 2.4.3).
 *
 * This is `ConfirmButton`'s hand-rolled return-focus pair (the one place that
 * already got this right) generalized, with the two things the other sites need
 * that it did not: a destination that is not a ref, and the patience to wait
 * for one that arrives on a later commit.
 *
 * The destinations themselves follow ARIA APG rather than this file's judgment:
 * the dialog pattern's return-to-invoker rule for anything that closes, the
 * disclosure pattern's enter-the-revealed-content rule for anything that opens,
 * and "Developing a Keyboard Interface" for the successor-element rule after a
 * deletion. Each caller names which it is following.
 *
 * Call the returned function from the handler that is about to remove the
 * control, and call it from a component that *survives* the removal: the effect
 * that completes the handoff runs after that component's next commit, so a hook
 * living inside the thing being unmounted dies before it can finish.
 */
export function useFocusHandoff(): (destination: FocusDestination) => void {
  const pending = useRef<Handoff | null>(null);

  // No dependency array: this has to run after every commit of the host, since
  // the commit that removes the control is not one this hook can predict.
  useEffect(() => {
    const handoff = pending.current;
    if (handoff === null) return;

    const active = document.activeElement;
    // <body> is never "the control that still holds focus": when the handoff
    // was asked for after focus had already fallen — a list fetched again can
    // commit ahead of the mutation's onSuccess and unmount the control first
    // (#41) — there is something to rescue at once, not something to wait for.
    const stillThere = handoff.from !== null && handoff.from !== document.body && document.contains(handoff.from);

    // Someone else holds focus, and holds it deliberately — a later click, or a
    // control that was never going anywhere. Moving focus then would be the
    // real surprise, so the request is dropped. This is the guard `Shell.tsx`
    // and `ErrorScreen.tsx` already apply before claiming focus.
    if (active !== null && active !== document.body && active !== handoff.from) {
      pending.current = null;
      return;
    }

    // The control is still in the document and still has focus: nothing has
    // been taken away yet, so there is nothing to rescue. Keep waiting.
    if (active === handoff.from && stillThere) return;

    const target = handoff.destination();
    if (target !== null) {
      pending.current = null;
      target.focus();
      return;
    }

    handoff.commits += 1;
    if (handoff.commits > MAX_COMMITS || Date.now() - handoff.requestedAt > DEADLINE_MS) pending.current = null;
  });

  return useCallback((destination: FocusDestination) => {
    pending.current = { destination, from: document.activeElement, requestedAt: Date.now(), commits: 0 };
  }, []);
}
