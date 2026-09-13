import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppErrorScreen } from "./ErrorScreen.js";

/**
 * The last-resort screen (#319), which the root route's boundary and the
 * top-level `<ErrorBoundary>` both fall back to.
 *
 * `RouteError` — the in-shell half — is exercised through the real router in
 * `src/router.test.tsx` instead: what it has to get right is the shell around
 * it, and mounting it bare would assert none of that.
 */

afterEach(cleanup);

describe("AppErrorScreen", () => {
  beforeEach(() => {
    document.title = "Collections · MyCollections";
  });

  it("says what happened without saying what threw", () => {
    render(<AppErrorScreen />);

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Something went wrong");
    expect(alert).toHaveTextContent("Your data is safe.");
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
  });

  /**
   * This screen replaces the shell, so it has to bring the structure the shell
   * normally provides: without a `<main>` there is no landmark for the content
   * to sit in, which is two axe failures (`region`, `landmark-one-main`) and,
   * more to the point, a screen a landmark-navigating user cannot reach.
   */
  it("brings the main landmark the shell would have provided", () => {
    render(<AppErrorScreen />);

    const main = screen.getByRole("main");
    expect(main).toHaveAttribute("id", "main-content");
    expect(main).toContainElement(screen.getByRole("alert"));
  });

  /** The shell owns document.title, and the shell is what failed. */
  it("titles the document itself", () => {
    render(<AppErrorScreen />);

    expect(document.title).toBe("Something went wrong · MyCollections");
  });

  /**
   * Nothing here can promise that routing still works — this screen is what
   * renders when the router's own root component threw — so the only control is
   * the one that does not depend on it.
   */
  it("offers no in-app navigation", () => {
    render(<AppErrorScreen />);

    expect(screen.queryAllByRole("link")).toEqual([]);
  });

  /**
   * A crash destroys whatever was focused, focus falls to <body>, and the tab
   * order restarts at the top of the document (WCAG 2.4.3). The container is what
   * takes it, not the heading: the container carries role="alert" — which is what
   * actually announces (#347) — and focusing inside it makes VoiceOver read the
   * title twice.
   */
  it("takes focus when the crash orphaned it", () => {
    render(<AppErrorScreen />);

    expect(document.activeElement).toBe(screen.getByRole("alert"));
  });

  it("leaves focus alone when something still holds it", () => {
    const survivor = document.createElement("button");
    document.body.append(survivor);
    survivor.focus();

    render(<AppErrorScreen />);

    expect(document.activeElement).toBe(survivor);
    survivor.remove();
  });
});
