import { type KeyboardEvent, type ReactNode, type Ref, useId, useRef } from "react";
import { useTranslation } from "react-i18next";
import { scopedId } from "../lib/dom-id.js";
import { STATUS_TABS, type StatusTab } from "../lib/item-search.js";

/**
 * Literal keys, never a template: a key built from the tab's value is one
 * i18next's tooling and a reader's grep can both miss (R17).
 */
const TAB_LABEL_KEYS = {
  all: "tab_all",
  collected: "tab_collected",
  remaining: "tab_remaining",
} as const satisfies Record<StatusTab, string>;

interface StatusTabsProps {
  value: StatusTab;
  /** Asked for on click and on every arrow, Home and End: activation is automatic. */
  onSelect: (tab: StatusTab) => void;
  /** The panel, for a focus handoff that lands on whatever the panel now holds. */
  panelRef?: Ref<HTMLDivElement>;
  /** The panel's content: the count, the list and the empty states. */
  children: ReactNode;
}

/** Whether the tabs run right to left, which is where "next" is the *left* arrow (R12). */
function isRightToLeft(element: Element): boolean {
  return element.closest("[dir]")?.getAttribute("dir") === "rtl";
}

/**
 * All, Collected and Remaining over a collection's items (#42): the WAI-ARIA
 * APG tabs pattern, written here rather than taken from a library — it is one
 * tablist of three fixed tabs, and the pattern is short.
 *
 * - A `tablist` named for what it sorts, of `<button role="tab">`s: a real
 *   button answers Enter and Space with no handler, and keeps its own focus
 *   ring.
 * - Roving `tabIndex`: only the selected tab is in the tab order, so Tab moves
 *   from the tabs into the panel, and the arrows move between tabs.
 * - **Automatic activation**: an arrow selects as it moves. APG's condition for
 *   that is a panel that shows without a wait, and it does: the tabs narrow the
 *   list already fetched, on the client (R4), so no keystroke waits on a
 *   request.
 * - Left and Right swap in a right-to-left document, where the next tab is to
 *   the left; Home and End are first and last whichever way the tabs run.
 * - One `tabpanel`, labelled by the selected tab, with `tabIndex={0}`: its
 *   first content is the count or a row's text, not a control, so the panel is
 *   its own stop. It is also where focus goes when the list it holds empties
 *   under the user.
 *
 * No counts in the labels: a tab's name changing under a screen reader with
 * every edit is noise, and the panel says how many it holds.
 */
export function StatusTabs({ value, onSelect, panelRef, children }: StatusTabsProps) {
  const { t } = useTranslation("items");
  const idPrefix = useId();
  const panelId = scopedId(idPrefix, "panel");
  const tabRefs = useRef<Partial<Record<StatusTab, HTMLButtonElement | null>>>({});

  function move(to: StatusTab) {
    tabRefs.current[to]?.focus();
    if (to !== value) onSelect(to);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, from: StatusTab) {
    const index = STATUS_TABS.indexOf(from);
    const last = STATUS_TABS.length - 1;
    const rtl = isRightToLeft(event.currentTarget);
    let next: number;
    switch (event.key) {
      case "ArrowRight":
        next = rtl ? index - 1 : index + 1;
        break;
      case "ArrowLeft":
        next = rtl ? index + 1 : index - 1;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = last;
        break;
      default:
        return;
    }
    event.preventDefault();
    // Wraps at both ends, as the APG example does.
    move(STATUS_TABS[(next + STATUS_TABS.length) % STATUS_TABS.length] as StatusTab);
  }

  return (
    <>
      <div className="status-tabs" role="tablist" aria-label={t("status_tabs_label")}>
        {STATUS_TABS.map((tab) => {
          const selected = tab === value;
          return (
            <button
              key={tab}
              ref={(element) => {
                tabRefs.current[tab] = element;
              }}
              type="button"
              role="tab"
              id={scopedId(idPrefix, "tab", tab)}
              aria-selected={selected}
              aria-controls={panelId}
              tabIndex={selected ? 0 : -1}
              className="status-tab touch-target"
              onClick={() => move(tab)}
              onKeyDown={(event) => handleKeyDown(event, tab)}
            >
              {t(TAB_LABEL_KEYS[tab])}
            </button>
          );
        })}
      </div>
      <div
        ref={panelRef}
        className="status-panel"
        role="tabpanel"
        id={panelId}
        aria-labelledby={scopedId(idPrefix, "tab", value)}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: the APG tabs pattern — a panel whose first content is not a control is a tab stop of its own.
        tabIndex={0}
      >
        {children}
      </div>
    </>
  );
}
