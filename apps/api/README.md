# @mycollections/api

Local Fastify API server for MyCollections. Runs on `localhost` only and is intended to be embedded in the Tauri desktop wrapper (#63).

## Security

- **Bearer token auth**: Every request (except `GET /api/health`) requires `Authorization: Bearer <token>`. The token is a random UUID generated at startup (or set via `API_TOKEN` env var).
- **OWASP headers**: `@fastify/helmet` applies `X-Content-Type-Options`, `Strict-Transport-Security`, `X-Frame-Options`, `X-XSS-Protection`, and a strict `Content-Security-Policy` in production.
- **CORS**: Restricted to `http://localhost:<port>` in dev mode; disabled in production (same-origin only).
- **Localhost binding**: The server binds to `127.0.0.1` by default — never exposed to the network.

## Routes

All routes require `Authorization: Bearer <token>`.

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/health` | Health check (no auth required) |
| `GET` | `/api/collections` | List all collections |
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

In dev mode, OpenAPI docs are available at `GET /api/docs`.

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
| `PORT` | `3001` | HTTP port |
| `HOST` | `127.0.0.1` | Bind address (do not change to `0.0.0.0`) |
| `API_TOKEN` | random UUID | Bearer token (logged to stdout in dev) |
| `NODE_ENV` | — | Set to `production` to disable Swagger UI and harden CSP |
