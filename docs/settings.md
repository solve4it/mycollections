---
title: Settings
description: Configuring MyCollections — app-level preferences, per-collection settings, sync, and plugins.
---

# Settings

> **Placeholder.** This page will be filled in as settings surfaces land in the app.

## App settings

_Global preferences — theme, language, shortcuts, accessibility options._

## Data backup & restore

The **Data** section of Settings lets you back up and move your data:

- **Export** downloads every collection and item as a single JSON file
  (`mycollections-export-<date>.json`). The file is human-readable and includes a
  schema `version` so future versions can read older backups.
- **Import** restores from a backup file. Importing is additive and safe:
  collections and items already present are kept untouched and only new ones are
  added, so re-importing the same file does nothing. An invalid file is rejected
  with a clear error and never partially corrupts your data. From the moment you
  choose a file until the restore finishes, the app says it is importing and the
  file picker is disabled, so a large backup never looks like nothing is
  happening and a second file cannot be started on top of the first. Keyboard
  focus returns to the picker when the restore settles.

## Privacy

The **Privacy** section controls error reporting:

- **Record error reports** — when enabled (the default), unexpected errors are
  recorded so crashes can be diagnosed. Reports contain only technical details
  (error type, message, and where it happened) — never your collection data —
  and are only logged locally in your browser; nothing leaves your device.
  Uncheck the toggle to opt out entirely; the choice is remembered.

## Per-collection settings

_Settings that apply to a single collection — display mode, default fields, plugin-specific options._

## Sync settings

_Enabling and managing optional cloud sync._

## Plugins

_Installing, enabling, disabling, and updating plugins._

## Related

- [Collections](./collections.md)
- [Getting Started](./getting-started.md)
