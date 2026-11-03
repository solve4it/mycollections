import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

/**
 * Says something to screen-reader users without showing it (#41).
 *
 * Every hidden message in the app goes through the shell's one polite region —
 * a region mounted with its text already inside it is announced by VoiceOver but
 * usually not by NVDA or JAWS, so pages must not bring their own. See "Page
 * titles and route announcements" in DEVELOPMENT.md.
 */
export type Announce = (message: string) => void;

/**
 * How long a message stays in the region. Long enough for a screen reader that
 * is mid-sentence to reach it; after that it only clutters a region a user
 * might browse into.
 */
export const ANNOUNCEMENT_LIFETIME_MS = 7_000;

export interface Announcement {
  id: number;
  text: string;
}

/** A no-op outside the shell, so a screen rendered on its own in a test still works. */
const AnnouncerContext = createContext<Announce>(() => {});

export const AnnouncerProvider = AnnouncerContext.Provider;

/** The shell's announcer, for a page to speak through. */
export function useAnnounce(): Announce {
  return useContext(AnnouncerContext);
}

/**
 * The state behind the shell's region: one entry per message, each removed once
 * its lifetime is up.
 *
 * One node per message is the technique `@react-aria/live-announcer` uses, and
 * it answers two problems at once. Writing identical text over identical text is
 * no change, so "2 items match" after a different query that also matched two
 * would be silent — but a new node is an addition, which a polite region always
 * reports. And a route announcement and a page's own message in the same tick
 * both survive, instead of the last write erasing the first. Removing a node
 * announces nothing: `aria-relevant` defaults to `additions text`.
 */
export function useAnnouncements(): { messages: Announcement[]; announce: Announce } {
  const [messages, setMessages] = useState<Announcement[]>([]);
  const nextId = useRef(0);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending) clearTimeout(timer);
      pending.clear();
    };
  }, []);

  const announce = useCallback<Announce>((text) => {
    if (!text) return;
    nextId.current += 1;
    const id = nextId.current;
    setMessages((current) => [...current, { id, text }]);
    const timer = setTimeout(() => {
      timers.current.delete(timer);
      setMessages((current) => current.filter((message) => message.id !== id));
    }, ANNOUNCEMENT_LIFETIME_MS);
    timers.current.add(timer);
  }, []);

  return { messages, announce };
}

/**
 * The region itself: in the document from first paint and empty, filled
 * afterwards. No role — `aria-live` is the whole contract, and `role="status"`
 * would make every page-level `getByRole("status")` ambiguous. No `aria-atomic`,
 * which would re-read every message still held whenever one is added.
 */
export function Announcer({ messages }: { messages: Announcement[] }) {
  return (
    <div aria-live="polite" className="visually-hidden">
      {messages.map((message) => (
        <div key={message.id}>{message.text}</div>
      ))}
    </div>
  );
}
