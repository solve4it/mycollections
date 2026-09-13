import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppErrorScreen, FailureSurface } from "./ErrorScreen.js";

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

/**
 * The surface itself (#349), which all five failure screens now share: the two
 * crash screens above and the three route-level load failures that used to
 * hand-roll this markup. Mounted bare here because these two cases are about
 * the surface's own contract rather than any one screen's copy.
 */
describe("FailureSurface", () => {
  /**
   * The deliberate behavior change in #349. Taking focus is right for a crash,
   * which orphans it synchronously — and wrong for a load failure, which arrives
   * seconds after the navigation once React Query's retries are exhausted;
   * moving focus that long after a user action is a hazard, not a help. The
   * `role="alert"` is what announces these, so nothing is lost by staying put.
   *
   * Nothing else pins this: every existing focus assertion is on a screen that
   * *does* claim focus, so the default would be unprotected the moment it lands.
   */
  it("leaves focus alone unless the screen claims it", () => {
    render(<FailureSurface title="Could not load collections" description="Your collections are safe." />);

    expect(document.activeElement).toBe(document.body);
  });

  /**
   * The actions row is a flex container with a name in the a11y tree's way; a
   * screen with nothing to offer should not ship an empty one. The crash screens
   * that do have controls still get it — asserted above by finding the Reload
   * button inside the surface.
   */
  it("renders no actions row when the screen offers no actions", () => {
    const { container } = render(
      <FailureSurface title="Could not load collections" description="Your collections are safe." />,
    );

    expect(container.querySelector(".failure-actions")).toBeNull();
  });

  /**
   * The title stays an `<h1>`: `page-has-heading-one` is in the e2e structural
   * rule set and is scanned against the detail screen's load failure, so a
   * demoted heading fails the sweep rather than a unit test.
   */
  it("names the failure in the page's only h1", () => {
    render(<FailureSurface title="Could not load collections" description="Your collections are safe." />);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Could not load collections");
  });
});
