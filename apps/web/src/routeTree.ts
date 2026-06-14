import { rootRoute } from "./routes/__root.js";
import { collectionsRoute } from "./routes/collections/index.js";
import { newCollectionRoute } from "./routes/collections/new.js";
import { indexRoute } from "./routes/index.js";
import { settingsRoute } from "./routes/settings/index.js";
import { setupRoute } from "./routes/setup/index.js";

export const routeTree = rootRoute.addChildren([
  indexRoute,
  setupRoute,
  newCollectionRoute,
  collectionsRoute,
  settingsRoute,
]);
