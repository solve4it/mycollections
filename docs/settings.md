---
title: Settings
description: Configuring MyCollections — app-level preferences, per-collection settings, sync, and plugins.
---

# Settings

> **Placeholder.** This page will be filled in as settings surfaces land in the app.

## App settings

**Theme** chooses between **Match system**, **Light** and **Dark**. Match system is
the default: the app follows your operating system's appearance setting and
switches the moment you change it there — no reload, no restart. Choosing Light or
Dark overrides that until you set it back to Match system. The choice is remembered
on this device and applied before the first frame is painted, so the app never
flashes the wrong theme while it loads.

**Language** selects the interface language (English today).

_Shortcuts and accessibility options land with later settings work._

Preferences are stored in your browser. If the browser refuses to store anything —
private-browsing modes and blocked-cookie settings both do — the app keeps working
and your choices apply for the session; they just start from the defaults again next
time.

## Data backup & restore

The **Data** section of Settings lets you back up and move your data:

- **Export** downloads every collection and item as a single JSON file
  (`mycollections-export-<date>.json`). The file is human-readable and includes a
  schema `version` so future versions can read older backups.
- **Import** restores from a backup file. Importing is additive and safe:
  collections and items already present are kept untouched and only new ones are
  added, so re-importing the same file does nothing. An invalid file is rejected
  with a clear error and never partially corrupts your data. While a restore is
  running, the app says so and the file picker is disabled, so a large backup
  never looks like nothing is happening and a second file cannot be started on
  top of the first.

## Trash

Deleting a collection or an item does not destroy it. The **Trash** section of
Settings is where deleted things wait, and where you decide what finally happens
to them:

- **Collections** and **Items** are listed separately, each with the date it was
  deleted. Items that belonged to a deleted collection are not listed on their
  own — they went into the trash with their collection and come back with it, so
  restoring the collection restores its contents too.
- **Restore** puts a row back exactly where it was: a collection returns to your
  collections list with its items, an item returns to the collection it came from.
- **Delete forever** destroys one entry permanently. Deleting a collection this
  way also destroys every item inside it.
- **Empty trash** destroys everything the trash holds at once, and then says what
  it removed.

Both permanent actions ask before they run, naming what is about to go, because
neither can be undone. Nothing in the trash expires or is cleared on a schedule:
it keeps what it holds until you empty it, so a deleted item is recoverable for
as long as you leave it there.

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
