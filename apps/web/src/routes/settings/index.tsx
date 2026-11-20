import { createRoute, useNavigate } from "@tanstack/react-router";
import { type ChangeEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "../../components/Icon.js";
import { ImportBackup } from "../../components/ImportBackup.js";
import { TrashSection } from "../../components/TrashSection.js";
import { clearToken, exportData, isTokenSessionOnly } from "../../lib/api-client.js";
import { isErrorReportingEnabled, setErrorReportingEnabled } from "../../lib/error-reporter.js";
import { getThemePreference, isThemePreference, setThemePreference } from "../../lib/theme.js";
import { authenticatedRoute } from "../_authenticated.js";

export const settingsRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: "/settings",
  staticData: { titleKey: "settings:title" },
  component: SettingsPage,
});

const SUPPORTED_LANGUAGES = [{ code: "en", labelKey: "language_en" }] as const;

/** System first: it is the default, and the explicit picks read as overrides of it. */
const THEME_OPTIONS = [
  { value: "system", labelKey: "theme_system" },
  { value: "light", labelKey: "theme_light" },
  { value: "dark", labelKey: "theme_dark" },
] as const;

function SettingsPage() {
  const { t, i18n } = useTranslation("settings");
  const navigate = useNavigate();
  const [exportError, setExportError] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [errorReporting, setErrorReporting] = useState(isErrorReportingEnabled);
  const [theme, setTheme] = useState(getThemePreference);

  function handleThemeChange(event: ChangeEvent<HTMLSelectElement>) {
    const next = event.target.value;
    if (!isThemePreference(next)) return;
    setThemePreference(next);
    setTheme(next);
  }

  function handleErrorReportingChange(event: ChangeEvent<HTMLInputElement>) {
    setErrorReportingEnabled(event.target.checked);
    setErrorReporting(event.target.checked);
  }

  function handleUnpair() {
    clearToken();
    void navigate({ to: "/setup" });
  }

  async function handleExport() {
    // What `disabled` would do, without dropping focus to <body> (#45): a second
    // press while an export is building is ignored rather than starting another.
    if (exporting) return;
    setExporting(true);
    setExportError(false);
    try {
      const blob = await exportData();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `mycollections-export-${new Date().toISOString().slice(0, 10)}.zip`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch {
      setExportError(true);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div>
      <h1>{t("title")}</h1>

      {/* Language and theme were the only ungrouped controls on the page, so the
          heading outline — h1 then four h2s — skipped straight past them, and
          heading navigation could not reach them at all (#299). "Interface"
          rather than "Appearance", which frames the language control as a
          visual one for exactly the readers this heading is for. */}
      <section className="settings-interface">
        <h2>{t("interface_label")}</h2>
        <div className="form-row">
          <label htmlFor="language-select">{t("language_label")}</label>
          <select
            id="language-select"
            value={i18n.resolvedLanguage ?? i18n.language}
            onChange={(e) => {
              void i18n.changeLanguage(e.target.value);
            }}
          >
            {SUPPORTED_LANGUAGES.map(({ code, labelKey }) => (
              <option key={code} value={code}>
                {t(labelKey)}
              </option>
            ))}
          </select>
        </div>

        <div className="form-row">
          <label htmlFor="theme-select">{t("theme_label")}</label>
          <select id="theme-select" value={theme} onChange={handleThemeChange}>
            {THEME_OPTIONS.map(({ value, labelKey }) => (
              <option key={value} value={value}>
                {t(labelKey)}
              </option>
            ))}
          </select>
        </div>
      </section>

      <section className="settings-data">
        <h2>{t("data_label")}</h2>
        <p>{t("export_description")}</p>
        <button
          type="button"
          className="touch-target button-quiet"
          aria-disabled={exporting || undefined}
          onClick={handleExport}
        >
          <Icon name="export" />
          {t("export_button")}
        </button>
        {exportError && <p role="alert">{t("export_error")}</p>}

        <ImportBackup />
      </section>

      {/* Trash sits under Data: both are about what the app is holding, and the
          trash is where a delete is finally spent. */}
      <TrashSection />

      <section className="settings-privacy">
        <h2>{t("privacy_label")}</h2>
        <div className="form-row">
          <label htmlFor="error-reporting-toggle" className="checkbox-row">
            <input
              id="error-reporting-toggle"
              type="checkbox"
              checked={errorReporting}
              onChange={handleErrorReportingChange}
            />
            {t("error_reporting_label")}
          </label>
        </div>
        <p>{t("error_reporting_description")}</p>
      </section>

      <section className="settings-connection">
        <h2>{t("connection_label")}</h2>
        {/* Read on every render rather than held in state: another tab can
            clear the stored token, and the browser can evict it, long after
            this page mounted. A plain hint rather than a live region (#308):
            it is on screen from the moment this section renders and never
            changes afterwards, so a `role="status"` here could never announce
            anything — all it did was make every page-level status query
            ambiguous. */}
        {isTokenSessionOnly() && <p className="form-hint">{t("session_only_notice")}</p>}
        {/* "Unpair", not "Disconnect" (#241): the token survives restarts now, so
            the old reason to press this — a server that rotated its token — is
            gone. It forgets the token here only; there is one shared device token,
            and revoking it means deleting the token file and restarting the API. */}
        <p>{t("unpair_description")}</p>
        <button type="button" className="touch-target button-quiet" onClick={handleUnpair}>
          {t("unpair_button")}
        </button>
      </section>
    </div>
  );
}
