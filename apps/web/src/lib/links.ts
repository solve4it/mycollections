import type { LinkProps } from "@tanstack/react-router";

/**
 * What `activeOptions` a link inside a screen's own content should take (#354).
 *
 * `Link` decides it is active by *prefix* match, and an active link carries a
 * hardcoded `aria-current="page"` and `data-status="active"`
 * (`link.js`, `STATIC_ACTIVE_PROPS` — spread after the caller's props, so no
 * prop can take them back off; `activeOptions` is the only lever there is).
 *
 * Prefix matching is right for the nav, which describes where the user *is*:
 * `/collections/<id>` is a page inside the Collections section, and marking the
 * section is the ordinary reading of `aria-current="page"`. It is wrong for
 * every back link and every way out of a failure, because those point at an
 * ancestor of the current URL by nature — so they match that prefix always, and
 * announced "current page" about the one link the user was about to follow
 * *away*. The detail screen's "All collections", the editor's two back links,
 * and the recovery links on the 404 and the crash screen were all doing it.
 *
 * `exact` rather than a hard suppression because it is the specification's own
 * reading — `aria-current="page"` marks "the current page within a set of
 * pages", and a link is that only when it points at the page you are on. For
 * these links that is never true, with the single arguable exception of the
 * crash screen's way out when the crashed route *is* `/collections`, where the
 * link really does point at the current page.
 */
export const CONTENT_LINK_ACTIVE_OPTIONS: LinkProps["activeOptions"] = { exact: true };
