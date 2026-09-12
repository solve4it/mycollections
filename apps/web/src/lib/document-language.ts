/**
 * Document language (#277). `index.html` ships `lang="en"` so the markup is
 * labelled before a single script runs; from then on the app owns the
 * attribute, the same way `applyTheme` owns `data-theme` (#25).
 *
 * WCAG 3.1.1 asks the attribute to name the language the page is actually
 * rendered in, so it follows i18next's *resolved* language rather than the
 * requested one: asking for a locale we ship no translations for leaves every
 * string English, and `lang="de"` over English text fails the same criterion
 * from the other side.
 */

import type { i18n as I18n } from "i18next";

export function applyDocumentLanguage(language: string): void {
  document.documentElement.lang = language;
}

/**
 * The language whose bundle i18next is actually reading, falling back to the
 * requested one when nothing resolved (a translator preview mode, or a
 * language whose bundle is not loaded) and to nothing at all before init.
 */
export function resolveDocumentLanguage(i18n: I18n): string | undefined {
  return i18n.resolvedLanguage ?? i18n.language;
}

/**
 * Stamps the current language and keeps it stamped. i18next updates
 * `resolvedLanguage` before it emits `languageChanged`, so the listener reads
 * the instance rather than the event's requested-language argument.
 *
 * Registered once for the life of the document (from `main.tsx`), so there is
 * deliberately nothing to unsubscribe.
 *
 * Every locale is bundled into `init`, which is what makes the startup stamp
 * correct on a reload. A locale fetched lazily instead would resolve to the
 * fallback before its bundle lands — and arrive on `loaded`, not
 * `languageChanged`, so this would need that event too.
 */
export function syncDocumentLanguage(i18n: I18n): void {
  const apply = () => {
    const language = resolveDocumentLanguage(i18n);
    // Nothing resolved: leave whatever index.html declared, rather than
    // stamping "undefined" over a valid tag.
    if (language) applyDocumentLanguage(language);
  };

  apply();
  i18n.on("languageChanged", apply);
}
