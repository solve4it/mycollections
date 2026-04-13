# MyCollections

> Your collections, your way — local-first personal collection management with an extensible plugin architecture.

MyCollections helps you catalog, organize, and explore the things you collect — whether that's vinyl records, LEGO sets, audio gear, trading cards, or anything else. Start with a small, fast, offline-capable core and extend it with purpose-built plugins for each kind of collection you care about.

## Features

- **Plugin architecture** — Each collection type is a self-contained plugin (e.g. LEGO, audio gear). Install only what you need; build your own for anything that isn't covered.
- **Local-first** — Your data lives on your machine. Works fully offline; no account or cloud required to get started.
- **Optional cloud sync** — Opt in to encrypted sync across devices when you want it.
- **Barcode & identifier scanning** — Add items by scanning barcodes, matrix codes, or images instead of typing everything.
- **External lookups** — Enrich your catalog by pulling metadata from plugin-specific sources (catalogs, marketplaces, databases).
- **Accessible by default** — Built with Biome's a11y rules enforced, keyboard-first navigation, and screen-reader-friendly components.

## Tech Stack

- **Runtime**: Node.js 24 LTS
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
- **Full docs site**: _coming soon_ (tracked in [#12](https://github.com/solve4it/mycollections/issues/12))

## Contributing

Contributions are welcome. Please read [`CONTRIBUTING.md`](./CONTRIBUTING.md) before opening a PR — every change must be tied to a GitHub issue and follow the project's conventional-commit / TDD / docs-in-PR workflow.

## License

Licensed under the [Apache License, Version 2.0](./LICENSE).

Copyright © Solve4It. MyCollections is built and maintained by [Solve4It](https://solve4it.com).
