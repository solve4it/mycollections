import type { Collection, Item } from "@mycollections/core";
import { createRoute, Link, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { DynamicItemForm } from "../../components/DynamicItemForm.js";
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

function formatValue(value: unknown): string {
  if (value == null || value === "") return "—";
  if (typeof value === "boolean") return value ? "✓" : "✗";
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

function CollectionDetailPage() {
  const { id } = collectionDetailRoute.useParams();
  const { t } = useTranslation("items");
  const collectionQuery = useCollection(id);
  const itemsQuery = useItems(id);
  const createItem = useCreateItem(id);

  if (collectionQuery.isLoading) return <p>{t("loading")}</p>;
  if (collectionQuery.error || !collectionQuery.data)
    return (
      <div role="alert">
        <h1>{t("error_title")}</h1>
      </div>
    );

  const collection = collectionQuery.data;
  const items = itemsQuery.data ?? [];

  return (
    <div className="collection-detail">
      <Link to="/collections" className="back-link">
        ← {t("back_to_collections")}
      </Link>
      <h1>{collection.name}</h1>
      {collection.description && <p>{collection.description}</p>}

      <h2>{t("items_heading")}</h2>
      {items.length === 0 ? (
        <div className="empty-state">
          <p>{t("empty_items")}</p>
          <p>{t("empty_items_description")}</p>
        </div>
      ) : (
        <ul className="item-list">
          {items.map((item) => (
            <ItemRow key={item.id} collection={collection} item={item} />
          ))}
        </ul>
      )}

      <section className="add-item">
        <h2>{t("add_item")}</h2>
        <DynamicItemForm
          fields={collection.fields}
          pending={createItem.isPending}
          onSubmit={(payload) => createItem.mutate(payload)}
        />
      </section>
    </div>
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

  if (editing) {
    return (
      <li className="item-row">
        <DynamicItemForm
          fields={collection.fields}
          initialStatus={item.status}
          initialValues={item.fields}
          submitLabel={t("save")}
          pending={updateItem.isPending}
          onCancel={() => setEditing(false)}
          onSubmit={(payload) =>
            updateItem.mutate({ itemId: item.id, input: payload }, { onSuccess: () => setEditing(false) })
          }
        />
      </li>
    );
  }

  return (
    <li className="item-row">
      <div className="item-fields">
        <span className={`item-status item-status-${item.status}`}>{t(`status_${item.status}`)}</span>
        {collection.fields.map((field) => (
          <span key={field.id} className="item-field">
            <span className="item-field-label">{field.label}:</span> {formatValue(item.fields[field.id])}
          </span>
        ))}
      </div>
      <div className="item-actions">
        <button type="button" className="touch-target" onClick={() => setEditing(true)}>
          {t("edit")}
        </button>
        <button type="button" className="touch-target" onClick={() => deleteItem.mutate(item.id)}>
          {t("delete")}
        </button>
      </div>
    </li>
  );
}
