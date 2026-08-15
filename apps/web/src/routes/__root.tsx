import { createRootRoute, Outlet, useRouterState } from "@tanstack/react-router";
import { Shell } from "../components/Shell.js";

// CSS is imported in main.tsx so Vite handles it; not here to keep __root testable without Vite.

/**
 * The shell, with the screen inside it (#225). The wrapper is keyed by pathname
 * so it remounts on navigation and the 150ms entrance in `.screen` replays — a
 * CSS animation does not restart by itself when its element's children change.
 * Keying here rather than around <Shell> keeps the nav out of the animation:
 * the cabinet is furniture and does not move when a drawer is opened.
 */
function Root() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  return (
    <Shell>
      <div className="screen" key={pathname}>
        <Outlet />
      </div>
    </Shell>
  );
}

export const rootRoute = createRootRoute({ component: Root });
