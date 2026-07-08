# Bundled fonts

Self-hosted variable fonts (latin subsets, woff2) — no CDN requests, so the app works fully
offline and no user data leaks to font hosts.

| File | Family | Weights | Role token |
| --- | --- | --- | --- |
| `bricolage-grotesque-latin.woff2` | [Bricolage Grotesque](https://fonts.google.com/specimen/Bricolage+Grotesque) | 200–800 (variable) | `--font-display` |
| `instrument-sans-latin.woff2` | [Instrument Sans](https://fonts.google.com/specimen/Instrument+Sans) | 400–700 (variable) | `--font-body` |
| `spline-sans-mono-latin.woff2` | [Spline Sans Mono](https://fonts.google.com/specimen/Spline+Sans+Mono) | 400–700 (variable) | `--font-mono` |

All three are licensed under the [SIL Open Font License 1.1](https://openfontlicense.org/),
which permits bundling and redistribution with attribution. These files are the **latin**
subsets only; adding locales beyond Latin script (see `src/locales/`) requires shipping the
matching subsets and extending the `@font-face` declarations in `global.css` with
`unicode-range`.
