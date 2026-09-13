import { createContext, type ReactNode, useContext, useEffect } from "react";

/**
 * What a screen has published about its own name (#309).
 *
 * A union rather than `string | null | undefined`, because the difference
 * between "no name yet" and "no name, ever" is the difference between holding
 * the route-change announcement and making it. Two nullish values would swap
 * places at a call site without the type ever objecting, and the symptom — a
 * page announced by its generic title, or never announced at all — is one a
 * screen reader user hears and a sighted reviewer does not.
 */
export type PageName = { status: "pending" } | { status: "named"; name: string } | { status: "unnamed" };

export function isSamePageName(a: PageName, b: PageName): boolean {
  if (a.status === "named" && b.status === "named") return a.name === b.name;
  return a.status === b.status;
}

/**
 * How a screen hands its name up to the shell, which owns the document title
 * and the announcement. Defaults to a no-op so a screen rendered outside the
 * shell — every route-level test that mounts a page on its own — still works.
 */
const PublishPageName = createContext<(name: PageName) => void>(() => {});

export function PageNameProvider({ publish, children }: { publish: (name: PageName) => void; children: ReactNode }) {
  return <PublishPageName value={publish}>{children}</PublishPageName>;
}

/**
 * Publish this screen's own name, for the shell to title and announce the page
 * with (#309). The route's `staticData.titleKey` is the fallback: what the page
 * is called until a name arrives, and if none ever does.
 *
 * A route that calls this must also declare `staticData: { dynamicTitle: true }`
 * — that flag is read from the router synchronously, whereas this publish can
 * only reach the shell from an effect, a commit later. Without it the shell has
 * no way to tell "this page has a name coming" from "this page has nothing to
 * say", and the announcement is the difference.
 *
 * `name` is rebuilt on every render; the shell's publisher compares by value
 * and keeps the state it has when nothing changed, so an unchanged name costs a
 * function call and no render.
 */
export function usePageTitle(name: PageName): void {
  const publish = useContext(PublishPageName);
  useEffect(() => {
    publish(name);
  }, [publish, name]);
}
