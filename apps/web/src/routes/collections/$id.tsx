import { type Collection, formatItemFilters, type Item, type ItemFilter } from "@mycollections/core";
import { type UseQueryResult, useQueryClient } from "@tanstack/react-query";
import { createRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { DynamicItemForm } from "../../components/DynamicItemForm.js";
import { EmptyState } from "../../components/EmptyState.js";
import { FailureSurface } from "../../components/ErrorScreen.js";
import { AppliedFilters, FilterPanel } from "../../components/FilterPanel.js";
import { Icon } from "../../components/Icon.js";
import { ItemSearchBox } from "../../components/ItemSearchBox.js";
import { ItemSortSelect } from "../../components/ItemSortSelect.js";
import { CollectionDetailSkeleton, ItemListSkeleton } from "../../components/Skeleton.js";
import { UndoToast } from "../../components/UndoToast.js";
import { useAnnounce } from "../../lib/announcer.js";
import { getToken } from "../../lib/api-client.js";
import { type FocusDestination, useFocusHandoff } from "../../lib/focus-handoff.js";
import { effectiveFilters, effectiveSort, type ItemSearch, validateItemSearch } from "../../lib/item-search.js";
import { CONTENT_LINK_ACTIVE_OPTIONS } from "../../lib/links.js";
import { type PageName, usePageTitle } from "../../lib/page-title.js";
import {
  itemsQueryKey,
  useCollection,
  useCreateItem,
  useDeleteItem,
  useItems,
  useRestoreItem,
  useUpdateItem,
} from "../../lib/queries.js";
import { rootRoute } from "../__root.js";

export const collectionDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/collections/$id",
  // "Collection" is only what this page is called until the collection itself
  // arrives; `dynamicTitle` is what tells the shell a better name is coming and
  // that the route-change announcement should wait for it (#309).
  staticData: { titleKey: "collections:detail_title", dynamicTitle: true },
  // The search box's state (#41). Shape only — whether a sort suits this
  // collection is decided once its fields are known (`effectiveSort`).
  validateSearch: validateItemSearch,
  beforeLoad: () => {
    if (!getToken()) throw redirect({ to: "/setup" });
  },
  component: CollectionDetailPage,
});

/**
 * How long "Added …" stays under the add-item form (#368).
 *
 * It needs a life span for the same reason the emptied-trash sentence does
 * (`TrashSection.tsx`): nothing else will clear it. The form is ready for the
 * next item the moment it saves, so there is no later interaction to retire the
 * message on, and left alone it would sit there claiming an add that happened
 * minutes ago.
 *
 * On WCAG 2.2.1: the window limits the *restatement*, never the outcome. The
 * item is in the list above, which is the durable record of it, and there is no
 * control inside the message to reach in time — so this is the same judgment as
 * `TRASH_CONFIRMATION_MS`, by the same reasoning rather than by any dependency
 * between them.
 */
export const ADD_CONFIRMATION_MS = 10_000;

/**
 * How long a search result has to stay put before its count is spoken (#41).
 * The count is visible as soon as it arrives; the announcement waits so it
 * does not talk over a user who is still typing — GOV.UK's accessible
 * autocomplete waits about as long before its status message.
 */
export const RESULT_ANNOUNCE_DELAY_MS = 1_000;

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

/**
 * What to call an item in a message about it. The first field carrying a value
 * is the item's name in practice — collections put the title-ish field first —
 * and an item with nothing filled in still has to be nameable.
 */
function itemLabel(collection: Collection, item: Item, untitled: string): string {
  for (const field of collection.fields) {
    const value = item.fields[field.id];
    if (value != null && value !== "" && !Array.isArray(value)) return String(value);
  }
  return untitled;
}

/**
 * What this page calls itself (#309). A collection that failed to load is as
 * named as it is ever going to be — reporting that is what keeps the shell from
 * holding the route-change announcement for a name that is not coming.
 */
