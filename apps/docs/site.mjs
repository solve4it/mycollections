/**
 * Settings shared by the Astro config and the build scripts around it.
 *
 * The site is published to a project page, so every in-site URL carries the
 * `/mycollections` prefix. The link rewrite in `scripts/rehype-relative-doc-links.mjs`
 * and the guard in `scripts/check-built-links.mjs` both need the same value as
 * `astro.config.mjs`, and a second copy of it would only ever drift.
 */
export const SITE = "https://solve4it.github.io";
export const BASE = "/mycollections";
