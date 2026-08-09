import { createRoute, redirect, useNavigate } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { getToken, setToken } from "../../lib/api-client.js";
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
      <form onSubmit={handleSubmit}>
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
        <button type="submit" className="touch-target">
          {t("connect_button")}
        </button>
      </form>
    </div>
  );
}
