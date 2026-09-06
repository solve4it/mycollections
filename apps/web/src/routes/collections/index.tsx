import { createRoute, Link, redirect } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { CollectionCard } from "../../components/CollectionCard.js";
import { EmptyState } from "../../components/EmptyState.js";
import { Icon } from "../../components/Icon.js";
import { CollectionGridSkeleton } from "../../components/Skeleton.js";
import { getToken } from "../../lib/api-client.js";
import { useCollections } from "../../lib/queries.js";
import { rootRoute } from "../__root.js";

export const collectionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/collections",
  staticData: { titleKey: "collections:title" },
  beforeLoad: () => {
    if (!getToken()) throw redirect({ to: "/setup" });
  },
  component: CollectionsPage,
});

function CollectionsPage() {
  const { t } = useTranslation("collections");
  const { data: collections, error } = useCollections();

  // A failure with nothing to fall back on is the only state that replaces the
  // page. A query can sit pending without fetching, which leaves `isLoading`
  // false and `data` undefined — never let that reach the empty state and tell
  // the user their collections are gone (#228); it gets the skeleton below.
  if (collections === undefined) {
    if (error)
      return (
        <div role="alert">
          <h1>{t("error_title")}</h1>
          <p>{t("error_description")}</p>
        </div>
      );
  }

  if (collections?.length === 0)
    return (
      <EmptyState titleAs="h1" title={t("empty_title")} description={t("empty_description")}>
        <Link to="/collections/new" className="touch-target button-primary">
          <Icon name="add" />
          {t("create_cta")}
        </Link>
      </EmptyState>
    );

  return (
    <div>
      {/* The header is not waiting on anything, so it does not wait: rendering
          it alongside the skeleton keeps the page's only <h1> — and the action
          that does not need data — on screen throughout the load, and stops the
          header popping in over the grid when the data lands. */}
      <div className="page-header">
        <h1>{t("title")}</h1>
        <Link to="/collections/new" className="touch-target button-primary">
          <Icon name="add" />
          {t("create_cta")}
        </Link>
      </div>
      {/* A failed reload leaves the last good data on screen: it is still the
          truth about the user's collections, so warn instead of wiping it. */}
      {error && <p role="alert">{t("reload_error")}</p>}
      {collections === undefined ? (
        <CollectionGridSkeleton label={t("loading")} />
      ) : (
        <div className="collection-grid">
          {collections.map((c) => (
            <CollectionCard key={c.id} collection={c} />
          ))}
        </div>
      )}
    </div>
  );
}
