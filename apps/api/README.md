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

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/health` | Health check (no auth required) |
| `GET` | `/api/collections` | List all collections (each includes `itemCount`, the number of non-deleted items) |
| `POST` | `/api/collections` | Create a collection |
| `GET` | `/api/collections/:id` | Get a collection |
| `PATCH` | `/api/collections/:id` | Update a collection, its field schema included (see [Editing a field schema](#editing-a-field-schema)) |
| `DELETE` | `/api/collections/:id` | Soft-delete a collection |
| `POST` | `/api/collections/:id/restore` | Restore a soft-deleted collection |
| `GET` | `/api/collections/:id/items` | List items (`?status=owned\|wanted\|ordered`) |
| `POST` | `/api/collections/:id/items` | Create an item |
| `GET` | `/api/collections/:id/items/:itemId` | Get an item |
| `PATCH` | `/api/collections/:id/items/:itemId` | Update an item |
| `DELETE` | `/api/collections/:id/items/:itemId` | Soft-delete an item |
| `POST` | `/api/collections/:id/items/:itemId/restore` | Restore a soft-deleted item |
| `GET` | `/api/trash` | List what soft delete has hidden: `{ collections, items }` |
| `DELETE` | `/api/trash` | Empty the trash — permanently delete everything in it; returns `{ items, collections }` counts |
| `DELETE` | `/api/trash/items/:itemId` | Permanently delete a trashed item |
| `DELETE` | `/api/trash/collections/:id` | Permanently delete a trashed collection and its items |
| `GET` | `/api/export` | Download a JSON backup of all collections and items |
| `POST` | `/api/import` | Restore a backup document (`?mode=skip`) |

In dev mode, OpenAPI docs are available at `GET /api/docs`.

### Editing a field schema

`PATCH /api/collections/:id` accepts `fields`, replacing the whole array — send the
schema you want, not a delta. Item values are stored in a JSON object keyed by field
id and are never coerced against the collection's definitions, which decides what each
edit costs:

| Edit | Effect on existing items |
| --- | --- |
| Add a field | None. Items have no value for it and render blank. `required` starts applying the next time an item is edited; nothing is backfilled. |
| Relabel, change help text, edit `select` options, `rating` max, or `currencyCode` | None. |
| Reorder | None — display order only. |
| Remove a field | Values stored under that id are **kept**, unrendered. They survive in `GET /api/export`. |
| Change a field's type | Rejected with `400` while the collection holds any items. |

Retyping is the one edit that would strand data — a text value under a field that
became `number` is unreadable by the new control — so it is allowed only while the
collection is empty. That count includes trashed items, because restoring one would
bring back values the new schema cannot read.

Removal keeps values rather than purging them, so a schema edit is never a mass delete.
The kept values are reachable through a JSON export, not through the UI: re-adding a
field mints a new id, so it does not re-attach to the old values.

The route reads the collection before it writes, so a rejected patch leaves nothing
behind — a `400` or `404` never persists the rest of the body.

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
  individually *and* whose collection was later deleted is removed once, not counted twice.

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

| Env var | Default | Description |
|---|---|---|
| `DB_PATH` | `apps/api/data/app.db` | SQLite database file path. The default is anchored to the app directory (not the current working directory), so it's the same file no matter where you launch from. The resolved path is printed on startup. |
| `PORT` | `3001` | HTTP port. Must be an integer 0–65535; `0` asks the OS for a free port. |
| `HOST` | `127.0.0.1` | Bind address. Anything other than loopback publishes the API to the network and is refused unless `API_TOKEN` is set explicitly and is at least 32 characters. |
| `API_TOKEN` | random UUID (development only) | Bearer token, regenerated on every start and printed to stdout **in development only**. **Required outside development**: the generated fallback is never printed there, so it would be known to nobody and every authenticated request would 401 — the server refuses to start rather than bind something unusable. |
| `NODE_ENV` | — | Set to `production` to disable Swagger UI and harden CSP |

An empty value counts as unset, not as a value: `HOST=""` used to reach `app.listen()` verbatim and bind *every* interface. Invalid configuration prints a one-line reason and exits non-zero rather than starting.

## Network exposure

The server is meant to be reachable only from the machine it runs on, and three checks keep it that way (#242):

- **Bind guard** — a non-loopback `HOST` refuses to start without a deliberate, long `API_TOKEN`. A token generated at startup would be printed to a console nobody is watching.
- **Host pinning** — requests whose `Host` header is not loopback are refused with `403`, which is what a DNS-rebinding page (an attacker domain resolving to `127.0.0.1`) presents; such a request is same-origin to the browser, so CORS never sees it. Reads the raw `Host` header, not `request.hostname`, which is derived from the client-supplied `X-Forwarded-Host` when `trustProxy` is on. Binding non-loopback deliberately turns this off — there is no way to know which name a LAN client will use — and logs a warning at startup.
- **CORS** — an exact-origin allowlist in development (`http://localhost:5173` / `:4173` and their `127.0.0.1` equivalents), disabled entirely in production. The previous `/^http:\/\/localhost(:\d+)?$/` trusted every port on localhost; any local process can bind a high port, and with `credentials: true` that becomes a CSRF hole the moment a cookie session replaces the bearer header. `apps/web/vite.config.ts` sets `strictPort` so the dev server cannot drift off the allowlist.

### Refusing to start vs. warning

`resolveServerConfig()` **throws** for configuration that cannot work — an invalid `PORT`, a non-loopback `HOST` without a strong explicit token, or a missing `API_TOKEN` outside development. The entrypoint prints `Configuration error: <reason>` and exits non-zero without binding, so a broken configuration is never a server that looks healthy and answers 401 to everything (#241).

`startupWarnings()` covers the other case: configuration that is legal but likely to surprise, printed once after the server binds. Today that is a non-loopback bind, which is network-reachable and has Host pinning off. Warnings never include the token, since these lines go to stdout and to whatever collects it.
