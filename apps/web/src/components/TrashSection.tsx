import type { Collection, DeletedItem } from "@mycollections/core";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { EmptyTrashResult } from "../lib/api-client.js";
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
 * How long the "emptied the trash" confirmation stays on screen (#336).
 *
 * It needs a life span because nothing else can give it one: on success the
 * trash is empty, so the button that would have cleared the message on the next
 * interaction — the way the import and the undo toast clear theirs — is gone
 * from the page with it. Without a timer the sentence simply stayed, and the
 * section read "The trash is empty." with "Emptied the trash: removed …" still
 * underneath it for the life of the mount.
 *
 * On WCAG 2.2.1: the window limits the *restatement*, never the outcome. The
 * emptying has already happened, it cannot be undone, and the list above is the
 * durable record of it — nothing is lost by missing this sentence, and there is
 * no control inside it to reach in time. That is also why it has no hover/focus
 * hold like `UndoToast`: there is nothing here to hover towards. Ten seconds is
 * the same figure as `UNDO_WINDOW_MS`, by the same judgment rather than by any
 * dependency between them, so the two are separate constants.
 */
export const TRASH_CONFIRMATION_MS = 10_000;

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

  // What the last empty removed, held here rather than read from
  // `emptyTrash.isSuccess` — the same shape the undo toast holds its message in,
  // for the same reason (`routes/collections/$id.tsx`). The confirmation needs a
  // life span of its own, and a mutation's success state has none: it lasts
  // until something resets it, which is why this sentence used to stay on screen
  // for the life of the mount (#336).
  //
  // Deriving it from the mutation and clearing it with `reset()` on a timer
  // looks equivalent and is not. A second empty inside the window can resolve
  // before React re-renders, so `isSuccess` would go true → true with no pending
  // state in between and the first timer would survive — clearing the second
  // confirmation early, or firing mid-flight, where `reset()` detaches the
  // observer from the running mutation and its result never arrives at all.
  // Each success stores a new object here instead, so the effect restarts on
  // exactly the event that should restart it.
  const [emptied, setEmptied] = useState<EmptyTrashResult | null>(null);

  // Retires the confirmation once it has been up long enough to read (#336).
  // Only the message goes: the region below stays mounted and becomes empty
  // again in place, because a region torn down when it has nothing to say is a
  // region re-inserted *with its text already inside it* on the next empty —
  // the bug #326 fixed. Emptying it announces nothing either way, since
  // `aria-relevant` defaults to additions and text, not removals.
  useEffect(() => {
    if (!emptied) return;
    const timer = setTimeout(() => setEmptied(null), TRASH_CONFIRMATION_MS);
    return () => clearTimeout(timer);
  }, [emptied]);

  return (
    <section className="settings-trash">
      <h2>{t("trash_label")}</h2>
      <p>{t("trash_description")}</p>
      <TrashContents
        locale={locale}
        query={trash}
        onEmpty={() => {
          // Drop the previous confirmation as the next empty starts: it describes
          // an older event, and leaving it up would let it sit beside this one's
          // failure as though it had just succeeded.
          setEmptied(null);
          emptyTrash.mutate(undefined, { onSuccess: (result) => setEmptied(result) });
        }}
        pending={emptyTrash.isPending}
      />
      {/* Always rendered, never conditional (#326). The confirmation used to be a
          `role="status"` node created with its text already inside it, and a live
          region inserted with content is announced by VoiceOver but usually not by
          NVDA or JAWS — so the one sentence saying how much was destroyed was the
          one a large share of screen-reader users never heard.

          It lives here, in the section, rather than inside TrashContents: that
          component returns three different shapes, so a region parked in it would
          be torn down and rebuilt whenever the branch changed, and a rebuilt
          region is the bug again.

          No role on the region and none on the message inside it: `role="status"`
          implies `aria-live`, so a role on the message would make the message the
          nearest live region for its own insertion and lose the announcement. No
          `aria-atomic` — the region holds one message at a time either way. And
          the failure below stays outside, keeping `role="alert"` as a live region
          of its own rather than inheriting a polite owner. */}
      <div className="trash-live" aria-live="polite">
        {emptied && (
          <p>
            {t("trash_emptied", {
              collections: t("trash_count_collections", { count: emptied.collections }),
              items: t("trash_count_items", { count: emptied.items }),
            })}
          </p>
        )}
      </div>
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
    // Not a live region (#326). `useTrash` keeps its data while it fetches again, so
    // this branch cannot be reached again once the trash has loaded: the message
    // is in the section's first commit or in none of them, and a live region
    // that arrives with the page announces nothing. The role only made
    // page-level status queries ambiguous.
    return <p>{t("trash_loading")}</p>;
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
