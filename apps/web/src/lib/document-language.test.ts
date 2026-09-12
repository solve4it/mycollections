import { createInstance, type i18n as I18n } from "i18next";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyDocumentLanguage, directionForLanguage, syncDocumentLanguage } from "./document-language.js";

/**
 * Every assertion here uses a language that is visibly not "en", and a
 * direction that is visibly not "ltr": index.html ships `lang="en" dir="ltr"`,
 * so a test that only proves the attributes are *present* — or that they hold
 * those two values — passes against the unfixed code.
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
  document.documentElement.dir = "ltr";
});

afterEach(() => {
  document.documentElement.lang = "en";
  document.documentElement.dir = "ltr";
});

describe("directionForLanguage", () => {
  it.each([
    ["ar", "rtl"],
    ["he-IL", "rtl"],
    ["fa", "rtl"],
    ["ur-PK", "rtl"],
    ["ckb", "rtl"],
    ["dv", "rtl"],
    ["en", "ltr"],
    ["pt-BR", "ltr"],
    ["ja", "ltr"],
  ])("reads %o as %o", (language, direction) => {
    expect(directionForLanguage(language)).toBe(direction);
  });

  it("falls back to ltr for a tag Intl cannot parse, rather than throwing", () => {
    expect(directionForLanguage("not a language tag")).toBe("ltr");
  });

  describe("on a browser without Intl text info", () => {
    // `getTextInfo`/`textInfo` are newer than this app's build target
    // (safari16.4, firefox114), so the script fallback is a path real users
    // take — and one Node's own Intl would otherwise never exercise here.
    const proto = Intl.Locale.prototype as Record<string, unknown>;
    const removed: Record<string, PropertyDescriptor> = {};

    beforeEach(() => {
      for (const name of ["getTextInfo", "textInfo"]) {
        const descriptor = Object.getOwnPropertyDescriptor(proto, name);
        if (descriptor) {
          removed[name] = descriptor;
          delete proto[name];
        }
      }
    });

    afterEach(() => {
      for (const [name, descriptor] of Object.entries(removed)) Object.defineProperty(proto, name, descriptor);
    });

    it.each([
      ["ar", "rtl"],
      ["yi", "rtl"],
      ["dv", "rtl"],
      ["de", "ltr"],
      ["ko", "ltr"],
    ])("falls back to the script of %o and reads it as %o", (language, direction) => {
      expect(directionForLanguage(language)).toBe(direction);
    });
  });
});

describe("applyDocumentLanguage", () => {
  it("stamps the language on the document element", () => {
    applyDocumentLanguage("fr-CA");
    expect(document.documentElement.lang).toBe("fr-CA");
  });

  it("stamps the direction that goes with it", () => {
    applyDocumentLanguage("he");
    expect(document.documentElement.dir).toBe("rtl");
  });
});

describe("syncDocumentLanguage", () => {
  it("stamps the language i18next resolved at startup", () => {
    syncDocumentLanguage(instanceWith({ en: "hello", de: "hello there" }, "de"));
    expect(document.documentElement.lang).toBe("de");
  });

  it("stamps its direction at startup too", () => {
    syncDocumentLanguage(instanceWith({ en: "hello", ar: "hello there" }, "ar"));
    expect(document.documentElement.lang).toBe("ar");
    expect(document.documentElement.dir).toBe("rtl");
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

  it("flips the direction in both directions on a change", () => {
    const i18n = instanceWith({ en: "hello", he: "hello there" }, "en");
    syncDocumentLanguage(i18n);
    expect(document.documentElement.dir).toBe("ltr");

    void i18n.changeLanguage("he");
    expect(document.documentElement.dir).toBe("rtl");

    void i18n.changeLanguage("en");
    expect(document.documentElement.dir).toBe("ltr");
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

  it("keeps the direction on the rendered language too, so English never reverses", () => {
    // The sharper half of the same rule: an unbundled Arabic would otherwise
    // turn the whole English layout right-to-left.
    const i18n = instanceWith({ en: "hello" }, "en");
    syncDocumentLanguage(i18n);

    void i18n.changeLanguage("ar");
    expect(i18n.language).toBe("ar");
    expect(document.documentElement.lang).toBe("en");
    expect(document.documentElement.dir).toBe("ltr");
  });

  it("uses the region-qualified tag when that is what resolved", () => {
    syncDocumentLanguage(instanceWith({ en: "hello", "pt-BR": "hello there" }, "pt-BR"));
    expect(document.documentElement.lang).toBe("pt-BR");
  });

  it("leaves the markup's language and direction alone when i18next resolved none", () => {
    document.documentElement.dir = "rtl";
    const stub = { language: undefined, resolvedLanguage: undefined, on: () => stub } as unknown as I18n;
    syncDocumentLanguage(stub);
    expect(document.documentElement.lang).toBe("en");
    expect(document.documentElement.dir).toBe("rtl");
  });
});
