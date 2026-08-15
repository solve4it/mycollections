import type { CollectionWithItemCount } from "@mycollections/core";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { catalogCode } from "../lib/cover.js";
import { GeneratedCover } from "./GeneratedCover.js";

interface CollectionCardProps {
  collection: CollectionWithItemCount;
}

export function CollectionCard({ collection }: CollectionCardProps) {
  const { t } = useTranslation("collections");

  return (
    <Link to="/collections/$id" params={{ id: collection.id }} className="collection-card">
      <GeneratedCover collectionId={collection.id} />
      <div className="collection-card-body">
        {/* Code and count are separate elements on purpose: folding them into one
            text node would break `getByText("3 items")`, the guard that keeps the
            card showing item counts rather than field counts (#191). The
            separator is drawn in CSS and the uppercase is a text-transform, so
            the DOM keeps the real, translated, correctly pluralized string. */}
        <p className="collection-card-eyebrow">
          <span className="collection-card-code">{catalogCode(collection.id)}</span>
          <span className="collection-card-count">{t("items_count", { count: collection.itemCount })}</span>
        </p>
        <h2 className="collection-card-name">{collection.name}</h2>
        {collection.description && <p className="collection-card-description">{collection.description}</p>}
      </div>
    </Link>
  );
}
