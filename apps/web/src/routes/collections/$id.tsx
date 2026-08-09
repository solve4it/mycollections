import type { Collection, Item } from "@mycollections/core";
import type { UseQueryResult } from "@tanstack/react-query";
import { createRoute, Link, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { DynamicItemForm } from "../../components/DynamicItemForm.js";
import { Icon } from "../../components/Icon.js";
import { getToken } from "../../lib/api-client.js";
import { useCollection, useCreateItem, useDeleteItem, useItems, useUpdateItem } from "../../lib/queries.js";
import { rootRoute } from "../__root.js";

export const collectionDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/collections/$id",
  beforeLoad: () => {
    if (!getToken()) throw redirect({ to: "/setup" });
  },
  component: CollectionDetailPage,
});

/**
 * Renders a stored field value. Booleans become a labelled icon rather than the
 * check/cross glyphs used before: the icon is the whole value, so it carries its
 * own accessible name instead of leaving screen readers to announce a unicode
 * character under whatever name they have for it (#221).
 */
function FieldValue({ value }: { value: unknown }) {
  const { t } = useTranslation("items");
  if (value == null || value === "") return <>—</>;
  if (typeof value === "boolean")
    return value ? <Icon name="check" label={t("value_yes")} /> : <Icon name="cross" label={t("value_no")} />;
  if (Array.isArray(value)) return <>{value.join(", ")}</>;
  return <>{String(value)}</>;
}

function CollectionDetailPage() {
  const { id } = collectionDetailRoute.useParams();
  const { t } = useTranslation("items");
  const collectionQuery = useCollection(id);
  const itemsQuery = useItems(id);
  const createItem = useCreateItem(id);

  const collection = collectionQuery.data;

  // A query can sit pending without fetching, so "no data yet" is not an error
  // and must not be presented as one. Once the collection has loaded it stays
  // on screen even if a later reload fails.
  if (collection === undefined) {
    if (collectionQuery.error)
      return (
        <div role="alert">
          <h1>{t("error_title")}</h1>
          <p>{t("error_description")}</p>
        </div>
      );
    return <p role="status">{t("loading")}</p>;
  }

  return (
    <div className="collection-detail">
      <Link to="/collections" className="back-link">
        <Icon name="back" />
        {t("back_to_collections")}
      </Link>
      <h1>{collection.name}</h1>
      {collection.description && <p>{collection.description}</p>}

      <h2>{t("items_heading")}</h2>
      <ItemList collection={collection} query={itemsQuery} />

      <section className="add-item">
        <h2>{t("add_item")}</h2>
        <DynamicItemForm
          fields={collection.fields}
          pending={createItem.isPending}
          onSubmit={(payload) => createItem.mutate(payload)}
        />
        {createItem.isError && <p role="alert">{t("create_error")}</p>}
      </section>
    </div>
  );
}

interface ItemListProps {
  collection: Collection;
  query: UseQueryResult<Item[]>;
}

/**
 * Renders the item list, keeping "we could not load these" and "we loaded them
 * and there are none" as distinct outcomes — collapsing the two is what made a
 * failed load read as an empty collection (#228).
 */
function ItemList({ collection, query }: ItemListProps) {
  const { t } = useTranslation("items");
  const items = query.data;

  if (items === undefined) {
    if (query.error)
      return (
        <div role="alert">
          <p>{t("items_error_title")}</p>
          <p>{t("items_error_description")}</p>
        </div>
      );
    return <p role="status">{t("loading_items")}</p>;
  }

  if (items.length === 0)
    return (
      <div className="empty-state">
        <p>{t("empty_items")}</p>
        <p>{t("empty_items_description")}</p>
      </div>
    );

  return (
    <>
      {query.error && <p role="alert">{t("items_reload_error")}</p>}
      <ul className="item-list">
        {items.map((item) => (
          <ItemRow key={item.id} collection={collection} item={item} />
        ))}
      </ul>
    </>
  );
}

interface ItemRowProps {
  collection: Collection;
  item: Item;
}

function ItemRow({ collection, item }: ItemRowProps) {
  const { t } = useTranslation("items");
  const updateItem = useUpdateItem(collection.id);
  const deleteItem = useDeleteItem(collection.id);
  const [editing, setEditing] = useState(false);

  // The failure message belongs to this row, so it lives inside this <li> —
  // a page-level banner could not say *which* item failed. `.item-row` moves
  // onto an inner wrapper because it is a flex row: an alert added beside the
  // fields and actions would be squeezed into a third column, whereas the
  // unstyled <li> stacks the card and the message. No CSS change needed.
  if (editing) {
    return (
      <li>
        <div className="item-row">
          <DynamicItemForm
            fields={collection.fields}
            initialStatus={item.status}
            initialValues={item.fields}
            submitLabel={t("save")}
            pending={updateItem.isPending}
            // Cancelling discards the whole editing session, the failed save
            // included: without the reset, reopening the editor would show an
            // error for an attempt the user has not made yet.
            onCancel={() => {
              updateItem.reset();
              setEditing(false);
            }}
            onSubmit={(payload) =>
              updateItem.mutate({ itemId: item.id, input: payload }, { onSuccess: () => setEditing(false) })
            }
          />
        </div>
        {updateItem.isError && <p role="alert">{t("update_error")}</p>}
      </li>
    );
  }

  return (
    <li>
      <div className="item-row">
        <div className="item-fields">
          <span className={`item-status item-status-${item.status}`}>{t(`status_${item.status}`)}</span>
          {collection.fields.map((field) => (
            <span key={field.id} className="item-field">
              <span className="item-field-label">{field.label}:</span> <FieldValue value={item.fields[field.id]} />
            </span>
          ))}
        </div>
        <div className="item-actions">
          <button type="button" className="touch-target" onClick={() => setEditing(true)}>
            <Icon name="edit" />
            {t("edit")}
          </button>
          <button type="button" className="touch-target" onClick={() => deleteItem.mutate(item.id)}>
            <Icon name="delete" />
            {t("delete")}
          </button>
        </div>
      </div>
      {deleteItem.isError && <p role="alert">{t("delete_error")}</p>}
    </li>
  );
}
