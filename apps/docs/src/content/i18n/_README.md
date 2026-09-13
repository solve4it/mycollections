# UI string overrides

`en.json` is deliberately empty, and deliberately present.

Starlight looks for an `i18n` collection to load its UI-string overrides from and
warns on every build when it is missing — one of the two permanent warnings this
package cleared in #339. Declaring the collection in `src/content.config.ts` is
not enough on its own: the loader then warns that the directory does not exist,
and with the directory but no entry, that it found no files matching
`**/[^_]*.{json,yml,yaml}`. So the collection needs at least one entry, and an
empty object is the honest one — the site is English-only and overrides nothing.

Deleting `en.json` therefore fails the build rather than changing nothing, which
is the intended behavior: `apps/docs/scripts/build.mjs` treats any `[WARN]` from
`astro build` as a failure.

To override a Starlight UI string, put it in `en.json` — the keys are listed in
Starlight's [translations reference](https://starlight.astro.build/guides/i18n/#translate-starlights-ui).

This file is ignored by the loader: its glob skips names beginning with `_`, and
it only reads `.json`, `.yml` and `.yaml` in any case.
