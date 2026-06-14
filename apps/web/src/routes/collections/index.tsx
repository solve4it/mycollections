import { createRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { rootRoute } from "../__root.js";

export const collectionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/collections",
  component: CollectionsPage,
});

function CollectionsPage() {
  const { t } = useTranslation("collections");
  return (
    <div>
      <h1>{t("title")}</h1>
      <p>{t("empty_message")}</p>
    </div>
  );
}
