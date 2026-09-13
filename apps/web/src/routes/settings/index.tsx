import { createRoute, useNavigate } from "@tanstack/react-router";
import { type ChangeEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "../../components/Icon.js";
import { TrashSection } from "../../components/TrashSection.js";
import { clearToken, exportData, isTokenSessionOnly } from "../../lib/api-client.js";
import { isErrorReportingEnabled, setErrorReportingEnabled } from "../../lib/error-reporter.js";
import { useImportData } from "../../lib/queries.js";
import { getThemePreference, isThemePreference, setThemePreference } from "../../lib/theme.js";
import { rootRoute } from "../__root.js";

export const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
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
  const importData = useImportData();
  const [exportError, setExportError] = useState(false);
  const [importInvalid, setImportInvalid] = useState(false);
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

  function handleDisconnect() {
    clearToken();
    void navigate({ to: "/setup" });
  }

  async function handleExport() {
    setExportError(false);
    try {
      const blob = await exportData();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `mycollections-export-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch {
      setExportError(true);
    }
  }

  async function handleImportFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Reset the input so re-selecting the same file fires onChange again.
    event.target.value = "";
    if (!file) return;

    setImportInvalid(false);
    importData.reset();
    try {
      const document = JSON.parse(await file.text());
      importData.mutate(document);
    } catch {
      setImportInvalid(true);
    }
  }

  const importFailed = importInvalid || importData.isError;

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
        <button type="button" className="touch-target button-quiet" onClick={handleExport}>
          <Icon name="export" />
          {t("export_button")}
        </button>
        {exportError && <p role="alert">{t("export_error")}</p>}

        <p>{t("import_description")}</p>
        {/* The icon sits beside the file input rather than inside a styled
            label: restyling the picker itself belongs to the forms pass (#224). */}
        <div className="import-row">
          <Icon name="import" />
          <input
            id="import-file"
            type="file"
            accept="application/json,.json"
            className="touch-target"
            aria-label={t("import_button")}
            disabled={importData.isPending}
            onChange={handleImportFile}
          />
        </div>
        {/* Always rendered, never conditional (#326). Both messages used to be
            `role="status"` nodes created with their text already inside them,
            and a live region inserted with content is announced by VoiceOver but
            usually not by NVDA or JAWS — so an import's progress, and its
            result, were announced to a fraction of the readers who needed them.
            The region is here from the section's first commit, empty, and the
            words arrive in it.

            No role on the region and none on what lands inside: `role="status"`
            implies `aria-live`, so a role on the message would make the message
            the nearest live region for its own insertion and lose the
            announcement. No `aria-atomic` either — the pending line is replaced
            in place by the summary, and atomic would re-read the whole region
            rather than what changed.

            No layout wrapper, unlike the undo toast's: this region is in normal
            flow with nothing to position, and an empty one is zero-height.

            The failure stays outside it. `role="alert"` is a live region in its
            own right, and a live region nested in a live region owns its own
            subtree, so the polite one would never speak for it. */}
        <div className="import-live" aria-live="polite">
          {importData.isPending && <p>{t("import_pending")}</p>}
          {importData.isSuccess && <p>{t("import_success", { ...importData.data })}</p>}
        </div>
        {importFailed && <p role="alert">{t("import_error")}</p>}
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
        <p>{t("disconnect_description")}</p>
        <button type="button" className="touch-target button-quiet" onClick={handleDisconnect}>
          {t("disconnect_button")}
        </button>
      </section>
    </div>
  );
}
