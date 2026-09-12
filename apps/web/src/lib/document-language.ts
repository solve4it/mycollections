/**
 * Document language and direction (#277). `index.html` ships `lang="en"
 * dir="ltr"` so the markup is labelled before a single script runs; from then
 * on the app owns both attributes, the same way `applyTheme` owns `data-theme`
 * (#25).
 *
 * WCAG 3.1.1 asks the attributes to describe the language the page is actually
 * rendered in, so they follow i18next's *resolved* language rather than the
 * requested one: asking for a locale we ship no translations for leaves every
 * string English, and `lang="de"` over English text fails the same criterion
 * from the other side. `dir` follows the resolved language for a blunter
 * reason still — an unbundled Arabic would otherwise reverse a page that is
 * still rendering English.
 */

import type { i18n as I18n } from "i18next";

export type TextDirection = "ltr" | "rtl";

/**
 * `Intl.Locale` knows every locale's direction from CLDR, through
 * `getTextInfo()` (and the older `textInfo` accessor it replaced). Neither is
 * in this app's build target — `safari16.4`, `firefox114` — so both are
 * optional here, and `directionForLanguage` has a path for their absence.
 */
interface LocaleTextInfo {
  direction?: string;
}

interface LocaleWithTextInfo extends Intl.Locale {
  getTextInfo?: () => LocaleTextInfo;
  textInfo?: LocaleTextInfo;
}

/**
 * The fallback for browsers without the accessors above: the locale is still
 * maximized by CLDR's likely-subtags data, so only the step from script to
 * direction is ours. That is the stable half — a script's direction is a property of the
 * writing system and does not change, whereas a list of right-to-left
 * *languages* goes stale every time CLDR adds one.
 *
 * ISO 15924 codes, limited to the right-to-left scripts still written today:
 * a locale that a UI ships in cannot maximize to a historic one.
 */
const RTL_SCRIPTS: ReadonlySet<string> = new Set([
  "Adlm",
  "Arab",
  "Aran",
  "Hebr",
  "Mand",
  "Mend",
  "Nkoo",
  "Rohg",
  "Samr",
  "Syrc",
  "Thaa",
  "Yezi",
]);

/**
 * The writing direction of a language tag, left-to-right for anything the
 * platform cannot place — including a tag `Intl.Locale` refuses to parse, since
 * i18next will happily carry a language code the detector read out of storage.
 */
export function directionForLanguage(language: string): TextDirection {
  let locale: LocaleWithTextInfo;
  try {
    locale = new Intl.Locale(language);
  } catch {
    return "ltr";
  }

  const direction = (locale.getTextInfo?.() ?? locale.textInfo)?.direction;
  if (direction === "rtl" || direction === "ltr") return direction;

  const script = locale.maximize().script;
  return script !== undefined && RTL_SCRIPTS.has(script) ? "rtl" : "ltr";
}

/** Stamps both attributes: the language, and the direction that goes with it. */
export function applyDocumentLanguage(language: string): void {
  document.documentElement.lang = language;
  document.documentElement.dir = directionForLanguage(language);
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
 * `languageChanged`, so this would need that event too. That applies to `dir`
 * exactly as it does to `lang`, and more visibly: the page would be laid out
 * in the wrong direction until the next change.
 */
export function syncDocumentLanguage(i18n: I18n): void {
  const apply = () => {
    const language = resolveDocumentLanguage(i18n);
    // Nothing resolved: leave whatever index.html declared, rather than
    // stamping "undefined" over a valid tag — and, for the same reason, leave
    // the direction it declared beside it.
    if (language) applyDocumentLanguage(language);
  };

  apply();
  i18n.on("languageChanged", apply);
}
