import type { Collection } from "@mycollections/core";
import { useTranslation } from "react-i18next";

interface CollectionCardProps {
  collection: Collection;
}

export function CollectionCard({ collection }: CollectionCardProps) {
  const { t } = useTranslation("collections");

  return (
    <article className="collection-card">
      <h2 className="collection-card-name">{collection.name}</h2>
      {collection.description && <p className="collection-card-description">{collection.description}</p>}
      <span className="collection-card-meta">{t("items_count", { count: collection.fields.length })}</span>
    </article>
  );
}
