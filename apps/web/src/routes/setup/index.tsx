import { createRoute, redirect, useNavigate } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { getToken, setToken } from "../../lib/api-client.js";
import { isStorageAvailable } from "../../lib/storage.js";
import { rootRoute } from "../__root.js";

export const setupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/setup",
  beforeLoad: () => {
    if (getToken()) throw redirect({ to: "/collections" });
  },
  component: SetupPage,
});

function SetupPage() {
  const { t } = useTranslation("setup");
  const navigate = useNavigate();
  const [token, setTokenInput] = useState("");
  // Asked once, before anything is typed. It cannot be said afterwards: a
  // successful connect navigates away from this screen immediately, so a notice
  // rendered post-submit would never be read. Saying it here also puts it in
  // front of the person who has just been asked for the token a second time.
  const [canRemember] = useState(isStorageAvailable);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!token.trim()) return;
    setToken(token);
    void navigate({ to: "/collections" });
  }

  return (
    <div className="setup-page">
      <h1>{t("title")}</h1>
      <p>{t("description")}</p>
      {/* Not role="alert": nothing has failed, and the danger treatment in
          global.css is scoped to that role. The token still works — it just
          will not outlive the tab. */}
      {!canRemember && (
        <p role="status" className="form-hint">
          {t("no_persistence_notice")}
        </p>
      )}
      <form onSubmit={handleSubmit}>
        {/* The row wrapper is not decoration: every input rule in the stylesheet
            is scoped to .form-row, so without it the first screen a new user
            sees renders a bare UA control (#224). */}
        <div className="form-row">
          <label htmlFor="api-token">{t("token_label")}</label>
          <input
            id="api-token"
            type="password"
            value={token}
            onChange={(e) => setTokenInput(e.target.value)}
            placeholder={t("token_placeholder")}
            autoComplete="off"
            required
          />
        </div>
        <button type="submit" className="touch-target">
          {t("connect_button")}
        </button>
      </form>
    </div>
  );
}
