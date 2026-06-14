import { createRootRoute, Outlet } from "@tanstack/react-router";
import { Shell } from "../components/Shell.js";
// CSS is imported in main.tsx so Vite handles it; not here to keep __root testable without Vite.

export const rootRoute = createRootRoute({
  component: () => (
    <Shell>
      <Outlet />
    </Shell>
  ),
});
