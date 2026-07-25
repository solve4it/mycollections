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
  const { data: collections, error } = useCollections();

  // Having no data is the only state that justifies replacing the page. A query
  // can sit pending without fetching, which leaves `isLoading` false and `data`
  // undefined — never let that reach the empty state and tell the user their
  // collections are gone (#228).
  if (collections === undefined) {
    if (error)
      return (
        <div role="alert">
          <h1>{t("error_title")}</h1>
          <p>{t("error_description")}</p>
        </div>
      );
    return <p role="status">{t("loading")}</p>;
  }

  if (collections.length === 0)
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
      {/* A failed reload leaves the last good data on screen: it is still the
          truth about the user's collections, so warn instead of wiping it. */}
      {error && <p role="alert">{t("reload_error")}</p>}
      <div className="collection-grid">
        {collections.map((c) => (
          <CollectionCard key={c.id} collection={c} />
        ))}
      </div>
    </div>
  );
}
