# @mycollections/core

Domain types, Zod schemas, and plugin host contracts shared by every workspace in the monorepo.

This is a private, pure-TypeScript package — no runtime concerns beyond [Zod](https://zod.dev) for validation. Other packages depend on it for type definitions and for boundary validation of data that crosses trust boundaries (HTTP request bodies, plugin output, persisted JSON).

## What's exported

### Domain models

| Export                                              | Purpose                                                                                                                    |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `CollectionSchema` / `Collection`                   | A user-defined collection (records, LEGO sets, audio gear, …) and its field schema                                         |
| `TARGET_COUNT_MAX`                                  | The largest `targetCount` a finite set may declare (`100_000`)                                                             |
| `ItemSchema` / `Item`                               | A single item inside a collection                                                                                          |
| `MediaSchema` / `Media`                             | Media (currently images) attached to an item                                                                               |
| `ItemStatusSchema` / `ItemStatus` / `ITEM_STATUSES` | `"owned" \| "wanted" \| "ordered"`                                                                                         |
| `FieldDefinitionSchema` / `FieldDefinition`         | Per-collection user-defined field schema                                                                                   |
| `BUILT_IN_FIELD_TYPES` / `BuiltInFieldType`         | The 12 built-in field types: `text, number, boolean, date, url, email, select, multiselect, rating, currency, image, tags` |

### Finite sets and their target (#42)

A collection with `isFiniteSet: true` is a set with a known end — the 50 state quarters, a LEGO wave. `targetCount` is how many items complete it: an integer from 1 to `TARGET_COUNT_MAX`, or `null` when the size is not known yet. It defaults to `null`, so documents written before the field existed (version 1 backups among them) still parse. Only a finite set may carry a target: `targetCount` set on a collection with `isFiniteSet: false` fails validation with the fixed message `targetCount requires isFiniteSet` at the `targetCount` path. The schema never coerces — `"5"`, `true` and `2.5` are all rejected.

### Provider contracts

| Export                                                    | Purpose                                                                                                                                                  |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AuthProvider` / `Session` / `AuthUser` / `SignInOptions` | Pluggable auth backend ([`@mycollections/auth`](../auth/) implements this). Tokens never appear on this surface — they are vended via `getAccessToken()` |
| `FeatureFlagProvider`                                     | Feature-flag lookup                                                                                                                                      |
| `ErrorReporter`                                           | Error-capture sink                                                                                                                                       |

### Plugin API

| Export               | Purpose                                                        |
| -------------------- | -------------------------------------------------------------- |
| `PLUGIN_API_VERSION` | Semver string for the plugin host contract (currently `1.0.0`) |

## Deferred surface

To keep the initial PR focused on what phase-1 consumers actually need, several types listed in [issue #18](https://github.com/solve4it/mycollections/issues/18) are intentionally not yet exported. They will be added when the consuming work lands:

| Deferred                                         | Phase               | Tracking issue | Consumers     |
| ------------------------------------------------ | ------------------- | -------------- | ------------- |
| `StorageProvider`                                | 4 (cloud sync)      | #154           | #51, #50, #65 |
| `LookupProvider` / `LookupResult` / `ScanResult` | 2 (lookup pipeline) | #155           | #40, #39      |
| `ShareLink`                                      | 3 (sharing)         | #156           | #48           |
| `PluginData` / `License`                         | 5 (plugin system)   | #157           | #54, #57      |
| `Mutation` / `SyncState`                         | 4 (sync)            | #158           | #49           |
| `UserProfile`                                    | —                   | #159           | —             |

## Testing

Schemas are unit-tested with Vitest. Run from the repo root:

```bash
pnpm --filter @mycollections/core test
```

Tests live alongside source as `*.test.ts` and validate both happy paths and rejection cases for every schema.
