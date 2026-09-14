import { rootRoute } from "./routes/__root.js";
import { collectionDetailRoute } from "./routes/collections/$id.js";
import { editCollectionRoute } from "./routes/collections/edit.js";
import { collectionsRoute } from "./routes/collections/index.js";
import { newCollectionRoute } from "./routes/collections/new.js";
import { indexRoute } from "./routes/index.js";
import { notFoundRoute } from "./routes/not-found.js";
import { settingsRoute } from "./routes/settings/index.js";
import { setupRoute } from "./routes/setup/index.js";

export const routeTree = rootRoute.addChildren([
  indexRoute,
  setupRoute,
  newCollectionRoute,
  editCollectionRoute,
  collectionDetailRoute,
  collectionsRoute,
  settingsRoute,
  // Last, and last on purpose: `path: "$"` catches whatever the routes above do
  // not claim (#344). Its position here is presentation only — TanStack ranks a
  // wildcard below every static and dynamic path regardless — but reading the
  // tree top to bottom should match the order a URL is actually offered around.
  notFoundRoute,
]);
