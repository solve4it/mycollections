# MyCollections

> Your collections, your way — local-first personal collection management with an extensible plugin architecture.

MyCollections helps you catalog, organize, and explore the things you collect — whether that's vinyl records, LEGO sets, audio gear, trading cards, or anything else. Start with a small, fast, offline-capable core and extend it with purpose-built plugins for each kind of collection you care about.

## Features

- **Plugin architecture** — Each collection type is a self-contained plugin (e.g. LEGO, audio gear). Install only what you need; build your own for anything that isn't covered.
- **Local-first** — Your data lives on your machine. Works fully offline; no account or cloud required to get started.
- **Search, filter & sort** — Find items by any word in their text, choices, tags or numbers (accents and case ignored), narrow a collection by its choices, tags (any or all), number and date ranges and yes/no fields, and order it by date, name, status (collected first or remaining first) or any field. The view lives in the address, so it can be bookmarked. Rename, merge or remove a tag across a whole collection from its editor.
- **List or grid** — Show a collection as compact rows or as a grid of cards led by each item's cover, with its name and a few key fields — the field you sort by first. The choice belongs to the collection, so it is the same on every device and is kept in backups.
- **Photos** — Every item has its own page with its photos: add several at once, or take one with the camera on a phone. Thumbnails are made for you, the first photo is the item's cover and shows on its row, a photo opens full size to step through the rest, and location and other metadata are stripped from every photo before it is stored. Photos are included in exports and backups.
- **Backup & restore** — Export everything, or one collection from its own page, to a single `.zip` file holding your data as readable JSON plus your photos, and import it back to recover or move your data between machines. A large import runs in the background with its progress on screen, and can optionally add a backup's photos to items you already have. Older `.json` backups still import.
- **Optional cloud sync** — Opt in to encrypted sync across devices when you want it.
- **Barcode & identifier scanning** — Add items by scanning barcodes, matrix codes, or images instead of typing everything.
- **External lookups** — Enrich your catalog by pulling metadata from plugin-specific sources (catalogs, marketplaces, databases).
- **Accessible by default** — Built with Biome's a11y rules enforced, keyboard-first navigation, and screen-reader-friendly components.

## Your data

Everything you put into MyCollections can be taken out, in full, in formats other software can read:

- **What an export holds:** every collection with its fields, finite-set target and list or grid view; every item with its status and values; every photo; and what is in the trash, so a restore keeps your deletion history. The data is a versioned JSON file, `export.json` (its schema is in [`packages/core/src/export-document.ts`](packages/core/src/export-document.ts)), and the photos are standard WebP image files, all in one `.zip`.
- **What it does not hold:** settings kept only in your browser (language, theme, error reporting) and the API token.
- **Where to get one:** Settings → Export data for everything, **Export collection** on a collection's page for just that one, or `GET /api/export` and `GET /api/collections/:id/export` directly ([API reference](apps/api/README.md#backup-format)).

This is the data-portability mechanism. Legal statements about it belong to the privacy policy (#67) and the GDPR audit (#68), not here.

## Tech Stack

- **Runtime**: Node.js 26 (pinned in `.nvmrc`)
- **Package manager**: pnpm workspaces (monorepo via Turborepo)
- **Language**: TypeScript
- **Linting & formatting**: [Biome](https://biomejs.dev/)
- **Testing**: [Vitest](https://vitest.dev/) (TDD)
- **Docs**: Astro Starlight (gh-pages)
- **CI/CD**: GitHub Actions, Release Please, Renovate, Socket.dev

## Getting Started

See [`DEVELOPMENT.md`](./DEVELOPMENT.md) for prerequisites, clone/install steps, DevContainer usage, and how to run the app locally.

Quick start:

```bash
git clone https://github.com/solve4it/mycollections.git
cd mycollections
pnpm install
pnpm dev
```

## Documentation

- **Development setup**: [`DEVELOPMENT.md`](./DEVELOPMENT.md)
- **Contributing guide**: [`CONTRIBUTING.md`](./CONTRIBUTING.md)
- **Code of Conduct**: [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md)
- **Security policy**: [`SECURITY.md`](./SECURITY.md)
- **Full docs site**: [solve4it.github.io/mycollections](https://solve4it.github.io/mycollections/)

## Contributing

Contributions are welcome. Please read [`CONTRIBUTING.md`](./CONTRIBUTING.md) before opening a PR — every change must be tied to a GitHub issue and follow the project's conventional-commit / TDD / docs-in-PR workflow.

## License

Licensed under the [Apache License, Version 2.0](./LICENSE).

Copyright © Solve4It. MyCollections is built and maintained by [Solve4It](https://solve4it.com).
