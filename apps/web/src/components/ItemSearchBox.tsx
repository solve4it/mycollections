import { ITEM_SEARCH_MAX_LENGTH } from "@mycollections/core";
import { type RefObject, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

/**
 * How long typing has to pause before the list is searched (#41). Long enough
 * that a word typed at speed is one request, short enough to feel live.
 */
export const SEARCH_DEBOUNCE_MS = 250;

interface ItemSearchBoxProps {
  /** The search in the URL — the source of truth this box reports to. */
  value: string;
  onSearch: (q: string) => void;
  /** Where focus goes after "Clear search" removes the button that held it. */
  inputRef?: RefObject<HTMLInputElement | null>;
}

/**
 * The collection screen's search box: an `<input type="search">` with a visible
 * label, inside a search landmark (#41).
 *
 * The text is local state so typing never waits on the router, and reaches the
 * URL after a pause — or at once on Enter. When the URL changes on its own
 * (Back, Forward, Clear search), the box follows it; when the URL merely
 * catches up with a value this box pushed, newer typing is kept rather than
 * overwritten by an echo of the past.
 */
export function ItemSearchBox({ value, onSearch, inputRef }: ItemSearchBoxProps) {
  const { t } = useTranslation("items");
  const id = useId();
  const [text, setText] = useState(value);
  const pushed = useRef(value);

  // Adjusting state during render when a prop changes is React's documented
  // alternative to an effect, which would show one stale commit first.
  const [seenValue, setSeenValue] = useState(value);
  if (seenValue !== value) {
    setSeenValue(value);
    if (value !== pushed.current) {
      pushed.current = value;
      setText(value);
    }
  }

  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  function push(next: string) {
    clearTimeout(timer.current);
    pushed.current = next;
    onSearch(next);
  }

  return (
    // `<search>` is the search landmark in every current browser. jsdom does not
    // map it, so the unit tests find it by tag and the e2e run checks the role.
    <search className="item-search">
      {/* .form-row: the same label and control styling as every other form. */}
      <form
        className="form-row"
        onSubmit={(event) => {
          event.preventDefault();
          push(text);
        }}
      >
        <label htmlFor={id}>{t("search_label")}</label>
        <input
          id={id}
          ref={inputRef}
          type="search"
          value={text}
          maxLength={ITEM_SEARCH_MAX_LENGTH}
          enterKeyHint="search"
          autoComplete="off"
          onChange={(event) => {
            const next = event.target.value;
            setText(next);
            clearTimeout(timer.current);
            timer.current = setTimeout(() => push(next), SEARCH_DEBOUNCE_MS);
          }}
        />
      </form>
    </search>
  );
}
