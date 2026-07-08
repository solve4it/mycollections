import { createRoute, useNavigate } from "@tanstack/react-router";
import { type ChangeEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { clearToken, exportData } from "../../lib/api-client.js";
import { isErrorReportingEnabled, setErrorReportingEnabled } from "../../lib/error-reporter.js";
import { useImportData } from "../../lib/queries.js";
import { rootRoute } from "../__root.js";

export const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: SettingsPage,
});

const SUPPORTED_LANGUAGES = [{ code: "en", labelKey: "language_en" }] as const;

function SettingsPage() {
  const { t, i18n } = useTranslation("settings");
  const navigate = useNavigate();
  const importData = useImportData();
  const [exportError, setExportError] = useState(false);
  const [importInvalid, setImportInvalid] = useState(false);
  const [errorReporting, setErrorReporting] = useState(isErrorReportingEnabled);

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

      <section className="settings-data">
        <h2>{t("data_label")}</h2>
        <p>{t("export_description")}</p>
        <button type="button" className="touch-target" onClick={handleExport}>
          {t("export_button")}
        </button>
        {exportError && <p role="alert">{t("export_error")}</p>}

        <p>{t("import_description")}</p>
        <input
          id="import-file"
          type="file"
          accept="application/json,.json"
          className="touch-target"
          aria-label={t("import_button")}
          onChange={handleImportFile}
        />
        {importData.isSuccess && <p role="status">{t("import_success", { ...importData.data })}</p>}
        {importFailed && <p role="alert">{t("import_error")}</p>}
      </section>

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
        <p>{t("disconnect_description")}</p>
        <button type="button" className="touch-target" onClick={handleDisconnect}>
          {t("disconnect_button")}
        </button>
      </section>
    </div>
  );
}
