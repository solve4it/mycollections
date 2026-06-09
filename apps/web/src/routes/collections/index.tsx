import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "../__root.js";

export const collectionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/collections",
  component: CollectionsPage,
});

function CollectionsPage() {
  return (
    <div>
      <h1>Collections</h1>
      <p>Your collections will appear here.</p>
    </div>
  );
}
