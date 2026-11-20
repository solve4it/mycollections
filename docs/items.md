---

title: Items
description: Adding, editing, and organizing items inside a collection.
---

# Items

> **Being written.** Adding, importing from a CSV file, statuses, the status tabs, marking an item collected and deleting are covered; scanning, editing details and bulk operations are not yet.

## Adding items

MyCollections supports three ways to add an item to a collection:

1. **Manual entry** — type the fields yourself.
2. **Barcode / matrix-code scanning** — use your device camera to scan and auto-populate fields.
3. **External lookup** — search a plugin-specific data source and import a match.

Details for each flow will land with their respective feature issues.

Every item has a **status**: **Owned**, **Wanted** or **Ordered**. A new item starts as Owned — or as Wanted if you add it while the **Remaining** tab is selected, so it appears in the tab you are looking at. You can change the status before saving, and at any time afterwards by editing the item.

## Importing items from a CSV file

To add many items at once, choose **Import CSV** on a collection's page and pick a CSV file. Most spreadsheets can save one: use **CSV UTF-8** if your spreadsheet offers it.

- **The first row names the columns.** A file can have up to 10,000 rows, 100 columns and 10 MB.
- **Match columns.** Each column gets a choice of the collection's fields, **Status**, or **Don't import**. Columns whose names match a field's name (or "Status") are matched for you. A required field needs a column, and a field can be chosen for only one column.
- **Check the rows.** The page shows the first rows as they will be stored, and lists every row that will be skipped and why (for example, "Year: not a number"). Rows that can't be read are skipped, and the rest are added.
- **Add.** The rows that can be read are added together. If anything goes wrong, nothing is added, so it is safe to try again.

How to write values:

| Field              | Write it as                                              |
| ------------------ | -------------------------------------------------------- |
| Number             | `42` or `-3.25`                                          |
| Currency           | `1234.56`, `1,234.56` or `$1,234.56`                     |
| Date               | `2024-02-29` (year, month, day)                          |
| Yes/no             | `yes`/`no`, `true`/`false`, `y`/`n` or `1`/`0`           |
| Select             | One of the field's options; capital letters don't matter |
| Multiselect        | Options separated by semicolons: `Red; Blue`             |
| Tags               | Tags separated by commas: `classic, sci-fi`              |
| Rating             | A whole number from 0 to the field's maximum             |
| Web address, email | A full `https://` address; an email address              |
| Status             | Owned, Wanted or Ordered; an empty cell means Owned      |

Photos can't come from a CSV file. Add them on each item's page, or restore a backup that holds them.

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
