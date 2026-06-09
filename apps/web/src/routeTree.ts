import { rootRoute } from "./routes/__root.js";
import { collectionsRoute } from "./routes/collections/index.js";
import { indexRoute } from "./routes/index.js";
import { settingsRoute } from "./routes/settings/index.js";

export const routeTree = rootRoute.addChildren([indexRoute, collectionsRoute, settingsRoute]);
