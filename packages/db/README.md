# @mycollections/db

Local persistence for MyCollections: a single file-backed SQLite database (WAL mode) accessed through [Drizzle ORM](https://orm.drizzle.team/) and better-sqlite3, exposed to the rest of the app as typed repositories over the [`@mycollections/core`](../core/) domain types.

An earlier draft of this package called for an in-memory SQLite mirror in front of the file database. That was dropped (see #20): WAL-mode SQLite on a local file already answers queries in microseconds at this app's scale, and a single database removes a whole class of divergence bugs. The repository layer is the seam where a cache could be added later if ever measured as needed.

## Schema (Phase 1)

| Table | Purpose |
|---|---|
| `collections` | Collection metadata, `is_finite_set` flag, and the field schema (JSON array of `FieldDefinition`) |
| `items` | Items with `status` (`owned`/`wanted`/`ordered`) and custom field values in a JSON column queryable with `json_extract()` |
| `media` | Per-item media (images) with primary designation and `storage_path` |
| `user_profile` | Account info from the auth layer plus a JSON settings blob (theme, locale, opt-outs) |

Later phases add their own tables via new migrations: `share_links` (#48), `plugin_data` (#54/#55), `licenses` (#57), `mutations`/`sync_state` (#49), and the `items_fts` FTS5 table (#41).

- **Soft delete**: `collections`, `items`, and `media` carry a nullable `deleted_at`; repositories exclude soft-deleted rows unless asked (`includeDeleted`), and offer `restore()`. Hard deletes cascade (collection → items → media) via foreign keys.
- **Timestamps** are ISO 8601 strings, matching the core Zod schemas.

## Migrations

Migrations are generated with drizzle-kit (`pnpm generate`) into `drizzle/` and ship with the package. `openDatabase()` applies pending migrations automatically on startup. If the database already has data and migrations are pending, a backup copy is written next to it first (`<path>.<timestamp>.bak`) — restoring is opening that file.

## File permissions

The database holds every collection in plaintext, so `openDatabase()` creates it — plus its `-wal`/`-shm` sidecars and any pre-migration `.bak` — readable and writable only by the owning account (`0600`), and creates missing parent directories as `0700`. An existing database opened with looser permissions is tightened on startup (#242).

The file is pre-created at `0600` *before* SQLite opens it: SQLite would otherwise create it world-readable (`0644` under a typical umask), and it derives the sidecar modes from the database file's own mode, so getting the main file right is what makes the sidecars right.

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
const item = await handle.items.create({ collectionId: collection.id, fields: { title: "Dune" } });
const hits = await handle.items.findByFieldValue(collection.id, "title", "Dune"); // json_extract()

handle.close();
```

## What's exported

| Export | Purpose |
|---|---|
| `openDatabase` / `DatabaseHandle` | Open + migrate the database; returns repositories, the Drizzle instance (`db`), and the raw connection (`sqlite`) |
| `CollectionsRepository` | CRUD, soft delete/restore, hard delete |
| `ItemsRepository` | CRUD, list/filter by status, `findByFieldValue()` via `json_extract()` |
| `MediaRepository` | CRUD plus `setPrimary()` (demotes the previous primary in the same transaction) |
| `UserProfileRepository` | `get()` / `upsert()` keyed by the auth layer's account key |
| `schema` | The Drizzle table definitions, for callers needing custom queries |

Repositories validate reads and writes with the core Zod schemas, so malformed rows fail loudly at the boundary. All tests run against real SQLite (no mocks).
