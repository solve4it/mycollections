import type { Collection } from "@mycollections/core";
import { createRoute, Link } from "@tanstack/react-router";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { FailureSurface } from "../../components/ErrorScreen.js";
import { FieldValue } from "../../components/FieldValue.js";
import { Icon } from "../../components/Icon.js";
import { ImageGallery } from "../../components/ImageGallery.js";
import { ImageUploader } from "../../components/ImageUploader.js";
import { CollectionDetailSkeleton } from "../../components/Skeleton.js";
import type { ItemWithMedia } from "../../lib/api-client.js";
import { itemLabel } from "../../lib/item-label.js";
import { CONTENT_LINK_ACTIVE_OPTIONS } from "../../lib/links.js";
import { type PageName, usePageTitle } from "../../lib/page-title.js";
import { useCollection, useItem } from "../../lib/queries.js";
import { authenticatedRoute } from "../_authenticated.js";

export const itemDetailRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: "/collections/$id/items/$itemId",
  // "Item" until the item arrives and the page can say which (#309).
  staticData: { titleKey: "items:item_title", dynamicTitle: true },
  component: ItemDetailPage,
});

function itemPageName(
  collection: Collection | undefined,
  item: ItemWithMedia | undefined,
  untitled: string,
  failed: boolean,
): PageName {
  if (collection && item) return { status: "named", name: itemLabel(collection, item, untitled) };
  return failed ? { status: "unnamed" } : { status: "pending" };
}

/**
 * One item's own page (#37): its values, and its photos — which need a page,
 * since a row edited inline has no id until it is saved, and a Cancel there
 * could not take back an upload. Editing the values stays on the collection.
 */
function ItemDetailPage() {
  const { id, itemId } = itemDetailRoute.useParams();
  const { t } = useTranslation("items");
  const photosHeadingId = useId();
  const collectionQuery = useCollection(id);
  const itemQuery = useItem(id, itemId);
  const collection = collectionQuery.data;
  const item = itemQuery.data;
  const failed = collectionQuery.error != null || itemQuery.error != null;
  usePageTitle(itemPageName(collection, item, t("untitled"), failed));

  const backLink = (
    <Link to="/collections/$id" params={{ id }} className="back-link" activeOptions={CONTENT_LINK_ACTIVE_OPTIONS}>
      <Icon name="back" />
      {collection ? t("back_to_named_collection", { name: collection.name }) : t("collections:back_to_collection")}
    </Link>
  );

  if (!collection || !item) {
    return (
      <div className="item-page">
        {backLink}
        {failed ? (
          <FailureSurface title={t("item_error_title")} description={t("item_error_description")} />
        ) : (
          <CollectionDetailSkeleton label={t("item_loading")} count={1} />
        )}
      </div>
    );
  }

  const name = itemLabel(collection, item, t("untitled"));
  return (
    <div className="item-page">
      {backLink}
      <h1>{name}</h1>
      <dl className="item-details">
        <div>
          <dt>{t("status_label")}</dt>
          <dd>
            <span className={`item-status item-status-${item.status}`}>
              <span className="status-dot" aria-hidden="true" />
              {t(`status_${item.status}`)}
            </span>
          </dd>
        </div>
        {collection.fields.map((field) => (
          <div key={field.id}>
            <dt>{field.label}</dt>
            <dd>
              <FieldValue value={item.fields[field.id]} />
            </dd>
          </div>
        ))}
      </dl>
      <section className="item-photos" aria-labelledby={photosHeadingId}>
        <h2 id={photosHeadingId}>{t("photos_heading")}</h2>
        <ImageGallery collectionId={id} itemId={itemId} itemName={name} />
        <ImageUploader collectionId={id} itemId={itemId} />
      </section>
    </div>
  );
}
