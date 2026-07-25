# @mycollections/core

Domain types, Zod schemas, and plugin host contracts shared by every workspace in the monorepo.

This is a private, pure-TypeScript package — no runtime concerns beyond [Zod](https://zod.dev) for validation. Other packages depend on it for type definitions and for boundary validation of data that crosses trust boundaries (HTTP request bodies, plugin output, persisted JSON).

## What's exported

### Domain models

| Export | Purpose |
|---|---|
| `CollectionSchema` / `Collection` | A user-defined collection (records, LEGO sets, audio gear, …) and its field schema |
| `ItemSchema` / `Item` | A single item inside a collection |
| `MediaSchema` / `Media` | Media (currently images) attached to an item |
| `ItemStatusSchema` / `ItemStatus` / `ITEM_STATUSES` | `"owned" \| "wanted" \| "ordered"` |
| `FieldDefinitionSchema` / `FieldDefinition` | Per-collection user-defined field schema |
| `BUILT_IN_FIELD_TYPES` / `BuiltInFieldType` | The 12 built-in field types: `text, number, boolean, date, url, email, select, multiselect, rating, currency, image, tags` |

### Provider contracts

| Export | Purpose |
|---|---|
| `AuthProvider` / `Session` / `AuthUser` / `SignInOptions` | Pluggable auth backend ([`@mycollections/auth`](../auth/) implements this). Tokens never appear on this surface — they are vended via `getAccessToken()` |
| `FeatureFlagProvider` | Feature-flag lookup (`createStaticFeatureFlagProvider` implements it — see below) |
| `ErrorReporter` | Error-capture sink |

### Feature flags

| Export | Purpose |
|---|---|
| `FeatureFlagsSchema` / `FeatureFlags` | A flat `flag name → boolean` map; the shape of `apps/web/src/config/flags.json` |
| `parseFeatureFlags` | Validates untrusted flag config at the boundary. **Throws** on malformed input — a silent `{}` reads as "every feature off", which is indistinguishable from a working config |
| `createStaticFeatureFlagProvider` | A `FeatureFlagProvider` over a fixed flag map |

`createStaticFeatureFlagProvider` is deliberately strict:

- **Unknown flags are disabled.** A typo'd flag name must never turn a gated feature on.
- **Only `true` counts.** The flag map is copied into a null-prototype object, so `isEnabled("constructor")` and friends return `false` instead of a truthy `Object.prototype` member.
- **The caller's object is snapshotted, not frozen.** Mutating it afterwards can't change the answers, and the caller's own object stays writable.

Flags are a **UI gate, never an authorization boundary** — gated code still ships in the bundle, so anything with a security consequence is enforced in the API independently. See [`apps/web/README.md`](../../apps/web/README.md#feature-flags) for how the web app consumes this.

### Plugin API

| Export | Purpose |
|---|---|
| `PLUGIN_API_VERSION` | Semver string for the plugin host contract (currently `1.0.0`) |

## Deferred surface

To keep the initial PR focused on what phase-1 consumers actually need, several types listed in [issue #18](https://github.com/solve4it/mycollections/issues/18) are intentionally not yet exported. They will be added when the consuming work lands:

| Deferred | Phase | Tracking issue | Consumers |
|---|---|---|---|
| `StorageProvider` | 4 (cloud sync) | #154 | #51, #50, #65 |
| `LookupProvider` / `LookupResult` / `ScanResult` | 2 (lookup pipeline) | #155 | #40, #39 |
| `ShareLink` | 3 (sharing) | #156 | #48 |
| `PluginData` / `License` | 5 (plugin system) | #157 | #54, #57 |
| `Mutation` / `SyncState` | 4 (sync) | #158 | #49 |
| `UserProfile` | — | #159 | — |

## Testing

Schemas are unit-tested with Vitest. Run from the repo root:

```bash
pnpm --filter @mycollections/core test
```

Tests live alongside source as `*.test.ts` and validate both happy paths and rejection cases for every schema.
