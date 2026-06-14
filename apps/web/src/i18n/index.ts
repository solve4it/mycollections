import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";
import enCollections from "../locales/en/collections.json";
import enCommon from "../locales/en/common.json";
import enSettings from "../locales/en/settings.json";
import enSetup from "../locales/en/setup.json";

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: {
        common: enCommon,
        collections: enCollections,
        settings: enSettings,
        setup: enSetup,
      },
    },
    fallbackLng: "en",
    defaultNS: "common",
    interpolation: { escapeValue: false },
    initAsync: false,
    detection: {
      order: ["localStorage", "navigator"],
      caches: ["localStorage"],
    },
  });

export default i18n;
