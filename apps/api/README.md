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
| `PATCH` | `/api/collections/:id` | Update a collection |
| `DELETE` | `/api/collections/:id` | Soft-delete a collection |
| `POST` | `/api/collections/:id/restore` | Restore a soft-deleted collection |
| `GET` | `/api/collections/:id/items` | List items (`?status=owned\|wanted\|ordered`) |
| `POST` | `/api/collections/:id/items` | Create an item |
| `GET` | `/api/collections/:id/items/:itemId` | Get an item |
| `PATCH` | `/api/collections/:id/items/:itemId` | Update an item |
| `DELETE` | `/api/collections/:id/items/:itemId` | Soft-delete an item |
| `GET` | `/api/export` | Download a JSON backup of all collections and items |
| `POST` | `/api/import` | Restore a backup document (`?mode=skip`) |

In dev mode, OpenAPI docs are available at `GET /api/docs`.

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
| `API_TOKEN` | random UUID | Bearer token, regenerated on every start and printed to stdout **in development only**. Outside development a generated token is known to nobody, so the server warns at startup that every authenticated request will 401 until you set this. |
| `NODE_ENV` | — | Set to `production` to disable Swagger UI and harden CSP |

An empty value counts as unset, not as a value: `HOST=""` used to reach `app.listen()` verbatim and bind *every* interface. Invalid configuration prints a one-line reason and exits non-zero rather than starting.

## Network exposure

The server is meant to be reachable only from the machine it runs on, and three checks keep it that way (#242):

- **Bind guard** — a non-loopback `HOST` refuses to start without a deliberate, long `API_TOKEN`. A token generated at startup would be printed to a console nobody is watching.
- **Host pinning** — requests whose `Host` header is not loopback are refused with `403`, which is what a DNS-rebinding page (an attacker domain resolving to `127.0.0.1`) presents; such a request is same-origin to the browser, so CORS never sees it. Reads the raw `Host` header, not `request.hostname`, which is derived from the client-supplied `X-Forwarded-Host` when `trustProxy` is on. Binding non-loopback deliberately turns this off — there is no way to know which name a LAN client will use — and logs a warning at startup.
- **CORS** — an exact-origin allowlist in development (`http://localhost:5173` / `:4173` and their `127.0.0.1` equivalents), disabled entirely in production. The previous `/^http:\/\/localhost(:\d+)?$/` trusted every port on localhost; any local process can bind a high port, and with `credentials: true` that becomes a CSRF hole the moment a cookie session replaces the bearer header. `apps/web/vite.config.ts` sets `strictPort` so the dev server cannot drift off the allowlist.

### Startup warnings

`startupWarnings()` in `config.ts` reports conditions that are legal but likely to surprise, printed once after the server binds. It never includes the token itself, since these lines go to stdout and to whatever collects it. Today it covers a non-loopback bind (Host pinning off, network-reachable) and a production start with no `API_TOKEN` (the generated token is never printed, so the server looks healthy and 401s everything).
