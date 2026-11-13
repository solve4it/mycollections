import { rootRoute } from "./routes/__root.js";
import { authenticatedRoute } from "./routes/_authenticated.js";
import { collectionDetailRoute } from "./routes/collections/$id.js";
import { editCollectionRoute } from "./routes/collections/edit.js";
import { collectionsRoute } from "./routes/collections/index.js";
import { itemDetailRoute } from "./routes/collections/item.js";
import { newCollectionRoute } from "./routes/collections/new.js";
import { indexRoute } from "./routes/index.js";
import { notFoundRoute } from "./routes/not-found.js";
import { settingsRoute } from "./routes/settings/index.js";
import { setupRoute } from "./routes/setup/index.js";

export const routeTree = rootRoute.addChildren([
  indexRoute,
  // The two screens that must work without a token: where a visitor without one
  // is sent, and (below) the 404, which has to render for any address at all.
  setupRoute,
  // Everything else needs the token, and is guarded by being here (#420) — not
  // by a `beforeLoad` of its own. `routeTree.test.ts` pins what is outside.
  authenticatedRoute.addChildren([
    newCollectionRoute,
    editCollectionRoute,
    collectionDetailRoute,
    itemDetailRoute,
    collectionsRoute,
    settingsRoute,
  ]),
  // Last, and last on purpose: `path: "$"` catches whatever the routes above do
  // not claim (#344). Its position here is presentation only — TanStack ranks a
  // wildcard below every static and dynamic path regardless — but reading the
  // tree top to bottom should match the order a URL is actually offered around.
  notFoundRoute,
]);
