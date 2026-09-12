import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import i18n from "../i18n/index.js";
import { syncDocumentLanguage } from "./document-language.js";

/**
 * The other half of the contract: `main.tsx` hands the app's real i18next
 * singleton to syncDocumentLanguage, and index.html carries a hardcoded
 * starting value for the window before that runs. This test drives that exact
 * instance — detector, namespaces and all — and fails if the markup's default
 * ever stops matching the configured fallback.
 *
 * Named *.integration.test.ts because it reads index.html off disk with Node
 * APIs (same convention as theme-boot.integration.test.ts).
 */

// vitest runs with the package as cwd.
const html = readFileSync(resolve("index.html"), "utf8");
const markupLanguage = /<html[^>]*\slang="(?<lang>[^"]*)"/.exec(html)?.groups?.lang;

afterEach(async () => {
  await i18n.changeLanguage("en");
  i18n.removeResourceBundle("de", "common");
  document.documentElement.lang = "en";
});

describe("index.html", () => {
  it("declares the fallback language, so the pre-script window is labelled", () => {
    // i18next normalizes fallbackLng to an array; the first entry is the one
    // an unmatched language lands on, and so the one the markup should claim.
    const [fallback] = [i18n.options.fallbackLng].flat();
    expect(markupLanguage).toBe(fallback);
  });
});

describe("the app's i18next instance", () => {
  it("drives <html lang> when a second locale is selected", async () => {
    // The one locale that ships is "en", so a bundle is added here to stand in
    // for the second one: without it every assertion below would read "en"
    // whether the attribute followed the language or was left hardcoded.
    i18n.addResourceBundle("de", "common", { app_name: "MyCollections" });
    syncDocumentLanguage(i18n);
    expect(document.documentElement.lang).toBe("en");

    await i18n.changeLanguage("de");
    expect(document.documentElement.lang).toBe("de");

    await i18n.changeLanguage("en");
    expect(document.documentElement.lang).toBe("en");
  });
});