function collectionPageName(collection: Collection | undefined, failed: boolean): PageName {
  if (collection) return { status: "named", name: collection.name };
  return failed ? { status: "unnamed" } : { status: "pending" };
}

function CollectionDetailPage() {
  const { id } = collectionDetailRoute.useParams();
  const { t } = useTranslation("items");
  // The editor is a collection-level action, so its label lives with the other
  // collection strings rather than being duplicated into the items namespace —
  // as does "could not load this collection", which the editor needs too and
  // took the dashboard's plural copy for want of (#347).
  const { t: tCollections } = useTranslation("collections");
  const collectionQuery = useCollection(id);
  const search = collectionDetailRoute.useSearch();
  const navigate = useNavigate({ from: collectionDetailRoute.fullPath });
  const announce = useAnnounce();
  const queryClient = useQueryClient();
  const q = search.q?.trim() ?? "";
  const sort = collectionQuery.data ? effectiveSort(search.sort, collectionQuery.data.fields) : undefined;
  const filters: ItemFilter[] = collectionQuery.data
    ? effectiveFilters(search.filter, collectionQuery.data.fields)
    : [];
  const filter = filters.length > 0 ? formatItemFilters(filters) : undefined;
  const itemQuery = { q: q || undefined, sort, filter };
  // A sort or filter in the URL waits for the collection: only its fields say
  // whether they can be honoured, and asking without knowing risks a 400.
  const itemsQuery = useItems(id, itemQuery, {
    enabled: !(search.sort || search.filter) || collectionQuery.data !== undefined,
  });
  const searchInputRef = useRef<HTMLInputElement>(null);

  // The search on screen *now*. A mutation's callbacks close over the render in
  // which it started, and the user may have searched again since: only the
  // search on screen was fetched again, so only it can say what is shown.
  const currentItemQuery = useRef(itemQuery);
  currentItemQuery.current = itemQuery;

  /** Whether the list as last fetched for the search on screen holds this item. */
  function isListed(itemId: string): boolean {
    const listed = queryClient.getQueryData<Item[]>(itemsQueryKey(id, currentItemQuery.current));
    return listed?.some((listedItem) => listedItem.id === itemId) ?? false;
  }
  const createItem = useCreateItem(id);
  const restoreItem = useRestoreItem(id);
  // The undo shortcut outlives the row that spawned it: once the delete lands and
  // the list reloads, that <li> is gone, so the toast is owned by the page.
  // `index` is where in the list the row was, which is where focus goes if the
  // toast is dismissed — the same destination the delete itself chose, so a
  // delete-then-dismiss leaves the user where a delete alone would have (#367).
  const [undo, setUndo] = useState<{ itemId: string; name: string; index: number } | null>(null);
  // What the last add created, held here rather than read from
  // `createItem.isSuccess` — a mutation's success state lasts until something
  // resets it, and this sentence needs a life span of its own (#336 made the
  // same move for the trash). Each success stores a new object, so the effect
  // below restarts on exactly the event that should restart it.
  const [added, setAdded] = useState<{ name: string; hidden: boolean } | null>(null);
  // Bumped on each successful add to clear the form (#368). A count rather than
  // a boolean: two adds in a row have to clear it twice.
  const [addedCount, setAddedCount] = useState(0);

  useEffect(() => {
    if (!added) return;
    const timer = setTimeout(() => setAdded(null), ADD_CONFIRMATION_MS);
    return () => clearTimeout(timer);
  }, [added]);

  const collection = collectionQuery.data;

  // A row's Delete removes the row, and the toast's Undo and Dismiss remove the
  // toast, so all three orphaned focus to <body> (#367). The handoff is held
  // here, at the page, because the page is what survives all three.
  const handOffFocus = useFocusHandoff();
  const itemsHeadingRef = useRef<HTMLHeadingElement>(null);

  function setSearch(next: string) {
    // `replace` so keystrokes do not fill the history; `resetScroll: false` or
    // the router scrolls to the top on every search (#41).
    void navigate({
      search: (prev: ItemSearch) => ({ ...prev, q: next || undefined }),
      replace: true,
      resetScroll: false,
    });
  }

  function setSort(next: string | undefined) {
    // A sort needs no announcement of its own: the select speaks the option
    // chosen, and the list below is what changed.
    void navigate({ search: (prev: ItemSearch) => ({ ...prev, sort: next }), replace: true, resetScroll: false });
  }

  function setFilters(next: ItemFilter[]) {
    // Pushed, not replaced: applying filters is a deliberate step, and Back
    // should undo it (#41).
    void navigate({
      search: (prev: ItemSearch) => ({ ...prev, filter: next.length > 0 ? formatItemFilters(next) : undefined }),
      resetScroll: false,
    });
  }

  /** The Filters toggle — where focus goes when the control holding it goes with the last filter. */
  const filtersToggle: FocusDestination = () =>
    document.querySelector<HTMLElement>(".filter-panel > button[aria-expanded]");

  /**
   * The result count, spoken once a search settles (#41). Keyed on the search
   * itself, not on fetches: a refetch after an edit, delete or undo re-runs the
   * same search, and repeating the count on top of the toast would be noise.
   * The search the page opened on is not announced — the route announcement
   * names the page and the count is on screen — but clearing a search is.
   */
  // Not gated on `isFetching`: a refetch of the same search (after an edit,
  // delete or undo) keeps its data, and toggling here would restart the
  // countdown and speak the count right on top of that action's own message.
  const settled = itemsQuery.data !== undefined && !itemsQuery.isPlaceholderData;
  // What the list is narrowed by, as one key: the search text and the filters.
  const narrowing = JSON.stringify([q, filter ?? ""]);
  const settledQ = settled ? narrowing : null;
  const settledCount = settled ? (itemsQuery.data?.length ?? 0) : null;
  const announcedSearch = useRef(narrowing);
  useEffect(() => {
    if (settledQ === null || settledCount === null || settledQ === announcedSearch.current) return;
    const timer = setTimeout(() => {
      announcedSearch.current = settledQ;
      const [settledText, settledFilter] = JSON.parse(settledQ) as [string, string];
      if (!settledText && !settledFilter) announce(t("showing_all", { count: settledCount }));
      else if (settledCount === 0)
        announce(settledText ? t("no_matches", { q: settledText }) : t("no_matches_filtered"));
      else if (settledText) announce(t("items_match", { count: settledCount, q: settledText }));
      else announce(t("items_match_filtered", { count: settledCount }));
    }, RESULT_ANNOUNCE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [settledQ, settledCount, announce, t]);

  /**
   * Where focus goes when the row at `index` is removed.
   *
   * The APG successor-element rule: the row that takes its place, else the one
   * before it when the removed row was last. Not the undo shortcut, which the
   * issue first proposed — the toast announces itself through this screen's
   * live region, so a screen-reader user has already heard it, and parking
   * focus inside a polite region as it is populated is the variability #308 was
   * fought over. It would also tax every delete to save two keystrokes on the
   * rare one that is regretted.
   *
   * With no row left, the heading of the list they were in. Not the add-item
   * form: dropping a user into "add an item" because they deleted their last
   * one is a worse surprise than landing on a heading.
   */
  function rowDestination(index: number): FocusDestination {
    return () => {
      const edits = Array.from(document.querySelectorAll<HTMLElement>("[data-row-edit]"));
      return edits[index] ?? edits[edits.length - 1] ?? itemsHeadingRef.current;
    };
  }

  // The name in the <h1> is also the name of the page, so the tab, the history
  // entry and the route-change announcement carry it too (#309). Above the
  // early returns, because a hook cannot be called conditionally — and the
  // loading and error branches are two of the three answers it reports.
  usePageTitle(collectionPageName(collection, collectionQuery.error != null));

  // A query can sit pending without fetching, so "no data yet" is not an error
  // and must not be presented as one. Once the collection has loaded it stays
  // on screen even if a later reload fails.
  if (collection === undefined) {
    if (collectionQuery.error)
      return (
        <FailureSurface
          title={tCollections("collection_error_title")}
          description={tCollections("collection_error_description")}
        />
      );
    // The way back does not depend on the collection, so it does not wait for
    // it: a slow load must never be a screen with no way off it.
    return (
      <div className="collection-detail">
        <Link to="/collections" className="back-link" activeOptions={CONTENT_LINK_ACTIVE_OPTIONS}>
          <Icon name="back" />
          {tCollections("back_to_collections")}
        </Link>
        <CollectionDetailSkeleton label={t("loading")} />
      </div>
    );
  }

  return (
    <div className="collection-detail">
      <Link to="/collections" className="back-link" activeOptions={CONTENT_LINK_ACTIVE_OPTIONS}>
        <Icon name="back" />
        {tCollections("back_to_collections")}
      </Link>
      <div className="collection-detail-header">
        <h1>{collection.name}</h1>
        <Link to="/collections/$id/edit" params={{ id }} className="touch-target button-quiet">
          <Icon name="edit" />
          {tCollections("edit_collection")}
        </Link>
      </div>
      {collection.description && <p>{collection.description}</p>}

      {/* tabIndex={-1} so a delete that empties the list has somewhere named to
          go (#367). Not in the tab order — a negative index is reachable only
          programmatically, which is the whole point of it. */}
      <h2 ref={itemsHeadingRef} tabIndex={-1}>
        {t("items_heading")}
      </h2>
      <div className="item-list-controls">
        <ItemSearchBox value={search.q ?? ""} onSearch={setSearch} inputRef={searchInputRef} />
        <ItemSortSelect value={sort} searching={q !== ""} fields={collection.fields} onSort={setSort} />
      </div>
      <FilterPanel collectionId={id} fields={collection.fields} filters={filters} onApply={setFilters} />
      <AppliedFilters
        fields={collection.fields}
        filters={filters}
        onRemove={(index) => {
          // Successor rule, as for any removal: the chip now at this index, else
          // the one before, else — with no chip left — the Filters toggle.
          handOffFocus(() => {
            const chips = Array.from(document.querySelectorAll<HTMLElement>("[data-filter-chip]"));
            return chips[index] ?? chips[chips.length - 1] ?? filtersToggle();
          });
          setFilters(filters.filter((_, i) => i !== index));
        }}
        onClear={() => {
          handOffFocus(filtersToggle);
          setFilters([]);
        }}
      />
      <ItemList
        collection={collection}
        query={itemsQuery}
        q={q}
        filtered={filters.length > 0}
        onClearFilters={() => {
          handOffFocus(filtersToggle);
          setFilters([]);
        }}
        onClearSearch={() => {
          // The button goes with the empty state it sits in, so focus goes to
          // the box whose text was cleared — where the next search starts.
          handOffFocus(() => searchInputRef.current);
          setSearch("");
        }}
        onSaved={(saved, index) => {
          // The row's own Edit if the saved item is still listed (return to
          // invoker); if the search no longer matches it, the row that took its
          // place (successor, as for a delete). Decided here, at the page,
          // because the row may be the thing that disappears (#41).
          if (isListed(saved.id)) {
            handOffFocus(
              () => document.querySelector<HTMLElement>(`[data-item-id="${saved.id}"] [data-row-edit]`) ?? null,
            );
          } else {
            handOffFocus(rowDestination(index));
            announce(t("saved_hidden", { name: itemLabel(collection, saved, t("untitled")) }));
          }
        }}
        onDeleting={(index) => handOffFocus(rowDestination(index))}
        onDeleted={(item, index) => {
          // Drop any failure from a previous undo: the new toast is about a new
          // deletion, and must not open carrying the last one's error.
          restoreItem.reset();
          setUndo({ itemId: item.id, name: itemLabel(collection, item, t("untitled")), index });
        }}
      />

      {/* Always rendered, never conditional (#308). The toast used to appear as
          a `role="status"` region with its message already inside it, and a live
          region inserted with content is announced by VoiceOver but usually not
          by NVDA or JAWS. So the region is here from the screen's first commit,
          empty, and the toast arrives in it — a delete needs a loaded row and a
          round trip, so the words can never land in the same commit as the
          region that speaks them.

          It cannot be the shell's announcer: that one is visually hidden and
          holds no interactive content, whereas these words come with a focusable
          Undo button and the two have to stay together on screen. Rendered in
          place rather than portalled to the shell for the same reason — inside
          <main>, the button stays in its landmark and in its tab position.

          The outer element is layout only. The live region is the inner wrapper,
          which holds the toast alone: the restore error below is `role="alert"`,
          a live region in its own right, and nesting it would give it two owners.
          No `aria-atomic` either — unlike the shell's announcer, which replaces
          one string wholesale, this region's content is replaced in place by a
          second delete, and atomic would re-read the whole toast instead of the
          name that changed. */}
      <div className="undo-toast-region">
        <div className="undo-toast-live" aria-live="polite">
          {undo && (
            <UndoToast
              message={t("deleted_toast", { name: undo.name })}
              actionLabel={t("undo")}
              dismissLabel={t("dismiss_undo")}
              onAction={() =>
                restoreItem.mutate(undo.itemId, {
                  onSuccess: (restored) => {
                    // A search can hide the restored item (#41); then focus
                    // goes where the delete left it, as Dismiss does.
                    if (!isListed(undo.itemId)) {
                      handOffFocus(rowDestination(undo.index));
                      announce(t("restored_hidden", { name: itemLabel(collection, restored, t("untitled")) }));
                      setUndo(null);
                      return;
                    }
                    // Focus follows the item back. The destination does not
                    // exist yet at this point — the toast unmounts on the next
                    // line and the row only reappears once the list has been
                    // fetched again — which is why the handoff waits for it.
                    // Asked for inside onSuccess, so a failed restore leaves
                    // focus on Undo, where the retry is.
                    handOffFocus(() =>
                      document.querySelector<HTMLElement>(`[data-item-id="${undo.itemId}"] [data-row-edit]`),
                    );
                    setUndo(null);
                  },
                })
              }
              onDismiss={() => {
                handOffFocus(rowDestination(undo.index));
                setUndo(null);
              }}
            />
          )}
        </div>
        {/* A failed undo keeps the toast up: the shortcut is the only thing that
            failed, and taking it away would leave the user nothing to retry
            with. */}
        {undo && restoreItem.isError && <p role="alert">{t("restore_error")}</p>}
      </div>

      <section className="add-item">
        <h2>{t("add_item")}</h2>
        <DynamicItemForm
          fields={collection.fields}
          pending={createItem.isPending}
          resetSignal={addedCount}
          onSubmit={(payload) =>
            createItem.mutate(payload, {
              onSuccess: (item) => {
                // Runs after the list has been fetched again, so whether the
                // search shows the new item is known now and said once (#41).
                setAdded({ name: itemLabel(collection, item, t("untitled")), hidden: !isListed(item.id) });
                setAddedCount((count) => count + 1);
              },
            })
          }
        />
        {/* Always rendered, never conditional (#308, #326, and #368 is what
            made this screen need one at all). A keyboard user adding an item
            used to get nothing: focus on <body>, a form still holding what they
            typed, and silence. The region is here from the screen's first
            commit, empty, and the confirmation arrives in it — a live region
            inserted with its text already inside it is announced by VoiceOver
            but usually not by NVDA or JAWS.

            No role, on the region or on the sentence that lands in it:
            `role="status"` implies `aria-live`, so a role on the message would
            make the message the nearest live region for its own insertion and
            lose the announcement. The failure below stays outside it, keeping
            `role="alert"` as a live region in its own right. */}
        <div className="add-item-live" aria-live="polite">
          {added && <p>{t(added.hidden ? "added_status_hidden" : "added_status", { name: added.name })}</p>}
        </div>
        {createItem.isError && <p role="alert">{t("create_error")}</p>}
      </section>
    </div>
  );
}

interface ItemListProps {
  collection: Collection;
  query: UseQueryResult<Item[]>;
  /** The search in force, trimmed; empty when none (#41). */
  q: string;
  onClearSearch: () => void;
  /** Whether filters narrow the list (#41). */
  filtered: boolean;
  onClearFilters: () => void;
  /** After a row's Save has landed and the list has been fetched again. */
  onSaved: (item: Item, index: number) => void;
  /** Asked for as a delete starts, while the row is still on screen. */
  onDeleting: (index: number) => void;
  onDeleted: (item: Item, index: number) => void;
}

/**
 * Renders the item list, keeping "we could not load these" and "we loaded them
 * and there are none" as distinct outcomes — collapsing the two is what made a
 * failed load read as an empty collection (#228).
 */
function ItemList({
  collection,
  query,
  q,
  filtered,
  onClearSearch,
  onClearFilters,
  onSaved,
  onDeleting,
  onDeleted,
}: ItemListProps) {
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
    return <ItemListSkeleton label={t("loading_items")} />;
  }

  // "Nothing matches" and "nothing here" are different news, with different
  // ways out (#41).
  if (items.length === 0 && (q || filtered))
    return (
      <EmptyState
        title={q ? t("no_matches", { q }) : t("no_matches_filtered")}
        description={q ? t("no_matches_description") : t("no_matches_filtered_description")}
      >
        {q && (
          <button type="button" className="touch-target button-quiet" onClick={onClearSearch}>
            {t("clear_search")}
          </button>
        )}
        {filtered && (
          <button type="button" className="touch-target button-quiet" onClick={onClearFilters}>
            {t("filters_clear")}
          </button>
        )}
      </EmptyState>
    );
  if (items.length === 0) return <EmptyState title={t("empty_items")} description={t("empty_items_description")} />;

  return (
    <>
      {query.error && <p role="alert">{t("items_reload_error")}</p>}
      {/* Visible, not live: the announcer speaks it once the search settles. */}
      {q ? (
        <p className="item-count">{t("items_match", { count: items.length, q })}</p>
      ) : (
        filtered && <p className="item-count">{t("items_match_filtered", { count: items.length })}</p>
      )}
      <ul className="item-list" aria-busy={query.isPlaceholderData || undefined}>
        {items.map((item, index) => (
          <ItemRow
            key={item.id}
            collection={collection}
            item={item}
            onDeleting={() => onDeleting(index)}
            onDeleted={() => onDeleted(item, index)}
            onSaved={(saved) => onSaved(saved, index)}
          />
        ))}
      </ul>
    </>
  );
}

interface ItemRowProps {
  collection: Collection;
  item: Item;
  onSaved: (item: Item) => void;
  onDeleting: () => void;
  onDeleted: () => void;
}

function ItemRow({ collection, item, onDeleting, onDeleted, onSaved }: ItemRowProps) {
  const { t } = useTranslation("items");
  const updateItem = useUpdateItem(collection.id);
  const deleteItem = useDeleteItem(collection.id);
  const [editing, setEditing] = useState(false);

  // Opening and closing the editor both remove the control that was pressed, so
  // both hand focus on (#367). This row survives either, so the handoff lives
  // here; the delete, which takes the row itself, is handled by the page.
  // What this row is called, which four things need: the editor's name, both of
  // the row's controls (#375), and the toast if it is deleted.
  const name = itemLabel(collection, item, t("untitled"));
  const handOffFocus = useFocusHandoff();
  const editRef = useRef<HTMLButtonElement>(null);
  // The APG dialog rule, return-to-invoker: whatever closes the editor — Cancel
  // or a successful Save — hands focus back to the control that opened it.
  const toEdit: FocusDestination = () => editRef.current;

  // The failure message belongs to this row, so it lives inside this <li> —
  // a page-level banner could not say *which* item failed. `.item-row` moves
  // onto an inner wrapper because it is a flex row: an alert added beside the
  // fields and actions would be squeezed into a third column, whereas the
  // unstyled <li> stacks the card and the message. No CSS change needed.
  if (editing) {
    return (
      <li data-item-id={item.id}>
        <div className="item-row">
          <DynamicItemForm
            fields={collection.fields}
            initialStatus={item.status}
            initialValues={item.fields}
            submitLabel={t("save")}
            // The editor takes the item's own fields off the screen, so it has
            // to carry the name itself — and it is what a user entering it
            // hears first (#367).
            label={t("editing_item", { name })}
            focusOnOpen
            pending={updateItem.isPending}
            // Cancelling discards the whole editing session, the failed save
            // included: without the reset, reopening the editor would show an
            // error for an attempt the user has not made yet.
            onCancel={() => {
              handOffFocus(toEdit);
              updateItem.reset();
              setEditing(false);
            }}
            onSubmit={(payload) =>
              updateItem.mutate(
                { itemId: item.id, input: payload },
                {
                  // The page picks the destination: a search may have taken
                  // this row off the list, and this row's handoff would die
                  // with it (#41).
                  onSuccess: (saved) => {
                    onSaved(saved);
                    setEditing(false);
                  },
                },
              )
            }
          />
        </div>
        {updateItem.isError && <p role="alert">{t("update_error")}</p>}
      </li>
    );
  }

  return (
    <li data-item-id={item.id}>
      <div className="item-row">
        <div className="item-fields">
          <span className={`item-status item-status-${item.status}`}>
            {/* The dot is redundant with the label beside it, so it is hidden
                rather than announced — status is never conveyed by color alone. */}
            <span className="status-dot" aria-hidden="true" />
            {t(`status_${item.status}`)}
          </span>
          {collection.fields.map((field) => (
            <span key={field.id} className="item-field">
              <span className="item-field-label">{field.label}:</span> <FieldValue value={item.fields[field.id]} />
            </span>
          ))}
        </div>
        <div className="item-actions">
          {/* `data-row-edit` is how the page addresses this button as a focus
              destination from outside the row: the row a delete hands focus to
              is a sibling this component holds no reference to, and the row an
              Undo restores does not exist yet when focus is lost (#367). */}
          <button
            type="button"
            ref={editRef}
            data-row-edit=""
            // Names the row it edits (#375). Every row says "Edit" otherwise,
            // so a screen-reader user hears the same word once per item with
            // nothing tying a press to a record — and this is also where a
            // delete, an undo and a cancelled editor all hand focus, where
            // arriving on an unnamed "Edit" says nothing about what happened.
            aria-label={t("edit_item", { name })}
            className="touch-target button-quiet"
            onClick={() => setEditing(true)}
          >
            <Icon name="edit" />
            {t("edit")}
          </button>
          <button
            type="button"
            aria-label={t("delete_item", { name })}
            className="touch-target button-quiet"
            onClick={() => {
              // Asked for before the mutation, while the row is still on screen
              // and this button still holds focus.
              onDeleting();
              deleteItem.mutate(item.id, { onSuccess: onDeleted });
            }}
          >
            <Icon name="delete" />
            {t("delete")}
          </button>
        </div>
      </div>
      {deleteItem.isError && <p role="alert">{t("delete_error")}</p>}
    </li>
  );
}
