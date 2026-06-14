import { createRoute, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { clearToken } from "../../lib/api-client.js";
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

  function handleDisconnect() {
    clearToken();
    void navigate({ to: "/setup" });
  }

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
