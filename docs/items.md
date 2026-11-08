---

title: Items
description: Adding, editing, and organizing items inside a collection.
---

# Items

> **Being written.** Adding, statuses, the status tabs, marking an item collected and deleting are covered; scanning, editing details and bulk operations are not yet.

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

Each row's badge still names the exact status (Owned, Wanted or Ordered). A remaining row also looks unfinished: a wanted row has a dashed border and paler values, and an ordered row has a dotted border. The **All**, **Collected** and **Remaining** tabs above the list show every item, the collected ones, or the remaining ones; they are on every collection. See [All, Collected and Remaining](./search.md#all-collected-and-remaining) for how the tabs work with search and filters, and what an empty tab says.

## Marking an item collected

A wanted or ordered row has a **Mark collected** button. Pressing it changes the item's status to **Owned** at once, with no question first. It changes only the status, never the item's other details. The badge changes to Owned, the row loses its dashed or dotted border, and a finite set's progress counts the item. If you pressed it by mistake, edit the item and pick Wanted or Ordered again.

On the **All** tab the item stays where it is (or moves, if the list is sorted by status), and focus goes to its Edit button. On the **Remaining** tab the item leaves the list, because it is collected now. Focus moves to the item that took its place. If it was the last remaining item, focus moves to the tab panel, which then says "All collected" or how many more there are to find.

If the change cannot be saved, the row says so and the item keeps its status, so you can try again.

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
