import type { CollectionWithItemCount } from "@mycollections/core";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { catalogCode } from "../lib/cover.js";
import { CollectionProgress } from "./CollectionProgress.js";
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
        {/* The name leads the DOM because the DOM is the link's accessible name
            (#370): a user tabbing the grid hears which collection first, rather
            than a code and a count before every name. The eyebrow still paints
            above it — `order: -1` in global.css — which is safe here because the
            card holds nothing focusable of its own, so only the reading order
            moves, never the tab order. */}
        <h2 className="collection-card-name">{collection.name}</h2>
        {/* Code and count are separate elements on purpose: folding them into one
            text node would break `getByText("3 items")`, the guard that keeps the
            card showing item counts rather than field counts (#191).

            The code is `aria-hidden`: it is cover furniture derived from the id,
            not a name anyone looks a collection up by, and it led every card's
            name. The cost, accepted knowingly, is that a speech-input user cannot
            say "click C-3U" — they say the collection's name, which is the label
            the link is actually found by.

            The `·` between them is drawn in CSS with empty alt text
            (`content: "·" / ""`): generated content is part of an accessible
            name unless its alt says otherwise. */}
        <p className="collection-card-eyebrow">
          <span className="collection-card-code" aria-hidden="true">
            {catalogCode(collection.id)}
          </span>
          <span className="collection-card-count">{t("items_count", { count: collection.itemCount })}</span>
        </p>
        {collection.description && <p className="collection-card-description">{collection.description}</p>}
        {/* Last, so it reads after the name and the count (#42) — and pushed to
            the card's foot in CSS so bars line up across a row. Renders nothing
            for a set with no target: the hint asking for one belongs on the
            collection's own page, not repeated on every dashboard visit. */}
        <CollectionProgress collection={collection} ownedCount={collection.ownedCount} />
      </div>
    </Link>
  );
}
