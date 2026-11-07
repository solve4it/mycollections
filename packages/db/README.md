# @mycollections/db

Local persistence for MyCollections: a single file-backed SQLite database (WAL mode) accessed through [Drizzle ORM](https://orm.drizzle.team/) and better-sqlite3, exposed to the rest of the app as typed repositories over the [`@mycollections/core`](../core/) domain types.

An earlier draft of this package called for an in-memory SQLite mirror in front of the file database. That was dropped (see #20): WAL-mode SQLite on a local file already answers queries in microseconds at this app's scale, and a single database removes a whole class of divergence bugs. The repository layer is the seam where a cache could be added later if ever measured as needed.

## Schema (Phase 1)

| Table          | Purpose                                                                                                                   |
| -------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `collections`  | Collection metadata, `is_finite_set` flag and its `target_count`, and the field schema (JSON array of `FieldDefinition`)  |
| `items`        | Items with `status` (`owned`/`wanted`/`ordered`) and custom field values in a JSON column queryable with `json_extract()` |
| `media`        | Per-item media (images) with primary designation and `storage_path`                                                       |
| `user_profile` | Account info from the auth layer plus a JSON settings blob (theme, locale, opt-outs)                                      |

Later phases add their own tables via new migrations: `share_links` (#48), `plugin_data` (#54/#55), `licenses` (#57), and `mutations`/`sync_state` (#49).

- **Soft delete**: `collections`, `items`, and `media` carry a nullable `deleted_at`; repositories exclude soft-deleted rows unless asked (`includeDeleted`), and offer `restore()`. Hard deletes cascade (collection → items → media) via foreign keys.
- **Trash**: `listDeleted()` on collections and items returns what soft delete has hidden, most recently deleted first (ties break on id, so the order is stable). `purge()` permanently removes a row, carrying the `deleted_at` test inside the `DELETE` so a concurrent restore cannot lose the row; it is a no-op on anything live. Deleting a collection stamps no child row — its items are hidden with it and return with it, so `items.listDeleted()` omits items whose collection is itself deleted.
- **Timestamps** are ISO 8601 strings, matching the core Zod schemas.
- **A finite set's target** (`target_count`, #42) is a nullable integer: how many items complete the set, or `NULL` when the size is unknown or the collection is not a finite set. `create`/`update` validate it with core's `CollectionSchema` — 1 to `TARGET_COUNT_MAX`, and only with `is_finite_set` — so a bad target throws before anything is written. `update(id, { isFiniteSet: false })` clears the target along with the flag; naming a target in that same patch is refused rather than dropped. Reads normalize: a stored target that is not a whole number in range, or sits on a collection that is not a finite set, reads as `null`, so one bad row (written by hand, or by another version) never fails a whole list or export. There is no `CHECK` constraint: SQLite cannot add one without rebuilding the table. Imports are checked whole — a backup holding one invalid target is rejected and nothing is imported.
- **Counts** (#42) cover live items only — a trashed item counts toward nothing. `items.countsByCollection()` is one `GROUP BY` over every live collection (joined to `collections`, because trashing a collection stamps none of its items), selecting `count(*)` and `sum(status = 'owned')`; it returns `{ [collectionId]: { total, owned } }` and leaves out collections with no live items (read a missing key as zeros). `items.countsForCollection(id)` returns core's `ItemCounts`, `{ total, owned, wanted, ordered }`, for one collection in one query — zeros, never `null`, when nothing is live. It does not check the collection is live; the caller does, so a trashed collection can answer 404 rather than zeros. `countByCollectionId(id)` is different: it counts trashed items too, for the retype guard.

## Search (`items_fts`, #41)

`items_fts` is an FTS5 table (`unicode61`, diacritics removed — "cafe" finds "Café") that triggers keep in step with `items`. Its rowid is never `items.rowid`: `items` has a text primary key, so its rowid is implicit and may be renumbered, which would attach one item's text to another. Nor is it found through an item-id column inside the FTS table, which FTS5 cannot index — every write would scan the whole index. A plain table, `items_search_key`, gives each item an `INTEGER PRIMARY KEY` (a rowid alias, which `VACUUM` keeps), and that key is the FTS rowid, so both lookups are indexed. Neither table is in `schema.ts`; the triggers are their only writers.

- **What is searchable is decided by the collection's schema**: values of `text`, `select`, `multiselect`, `tags` and `number` fields (a number stored in a text field included). Urls, emails, dates, ratings, currency, booleans and images are not searched, nor are values left under a key the schema no longer defines. Changing a collection's `fields` re-indexes its items.
- **Queries cannot carry FTS syntax.** `listByCollection(id, { q })` reduces the text to at most ten distinct words containing a letter or digit, each a quoted prefix phrase (`"dun"*`); all must match. Control characters are blanked first — a NUL would make SQLite throw.
- **Sort** (`{ sort }`, an `ItemSort` from core): `createdAt`, `updatedAt`, `name` (the first of the schema's first 100 fields holding a string, number or boolean — the web's `itemLabel` rule), `status` (#42: a `CASE` rank — ascending is owned, ordered, wanted; descending is wanted, ordered, owned), or one field by its schema type — numbers numerically, text case-insensitively (ASCII only: SQLite's `NOCASE` does not fold "é"), booleans false first. Empty values sort last in either direction; ties keep insertion order (the implicit `rowid`, never a timestamp, which items created in the same millisecond share) in the sort's own direction. A descending sort is therefore the exact reverse of its ascending one only when no value is empty — always true of `status`, `createdAt` and `updatedAt`; for `name` and field sorts, empty values stay last both ways. Tags, multiselect and image fields cannot be sorted (`InvalidItemQueryError`). Without a sort, results come in insertion order, or ranked by `bm25` when `q` has terms; an explicit sort, `status` included, replaces rank and applies after `q`, `status` and `filters` have narrowed the list.
- **Recovery**: `items.reindex()` rebuilds the index from `items`.

## Filters (#41)

`listByCollection(id, { filters })` takes core's `ItemFilter[]` (`in`, `all`, `gte`, `lte`, `eq`, `empty`; see `apps/api/README.md` for which suits which field type). Every condition is built by `filterCondition` and follows three rules:

- **Parenthesised.** Drizzle's `and()` does not wrap raw `sql` fragments, so an `OR` inside one — `empty` has three — would escape the collection and trash conditions. `items-filter.test.ts` holds a leak regression for every op that fails without the parentheses.
- **Type-guarded with `json_type`.** SQLite sorts text above every number, and `json_each` over a scalar yields the scalar, so unguarded comparisons match the wrong shapes. The API does not check item fields against the schema, so any shape can be stored.
- **Never throws.** Only paths built from the collection's own field ids reach SQL; anything else is an `InvalidItemQueryError` with fixed text. `json_each` columns are always qualified, since `json_each` has an `id` column of its own.

`renameTag` and `removeTag` rewrite a tag across a collection's items (trashed ones included) in one transaction; their JavaScript match is `foldTag`, a copy of SQLite's rule — trim spaces only, fold ASCII only — so they change exactly the tags filters and suggestions treat as one. A rename into an existing tag merges, and items left unchanged are not written. Tags compare without case (`COLLATE NOCASE`, ASCII only); select and multiselect values are the schema's options and compare as stored. `tagValues(id, fieldId)` counts the tags in use for suggestions — only tags a filter can ask for (trimmed, 1–200 characters, no control characters), so every suggestion finds its items. Stored values are compared trimmed, and a date bound only matches text that starts with a padded `YYYY-MM-DD`.

## Migrations

Migrations are generated with drizzle-kit (`pnpm generate`) into `drizzle/` and ship with the package. `openDatabase()` applies pending migrations automatically on startup. If the database already has data and migrations are pending, a backup copy is written next to it first (`<path>.<timestamp>.bak`) — restoring is opening that file.

`0002_target_count.sql` is the model for an additive column: drizzle-kit generated a single `ALTER TABLE … ADD` with no default, so existing rows read `NULL` and `items` is not rebuilt. `migrations.test.ts` pins it to exactly that statement and upgrades a database seeded at the previous migration — with raw SQL, since the repositories write columns the old table lacks — checking every row survives and the `.bak` is written.

Some migrations are hand-written (`pnpm exec drizzle-kit generate --custom --name <name>`), because drizzle-kit cannot express virtual tables or triggers — `0001_items_fts.sql` is one. Three rules follow:

- **Every statement gets its own `--> statement-breakpoint`.** The migrator prepares each chunk as a single statement; semicolons inside a trigger's `BEGIN … END` are fine.
- **Never run `drizzle-kit push` or `pull` against a real database.** They diff against the live schema, which holds `items_fts` and its triggers that `schema.ts` cannot describe, and would drop them.
- **A migration that rebuilds `items`** (drizzle-kit's create-copy-drop-rename pattern for most column changes) drops its triggers with the old table. It must recreate the `items_fts` triggers (and the `items_search_key` foreign key) and end with `DELETE FROM items_fts; UPDATE items SET fields = fields;` to re-index. The trigger-inventory test in `items-query.test.ts` fails if the triggers go missing.

## File permissions

The database holds every collection in plaintext, so `openDatabase()` creates it — plus its `-wal`/`-shm` sidecars and any pre-migration `.bak` — readable and writable only by the owning account (`0600`), and creates missing parent directories as `0700`. An existing database opened with looser permissions is tightened on startup (#242).

The file is pre-created at `0600` _before_ SQLite opens it: SQLite would otherwise create it world-readable (`0644` under a typical umask), and it derives the sidecar modes from the database file's own mode, so getting the main file right is what makes the sidecars right.

Two deliberate limits. A parent directory that already exists is left as it is — a `DB_PATH` of `/tmp/app.db` must not narrow `/tmp` — so upgrading an existing install leaves `data/` at its old mode; the `0600` files make that moot. And filesystems that cannot express POSIX permissions (exFAT, some network mounts) reject the change, which is ignored rather than fatal: failing to start would cost the user their app without buying back confidentiality that filesystem cannot provide anyway.

## Usage

```ts
import { openDatabase } from "@mycollections/db";

const handle = await openDatabase({ path: "/data/app.db" }); // ":memory:" in tests

const collection = await handle.collections.create({
  name: "Books",
  fields: [{ id: "title", type: "text", label: "Title", required: true }],
  isFiniteSet: false,
});
const quarters = await handle.collections.create({
  name: "State quarters",
  fields: [{ id: "state", type: "text", label: "State", required: true }],
  isFiniteSet: true,
  targetCount: 50, // only a finite set may have one; null (the default) is "size unknown"
});
const item = await handle.items.create({ collectionId: collection.id, fields: { title: "Dune" } });
const hits = await handle.items.findByFieldValue(collection.id, "title", "Dune"); // json_extract()

handle.close();
```

## What's exported

| Export                            | Purpose                                                                                                                                                                                                                  |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `openDatabase` / `DatabaseHandle` | Open + migrate the database; returns repositories, the Drizzle instance (`db`), and the raw connection (`sqlite`)                                                                                                        |
| `CollectionsRepository`           | CRUD (a finite set's `targetCount` included), soft delete/restore, `listDeleted()`/`purge()` for the trash, hard delete                                                                                                  |
| `ItemsRepository`                 | CRUD, list by status / search (`q`) / `sort` / `filters`, `tagValues()`, `countsByCollection()`/`countsForCollection()`, `reindex()`, `listDeleted()`/`purge()` for the trash, `findByFieldValue()` via `json_extract()` |
| `MediaRepository`                 | CRUD plus `setPrimary()` (demotes the previous primary in the same transaction)                                                                                                                                          |
| `UserProfileRepository`           | `get()` / `upsert()` keyed by the auth layer's account key                                                                                                                                                               |
| `emptyTrash`                      | Permanently removes every trashed collection (cascading to its items) and every trashed item, in one transaction                                                                                                         |
| `InvalidItemQueryError`           | Thrown by `listByCollection` for a sort or filter the collection cannot honour, and by `tagValues` for a field that is not tags; fixed text, safe for a 400                                                              |
| `schema`                          | The Drizzle table definitions, for callers needing custom queries                                                                                                                                                        |

Repositories validate reads and writes with the core Zod schemas, so malformed rows fail loudly at the boundary. All tests run against real SQLite (no mocks).
