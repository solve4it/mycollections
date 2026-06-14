import { createRoute, Link, redirect } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { CollectionCard } from "../../components/CollectionCard.js";
import { getToken } from "../../lib/api-client.js";
import { useCollections } from "../../lib/queries.js";
import { rootRoute } from "../__root.js";

export const collectionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/collections",
  beforeLoad: () => {
    if (!getToken()) throw redirect({ to: "/setup" });
  },
  component: CollectionsPage,
});

function CollectionsPage() {
  const { t } = useTranslation("collections");
  const { data: collections, isLoading, error } = useCollections();

  if (isLoading) return <p>{t("loading")}</p>;

  if (error)
    return (
      <div role="alert">
        <h1>{t("error_title")}</h1>
        <p>{error.message}</p>
      </div>
    );

  if (!collections?.length)
    return (
      <div className="empty-state">
        <h1>{t("empty_title")}</h1>
        <p>{t("empty_description")}</p>
        <Link to="/collections/new" className="touch-target">
          {t("create_cta")}
        </Link>
      </div>
    );

  return (
    <div>
      <div className="page-header">
        <h1>{t("title")}</h1>
        <Link to="/collections/new" className="touch-target">
          {t("create_cta")}
        </Link>
      </div>
      <div className="collection-grid">
        {collections.map((c) => (
          <CollectionCard key={c.id} collection={c} />
        ))}
      </div>
    </div>
  );
}
