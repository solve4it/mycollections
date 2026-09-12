import { createInstance, type i18n as I18n } from "i18next";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyDocumentLanguage, syncDocumentLanguage } from "./document-language.js";

/**
 * Every assertion here uses a language that is visibly not "en": the attribute
 * ships hardcoded as `lang="en"` in index.html, so a test that only proves it
 * is *present*, or that it equals "en", passes against the unfixed code.
 */

function instanceWith(languages: Record<string, string>, lng: string): I18n {
  const i18n = createInstance();
  const resources = Object.fromEntries(
    Object.entries(languages).map(([code, greeting]) => [code, { translation: { greeting } }]),
  );
  void i18n.init({ resources, lng, fallbackLng: "en", initAsync: false, interpolation: { escapeValue: false } });
  return i18n;
}

beforeEach(() => {
  document.documentElement.lang = "en";
});

afterEach(() => {
  document.documentElement.lang = "en";
});

describe("applyDocumentLanguage", () => {
  it("stamps the language on the document element", () => {
    applyDocumentLanguage("fr-CA");
    expect(document.documentElement.lang).toBe("fr-CA");
  });
});

describe("syncDocumentLanguage", () => {
  it("stamps the language i18next resolved at startup", () => {
    syncDocumentLanguage(instanceWith({ en: "hello", de: "hello there" }, "de"));
    expect(document.documentElement.lang).toBe("de");
  });

  it("restamps it on every language change", () => {
    const i18n = instanceWith({ en: "hello", de: "hello there", fr: "good day" }, "de");
    syncDocumentLanguage(i18n);
    expect(document.documentElement.lang).toBe("de");

    void i18n.changeLanguage("fr");
    expect(document.documentElement.lang).toBe("fr");

    void i18n.changeLanguage("en");
    expect(document.documentElement.lang).toBe("en");
  });

  it("names the language actually rendered, not the one requested", () => {
    // Asking for a locale we ship no translations for leaves every string in
    // English, so the attribute has to keep saying "en" — claiming "de" over
    // English text is the same WCAG 3.1.1 failure in the other direction.
    const i18n = instanceWith({ en: "hello" }, "en");
    syncDocumentLanguage(i18n);

    void i18n.changeLanguage("de");
    expect(i18n.language).toBe("de");
    expect(document.documentElement.lang).toBe("en");
  });

  it("uses the region-qualified tag when that is what resolved", () => {
    syncDocumentLanguage(instanceWith({ en: "hello", "pt-BR": "hello there" }, "pt-BR"));
    expect(document.documentElement.lang).toBe("pt-BR");
  });

  it("leaves the markup's language alone when i18next resolved none", () => {
    const stub = { language: undefined, resolvedLanguage: undefined, on: () => stub } as unknown as I18n;
    syncDocumentLanguage(stub);
    expect(document.documentElement.lang).toBe("en");
  });
});
