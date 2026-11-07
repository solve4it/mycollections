# @mycollections/api

Local Fastify API server for MyCollections. Runs on `localhost` only and is intended to be embedded in the Tauri desktop wrapper (#63).

## Security

- **Bearer token auth**: Every request (except `GET /api/health`) requires `Authorization: Bearer <token>`. The token is a random UUID generated at startup (or set via `API_TOKEN` env var). Comparison is constant-time via [`@fastify/bearer-auth`](https://github.com/fastify/fastify-bearer-auth), and the scheme name is matched case-insensitively per RFC 7235.
- **Auth by scope, not by path**: the collection, item and export routes are registered inside an encapsulated Fastify scope that owns the bearer guard, so a new route is protected by where it is registered rather than by matching an exemption list. Only `GET /api/health` — and the Swagger UI in development — are registered outside it. Path-matching exemptions previously let a query string (`/api/health?probe=1`) turn a public route into a 401 and left the whole `/api/docs` prefix unauthenticated in production (#242). A request to an unknown path answers 404 without authenticating, since no handler is reachable.
- **OWASP headers**: `@fastify/helmet` applies `X-Content-Type-Options`, `Strict-Transport-Security`, `X-Frame-Options`, `X-XSS-Protection`, and a strict `Content-Security-Policy` in production.
- **CORS**: Restricted to `http://localhost:<port>` in dev mode; disabled in production (same-origin only).
- **Localhost binding**: The server binds to `127.0.0.1` by default — never exposed to the network.

## Routes

All routes require `Authorization: Bearer <token>` except `GET /api/health`.

| Method   | Path                                         | Description                                                                                                       |
| -------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `GET`    | `/api/health`                                | Health check (no auth required)                                                                                   |
| `GET`    | `/api/collections`                           | List all collections, each with `itemCount` and `ownedCount` (see [Counts and progress](#counts-and-progress-42)) |
| `POST`   | `/api/collections`                           | Create a collection — a finite set may carry a target (see [A finite set's target](#a-finite-sets-target-42))     |
| `GET`    | `/api/collections/:id`                       | Get a collection                                                                                                  |
| `GET`    | `/api/collections/:id/counts`                | A collection's live items per status: `{ total, owned, wanted, ordered }`                                         |
| `PATCH`  | `/api/collections/:id`                       | Update a collection, its field schema included (see [Editing a field schema](#editing-a-field-schema))            |
| `DELETE` | `/api/collections/:id`                       | Soft-delete a collection                                                                                          |
| `POST`   | `/api/collections/:id/restore`               | Restore a soft-deleted collection                                                                                 |
| `GET`    | `/api/collections/:id/items`                 | List items (`?status=owned\|wanted\|ordered`, `?q=` search, `?sort=` — see below)                                 |
| `POST`   | `/api/collections/:id/items`                 | Create an item                                                                                                    |
| `POST`   | `/api/collections/:id/tags/rename`           | Rename or merge a tag across the collection's items (see below)                                                   |
| `POST`   | `/api/collections/:id/tags/remove`           | Remove a tag from the collection's items                                                                          |
| `GET`    | `/api/collections/:id/tag-values`            | Tags in use in a tags field (`?field=`), for suggestions                                                          |
| `GET`    | `/api/collections/:id/items/:itemId`         | Get an item                                                                                                       |
| `PATCH`  | `/api/collections/:id/items/:itemId`         | Update an item                                                                                                    |
| `DELETE` | `/api/collections/:id/items/:itemId`         | Soft-delete an item                                                                                               |
| `POST`   | `/api/collections/:id/items/:itemId/restore` | Restore a soft-deleted item                                                                                       |
| `GET`    | `/api/trash`                                 | List what soft delete has hidden: `{ collections, items }`                                                        |
| `DELETE` | `/api/trash`                                 | Empty the trash — permanently delete everything in it; returns `{ items, collections }` counts                    |
| `DELETE` | `/api/trash/items/:itemId`                   | Permanently delete a trashed item                                                                                 |
| `DELETE` | `/api/trash/collections/:id`                 | Permanently delete a trashed collection and its items                                                             |
| `GET`    | `/api/export`                                | Download a JSON backup of all collections and items                                                               |
| `POST`   | `/api/import`                                | Restore a backup document (`?mode=skip`)                                                                          |

### Searching and sorting items (#41, #42)

`GET /api/collections/:id/items` takes, all optional and combinable:

| Param    | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `status` | `owned`, `wanted` or `ordered`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `q`      | Search text, at most 200 characters. Each word must prefix-match a text, select, multiselect, tags or number value (case- and accent-insensitive). Results are ranked by relevance unless `sort` is given.                                                                                                                                                                                                                                                                                                                                                       |
| `filter` | Structured filters, a JSON array (at most 2048 characters and 10 filters), ANDed — see below.                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `sort`   | One key, JSON:API style — `-` prefix for descending: `createdAt`, `updatedAt`, `name`, `status` (#42: `status` is collected first — owned, ordered, wanted; `-status` is still to get first — wanted, ordered, owned), or `field:<fieldId>`. Empty values sort last. Ties keep the order items were added, reversed with `-`, so a descending sort is the exact reverse of its ascending one. Without `sort`, items come in the order they were added, or by relevance when `q` has terms. Tags, multiselect and image fields cannot be sorted; that is a `400`. |

**Filters** follow the vocabulary in `packages/core/src/item-filter.ts`. Each one names a field of the collection's schema and an operator that suits its type:

| `op`    | Field types                    | `value`                   | Matches                                  |
| ------- | ------------------------------ | ------------------------- | ---------------------------------------- |
| `in`    | select, multiselect, tags      | 1–20 strings              | any of them (tags ignore ASCII case)     |
| `all`   | multiselect, tags              | 1–20 strings              | every one of them                        |
| `gte`   | number, rating, currency, date | a number, or `YYYY-MM-DD` | at or above, inclusive (dates by day)    |
| `lte`   | number, rating, currency, date | a number, or `YYYY-MM-DD` | at or below, inclusive                   |
| `eq`    | boolean                        | `true` or `false`         | exactly that — not an item with no value |
| `empty` | all of the above               | —                         | missing, `null`, `""` or `[]`            |

Text, url, email and image fields take no filters; search covers text. Stored values are compared trimmed; tags ignore case for ASCII letters only (SQLite's `NOCASE`, so "É" and "é" differ); a date bound matches only stored text that starts `YYYY-MM-DD`. The 2048-character cap counts characters, not bytes: a filter full of non-ASCII text can exceed Node's 16 KB request-header limit first and be refused with a `431` before the API sees it, so the web client checks the encoded length itself. Each operator checks the stored type, so a number stored as text never passes a numeric bound. An invalid filter is a `400` "Invalid filter" (or "Unknown filter field" / "This filter does not suit this field"), never quoting the request.

`GET /api/collections/:id/tag-values?field=<id>` lists the tags in use in one tags field — `{ values: [{ value, count }], truncated }`, live items only, most used first, at most 50.

**Tag management** (#41) — a tag is a value inside items, not a resource with an id, so these are custom-method endpoints (Google AIP-136) with the tag in the body (tags run to 200 characters; Fastify's path parameters stop at 100):

| Method | Path                               | Body                  | Does                                                                                 |
| ------ | ---------------------------------- | --------------------- | ------------------------------------------------------------------------------------ |
| `POST` | `/api/collections/:id/tags/rename` | `{ field, from, to }` | Renames the tag on every item, trashed ones too; into an existing tag, the two merge |
| `POST` | `/api/collections/:id/tags/remove` | `{ field, value }`    | Takes the tag off every item, trashed ones too                                       |

Both answer `{ updated, trashed }` — live and trashed items actually changed, counted apart because the screen asks about live ones — and rename adds `merged`, whether the new name was already a tag on some item; and match tags as filters do (spaces trimmed, ASCII case ignored). A new name cannot contain a comma, which the item form would split into two tags. A trashed collection is a `404`; a field that is not tags, or an invalid tag, a fixed-text `400`. Renaming 50,000 items runs in one transaction of about a second, almost all of it the search index updating each row. `tag-values` also takes `q`, a part of the name, to reach tags beyond the most used fifty.

A repeated `q`, `sort` or `filter` is a `400`, never one value silently winning. Error messages are fixed text and never echo the query, and the request log records the path without its query string — search text is collection data, held to the same rule as request bodies. That includes the 404 for an unknown route, whose log line and response message name the path only.

In dev mode, OpenAPI docs are available at `GET /api/docs`.

### Editing a field schema

`PATCH /api/collections/:id` accepts `fields`, replacing the whole array — send the
schema you want, not a delta. Item values are stored in a JSON object keyed by field
id and are never coerced against the collection's definitions, which decides what each
edit costs:

| Edit                                                                              | Effect on existing items                                                                                                              |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Add a field                                                                       | None. Items have no value for it and render blank. `required` starts applying the next time an item is edited; nothing is backfilled. |
| Relabel, change help text, edit `select` options, `rating` max, or `currencyCode` | None.                                                                                                                                 |
| Reorder                                                                           | None — display order only.                                                                                                            |
| Remove a field                                                                    | Values stored under that id are **kept**, unrendered. They survive in `GET /api/export`.                                              |
| Change a field's type                                                             | Rejected with `400` while the collection holds any items.                                                                             |

Retyping is the one edit that would strand data — a text value under a field that
became `number` is unreadable by the new control — so it is allowed only while the
collection is empty. That count includes trashed items, because restoring one would
bring back values the new schema cannot read.

Removal keeps values rather than purging them, so a schema edit is never a mass delete.
The kept values are reachable through a JSON export, not through the UI: re-adding a
field mints a new id, so it does not re-attach to the old values.

The route reads the collection before it writes, so a rejected patch leaves nothing
behind — a `400` or `404` never persists the rest of the body.

### A finite set's target (#42)

A collection with `isFiniteSet: true` may carry `targetCount`, how many items complete
the set — a whole number from 1 to 100,000, or `null` when the size is not known yet.
Every collection in a response has the key; it is `null` unless set.

| Request                                                   | Result                                                               |
| --------------------------------------------------------- | -------------------------------------------------------------------- |
| `POST` with `isFiniteSet: true, targetCount: 50`          | `201`, `targetCount: 50`                                             |
| `POST` or `PATCH` without `targetCount`                   | No target on create; on update the stored one is kept                |
| `PATCH { "targetCount": null }`                           | Clears the target; the collection stays a finite set                 |
| `PATCH { "isFiniteSet": false }`                          | Clears the target with the flag                                      |
| A target on a collection that is not, or stops being, one | `400` "targetCount requires isFiniteSet"; nothing is written         |
| `"5"`, `""`, `true`, `false`, `[5]`, `0`, `2.5`, `100001` | `400`; nothing is written — the value is never coerced into a number |

The body schema declares `targetCount` with an empty schema on purpose: Fastify's Ajv
coerces types, so `{ "type": "integer" }` would quietly turn `"5"` into 5 and `""` into
0. Zod decides it instead, in the repository, before any write.

### Counts and progress (#42)

Counts cover live items only: a trashed item counts toward nothing, and neither does any item of a trashed collection.

`GET /api/collections` gives every collection two numbers beside its fields, both from one `GROUP BY` over all collections:

```json
{
  "id": "…",
  "name": "State quarters",
  "isFiniteSet": true,
  "targetCount": 50,
  "itemCount": 6,
  "ownedCount": 3,
  "…": "…"
}
```

| Key          | Meaning                                                               |
| ------------ | --------------------------------------------------------------------- |
| `itemCount`  | Live items, whatever their status                                     |
| `ownedCount` | Live items with `status: "owned"` — a finite set's progress numerator |

`GET /api/collections/:id/counts` answers one collection's live items per status — exactly these four keys, `total` always `owned + wanted + ordered`:

```json
{ "total": 6, "owned": 3, "wanted": 2, "ordered": 1 }
```

It answers for every live collection, finite set or not, and with zeros when nothing is live. An unknown id and a trashed collection are both a `404` "Collection not found" — the collection is looked up before anything is counted.

The API sends counts, not progress. Core's `collectionProgress(collection, ownedCount)` turns them into `{ owned, target, fraction, complete }` for a finite set with a target, and `null` otherwise: owned items are collected, wanted and ordered ones remain, `owned` is never capped ("6 of 5") and only `fraction` stops at 1.

### Trash and soft delete

`DELETE` on a collection or an item stamps `deletedAt` instead of removing the row.
Permanent deletion is a separate request to a separate path (`/api/trash/...`), so
destroying data is never one query parameter away from an everyday delete. Both purge
routes carry the "is it actually in the trash?" test inside the `DELETE` statement, so a
restore racing a purge cannot destroy a row the user has just recovered, and a live
resource answers `404` without being touched.

Nothing is purged on a timer: the trash keeps what it holds until the user empties it,
either one entry at a time or all at once with `DELETE /api/trash`. Emptying is the one
action in the app that nothing can undo, so it runs in a single transaction (it either
happens or does not) and answers with what it removed rather than a bare `204`.

**Deleting a collection does not touch its items.** No child row is stamped: a trashed
collection simply takes its contents down with it, and restoring the collection brings
back everything it held. Consequently:

- `GET /api/trash` lists a trashed collection, and lists trashed items only while their
  collection is live. Items inside a trashed collection are not offered individually —
  restoring one could only put it back somewhere the user cannot see.
- `POST /api/collections/:id/items/:itemId/restore` answers `404` while the parent
  collection is in the trash. Restore the collection instead.
- Purging a collection removes its items too, via the foreign key cascade. Emptying the
  trash removes trashed collections first for the same reason, so an item that was deleted
  individually _and_ whose collection was later deleted is removed once, not counted twice.

### Backup format

`GET /api/export` returns a versioned, human-readable JSON document:

```json
{
  "version": 1,
  "exportedAt": "2026-06-14T12:00:00.000Z",
  "collections": [ /* full Collection records, incl. soft-deleted */ ],
  "items": [ /* full Item records, each carrying its collectionId */ ]
}
```

`POST /api/import` accepts exactly that document. The whole import runs in a single
transaction, so an invalid payload is rejected with `400` and leaves the database
untouched (no partial writes). The only `mode` today is `skip` (the default):
records whose id already exists are left as-is, making imports idempotent and
non-destructive. `replace` / `merge` modes are reserved for the future.

The document embeds full collection records, so it carries each finite set's
`targetCount`. Adding that field did not change `version`: a version 1 backup written
before it existed imports with `targetCount: null`, and an older app reading a newer
backup ignores the key. A backup in which any collection has a target but is not a
finite set is rejected whole with `400`.

## Usage

```ts
import { buildApp } from "@mycollections/api";
import { openDatabase } from "@mycollections/db";
import { randomUUID } from "node:crypto";

const db = await openDatabase({ path: "app.db" });
const token = randomUUID();
const app = await buildApp({ db, token, isDev: true });
await app.listen({ port: 3001, host: "127.0.0.1" });
```

## Configuration

| Env var       | Default                                                                                            | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DB_PATH`     | `apps/api/data/app.db`                                                                             | SQLite database file path. The default is anchored to the app directory (not the current working directory), so it's the same file no matter where you launch from. The resolved path is printed on startup.                                                                                                                                                                                                                                                                       |
| `PORT`        | `3001`                                                                                             | HTTP port. Must be an integer 0–65535; `0` asks the OS for a free port.                                                                                                                                                                                                                                                                                                                                                                                                            |
| `HOST`        | `127.0.0.1`                                                                                        | Bind address. Anything other than loopback publishes the API to the network and is refused unless `API_TOKEN` is set explicitly and is at least 32 characters.                                                                                                                                                                                                                                                                                                                     |
| `API_TOKEN`   | random UUID (development only)                                                                     | Bearer token, regenerated on every start and printed to stdout **in development only**. **Required outside development**: the generated fallback is never printed there, so it would be known to nobody and every authenticated request would 401 — the server refuses to start rather than bind something unusable.                                                                                                                                                               |
| `NODE_ENV`    | —                                                                                                  | Set to `production` to disable Swagger UI and harden CSP                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `DEV_ORIGINS` | `http://localhost:5173`, `http://127.0.0.1:5173`, `http://localhost:4173`, `http://127.0.0.1:4173` | **Development only.** Comma-separated browser origins the dev CORS allowlist accepts, for a web dev server on another port (a parallel worktree, two branches at once). Replaces the defaults rather than extending them; loopback origins only; empty keeps the defaults and anything else refuses to start. Never read when `NODE_ENV=production`, where CORS is off entirely. Overriding it is reported as a startup warning, since a changed allowlist is otherwise invisible. |

An empty value counts as unset, not as a value: `HOST=""` used to reach `app.listen()` verbatim and bind _every_ interface. Invalid configuration prints a one-line reason and exits non-zero rather than starting.

## Network exposure

The server is meant to be reachable only from the machine it runs on, and three checks keep it that way (#242):

- **Bind guard** — a non-loopback `HOST` refuses to start without a deliberate, long `API_TOKEN`. A token generated at startup would be printed to a console nobody is watching.
- **Host pinning** — requests whose `Host` header is not loopback are refused with `403`, which is what a DNS-rebinding page (an attacker domain resolving to `127.0.0.1`) presents; such a request is same-origin to the browser, so CORS never sees it. Reads the raw `Host` header, not `request.hostname`, which is derived from the client-supplied `X-Forwarded-Host` when `trustProxy` is on. Binding non-loopback deliberately turns this off — there is no way to know which name a LAN client will use — and logs a warning at startup.
- **CORS** — an exact-origin allowlist in development (`http://localhost:5173` / `:4173` and their `127.0.0.1` equivalents), disabled entirely in production. The previous `/^http:\/\/localhost(:\d+)?$/` trusted every port on localhost; any local process can bind a high port, and with `credentials: true` that becomes a CSRF hole the moment a cookie session replaces the bearer header. `apps/web/vite.config.ts` sets `strictPort` so the dev server cannot drift off the allowlist. The development list is configurable through `DEV_ORIGINS` (comma-separated) for a second instance on another port — a parallel worktree, two branches verified at once — which is what the hardcoded list made impossible (#327). It replaces the defaults rather than extending them, and every entry is parsed as a URL and accepted only if it is `http`/`https` on a **loopback** host with no credentials, path, query or fragment, so `http://localhost:5173.evil.example.com` and `http://evil.example.com#localhost:5173` are rejected rather than matched. Unset or empty keeps the defaults; anything else refuses to start, naming the entry. It is read only when `isDev`, and `origin` is `false` outside development regardless, so nothing here can reach production.

### Refusing to start vs. warning

`resolveServerConfig()` **throws** for configuration that cannot work — an invalid `PORT`, a non-loopback `HOST` without a strong explicit token, or a missing `API_TOKEN` outside development. The entrypoint prints `Configuration error: <reason>` and exits non-zero without binding, so a broken configuration is never a server that looks healthy and answers 401 to everything (#241).

`startupWarnings()` covers the other case: configuration that is legal but likely to surprise, printed once after the server binds. Today that is a non-loopback bind, which is network-reachable and has Host pinning off. Warnings never include the token, since these lines go to stdout and to whatever collects it.
