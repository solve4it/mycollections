import type { Collection } from "@mycollections/core";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

interface CollectionCardProps {
  collection: Collection;
}

export function CollectionCard({ collection }: CollectionCardProps) {
  const { t } = useTranslation("collections");

  return (
    <Link to="/collections/$id" params={{ id: collection.id }} className="collection-card">
      <h2 className="collection-card-name">{collection.name}</h2>
      {collection.description && <p className="collection-card-description">{collection.description}</p>}
      <span className="collection-card-meta">{t("items_count", { count: collection.fields.length })}</span>
    </Link>
  );
}
