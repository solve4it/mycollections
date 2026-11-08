---

title: Items
description: Adding, editing, and organizing items inside a collection.
---

# Items

> **Being written.** Adding, statuses, the status tabs and deleting are covered; scanning, editing details and bulk operations are not yet.

## Adding items

MyCollections supports three ways to add an item to a collection:

1. **Manual entry** — type the fields yourself.
2. **Barcode / matrix-code scanning** — use your device camera to scan and auto-populate fields.
3. **External lookup** — search a plugin-specific data source and import a match.

Details for each flow will land with their respective feature issues.

Every item has a **status**: **Owned**, **Wanted** or **Ordered**. A new item starts as Owned — or as Wanted if you add it while the **Remaining** tab is selected, so it appears in the tab you are looking at. You can change the status before saving, and at any time afterwards by editing the item.

## Collected and remaining

The app groups the three statuses into two words, used by the tabs above the list, the status sort, and a finite set's progress:

- **Collected** means **Owned**.
- **Remaining** means **Wanted** and **Ordered** together — what you are looking for and what is on its way.

Each row's badge still names the exact status (Owned, Wanted or Ordered). The **All**, **Collected** and **Remaining** tabs above the list show every item, the collected ones, or the remaining ones; they are on every collection. See [All, Collected and Remaining](./search.md#all-collected-and-remaining) for how the tabs work with search and filters, and what an empty tab says.

## Editing an item

_How to edit fields, attach images, add notes, and so on._

If an edit means the item no longer belongs in the list you are looking at — you change an owned item to Wanted while on the **Collected** tab, say, or a search no longer matches its new name — it is saved and leaves the list, and the app says why it is not shown.

## Deleting an item

Deleting is reversible. The item disappears from the list and a shortcut appears
for a few seconds offering to undo it; taking that undo puts the item straight
back. Missing the shortcut costs nothing — the delete was soft, and the item is
waiting in the trash, where it can be restored (or destroyed for good) at any
time. See [Trash](./settings.md#trash) in Settings.

## Bulk operations

_How to edit or delete many items at once._

## Related

- [Collections](./collections.md) — the buckets items live in
- [Search](./search.md) — finding items
