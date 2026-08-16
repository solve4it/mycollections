import type { Collection, DeletedItem } from "@mycollections/core";
import { useTranslation } from "react-i18next";
import { formatDate } from "../lib/intl.js";
import {
  useEmptyTrash,
  usePurgeCollection,
  usePurgeItem,
  useRestoreCollection,
  useRestoreTrashedItem,
  useTrash,
} from "../lib/queries.js";
import { ConfirmButton } from "./ConfirmButton.js";
import { Icon } from "./Icon.js";

/**
 * Trash management in Settings (#35): what soft delete has hidden, with the two
 * ways out of it — put it back, or destroy it for good.
 *
 * Two lists, not one: a trashed collection takes its items down with it without
 * marking them, so the server lists those items nowhere (#281). Restoring the
 * collection brings them back, and the heading note says so — otherwise their
 * absence reads as data lost rather than data that moves with its parent.
 *
 * There is no retention period to show: auto-purge was dropped from #33, so
 * nothing here expires and every deletion is the user's own.
 */
export function TrashSection() {
  const { t, i18n } = useTranslation("settings");
  const trash = useTrash();
  const emptyTrash = useEmptyTrash();
  const locale = i18n.resolvedLanguage ?? i18n.language;

  return (
    <section className="settings-trash">
      <h2>{t("trash_label")}</h2>
      <p>{t("trash_description")}</p>
      <TrashContents locale={locale} query={trash} onEmpty={() => emptyTrash.mutate()} pending={emptyTrash.isPending} />
      {emptyTrash.isSuccess && (
        <p role="status">
          {t("trash_emptied", {
            collections: t("trash_count_collections", { count: emptyTrash.data.collections }),
            items: t("trash_count_items", { count: emptyTrash.data.items }),
          })}
        </p>
      )}
      {emptyTrash.isError && <p role="alert">{t("trash_empty_error")}</p>}
    </section>
  );
}

interface TrashContentsProps {
  query: ReturnType<typeof useTrash>;
  locale: string;
  onEmpty: () => void;
  pending: boolean;
}

/**
 * Keeps "we could not load the trash" and "the trash is empty" apart — collapsing
 * the two is what made a failed load read as an empty collection in #228, and here
 * it would tell a user their deleted data is gone.
 */
function TrashContents({ query, locale, onEmpty, pending }: TrashContentsProps) {
  const { t } = useTranslation("settings");
  const trash = query.data;

  if (trash === undefined) {
    if (query.error) return <p role="alert">{t("trash_error")}</p>;
    return <p role="status">{t("trash_loading")}</p>;
  }

  if (trash.collections.length === 0 && trash.items.length === 0) return <p>{t("trash_empty")}</p>;

  return (
    <>
      {query.error && <p role="alert">{t("trash_error")}</p>}
      {trash.collections.length > 0 && (
        <>
          <h3>{t("trash_collections_heading")}</h3>
          <p className="trash-note">{t("trash_collections_note")}</p>
          <ul className="trash-list">
            {trash.collections.map((collection) => (
              <CollectionRow key={collection.id} collection={collection} locale={locale} />
            ))}
          </ul>
        </>
      )}
      {trash.items.length > 0 && (
        <>
          <h3>{t("trash_items_heading")}</h3>
          <ul className="trash-list">
            {trash.items.map((item) => (
              <ItemRow key={item.id} item={item} locale={locale} />
            ))}
          </ul>
        </>
      )}
      <ConfirmButton
        label={t("trash_empty_button")}
        icon="delete"
        prompt={t("trash_empty_prompt", {
          collections: t("trash_count_collections", { count: trash.collections.length }),
          items: t("trash_count_items", { count: trash.items.length }),
        })}
        confirmLabel={t("trash_empty_button")}
        cancelLabel={t("trash_cancel")}
        pending={pending}
        onConfirm={onEmpty}
      />
    </>
  );
}

/** When the row went into the trash, in the user's locale. */
function DeletedOn({ at, locale }: { at: string | null; locale: string }) {
  const { t } = useTranslation("settings");
  if (!at) return null;
  return (
    <span className="trash-meta">
      {t("trash_deleted_on", { date: formatDate(at, locale, { dateStyle: "medium" }) })}
    </span>
  );
}

function CollectionRow({ collection, locale }: { collection: Collection; locale: string }) {
  const { t } = useTranslation("settings");
  const restore = useRestoreCollection();
  const purge = usePurgeCollection();

  return (
    <li>
      <div className="trash-row">
        <div className="trash-entry">
          <span className="trash-name">{collection.name}</span>
          <DeletedOn at={collection.deletedAt} locale={locale} />
        </div>
        <div className="trash-actions">
          <button
            type="button"
            className="touch-target button-quiet"
            disabled={restore.isPending}
            onClick={() => restore.mutate(collection.id)}
          >
            <Icon name="restore" />
            {t("trash_restore")}
          </button>
          <ConfirmButton
            label={t("trash_delete_forever")}
            icon="delete"
            prompt={t("trash_delete_collection_prompt", { name: collection.name })}
            confirmLabel={t("trash_delete_forever")}
            cancelLabel={t("trash_cancel")}
            pending={purge.isPending}
            onConfirm={() => purge.mutate(collection.id)}
          />
        </div>
      </div>
      {restore.isError && <p role="alert">{t("trash_restore_error")}</p>}
      {purge.isError && <p role="alert">{t("trash_delete_error")}</p>}
    </li>
  );
}

/**
 * What to call a trashed item. The trash carries no field definitions — the
 * collection's schema is a separate fetch, and for an item whose collection is
 * itself hidden it would be unreachable — so the first filled value stands in
 * for the title: collections put the title-ish field first, which is the same
 * assumption the undo toast makes.
 */
function itemName(item: DeletedItem, untitled: string): string {
  for (const value of Object.values(item.fields)) {
    if (value != null && value !== "" && !Array.isArray(value)) return String(value);
  }
  return untitled;
}

function ItemRow({ item, locale }: { item: DeletedItem; locale: string }) {
  const { t } = useTranslation("settings");
  const restore = useRestoreTrashedItem();
  const purge = usePurgeItem();
  const name = itemName(item, t("trash_untitled"));

  return (
    <li>
      <div className="trash-row">
        <div className="trash-entry">
          <span className="trash-name">{name}</span>
          <span className="trash-meta">{t("trash_item_collection", { collection: item.collectionName })}</span>
          <DeletedOn at={item.deletedAt} locale={locale} />
        </div>
        <div className="trash-actions">
          <button
            type="button"
            className="touch-target button-quiet"
            disabled={restore.isPending}
            onClick={() => restore.mutate({ collectionId: item.collectionId, itemId: item.id })}
          >
            <Icon name="restore" />
            {t("trash_restore")}
          </button>
          <ConfirmButton
            label={t("trash_delete_forever")}
            icon="delete"
            prompt={t("trash_delete_item_prompt", { name })}
            confirmLabel={t("trash_delete_forever")}
            cancelLabel={t("trash_cancel")}
            pending={purge.isPending}
            onConfirm={() => purge.mutate(item.id)}
          />
        </div>
      </div>
      {restore.isError && <p role="alert">{t("trash_restore_error")}</p>}
      {purge.isError && <p role="alert">{t("trash_delete_error")}</p>}
    </li>
  );
}
