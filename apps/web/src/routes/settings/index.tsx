import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "../__root.js";

export const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: SettingsPage,
});

function SettingsPage() {
  return (
    <div>
      <h1>Settings</h1>
      <p>Settings will appear here.</p>
    </div>
  );
}
