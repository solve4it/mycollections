---

title: Collections
description: How collections work in MyCollections — creating them, choosing a plugin type, and managing them over time.
---

# Collections

> **Placeholder.** This page will be filled in when the collection CRUD feature lands.

A **collection** is a bucket for related items, backed by a plugin that knows the schema and behavior for that kind of thing. A LEGO collection uses the LEGO plugin; an audio gear collection uses the audio plugin; and so on.

## Creating a collection

_Walkthrough for creating a collection and picking a plugin type._

### What a collection needs

A name of up to 120 characters (a description, if you give one, can run to 2,000), and at least one field, each with a label. A single- or multiple-choice field also needs at least one option in its **Options** box, separated by commas. The form will not submit without them, and it says which box needs attention: a name or label left empty or made only of spaces, or an Options box with no option in it, is marked where it is. If you have removed every field, a message appears beside **Add field** and the cursor moves there. An empty field row is not skipped — give it a label or remove it. The same rules apply in **Edit collection**.

### Finite sets and their size

Some collections have a known end: a trading-card set of 102 cards, a series of 24 figures, every album an artist released. Tick **Finite set (a fixed, known number of items)** when you create the collection, and a second box appears beneath it: **Number of items in the set**. Enter how many items the complete set has — a whole number from 1 to 100,000.

The number is optional. If you do not know it yet, leave the box empty and add it later from **Edit collection**. A number outside that range, or one with a fraction, is refused when you submit, and the box says why.

If you clear the **Finite set** tick, the box disappears, and the collection is saved without a size. Ticking it again before you submit brings back what you had typed.

### Seeing your progress

Once a finite set has a size, its card on the Collections page and the top of its own page show how far along you are, for example **3 of 5 collected**, with a bar beneath. Only items marked **Owned** count as collected. Wanted and ordered items are what you still need, and items in the trash do not count at all.

When you own as many items as the set has, a **Complete** badge appears beside the count. This happens even if some wanted or ordered items are still listed. If you own more than the set's size, for example duplicates or variants, the count says so (**6 of 5 collected**) and the bar stays full.

A finite set without a size shows no bar. Its page reminds you to add the size from **Edit collection**. Collections that are not finite sets show neither the bar nor the reminder.

### Completing a set

When something you do on a set's page brings it up to its size, the app marks the moment. That can be **Mark collected** on a wanted or ordered item, saving an item's edit that changes it to **Owned**, or adding a new owned item. A message appears at the bottom of the screen saying what you did and that the set is complete, for example **Marked “Penny” as collected. Coin set is complete!**, and the **Complete** badge gives a short stamp. Screen readers hear that message once, in place of the usual confirmation for that action. The message clears itself after ten seconds; the badge stays for as long as the set is complete. If your device asks for reduced motion, the badge does not move.

Only a change you make from the set's page counts, and only once per completion. There is no message when you open a set that was already complete, when you lower a set's size in **Edit collection** to what you already own, when you undo a delete, or when you restore an item from the trash in **Settings**. If the set's count had not loaded when you made the change, could not be loaded, or was still being refreshed, there is no message either, because the app cannot tell that the change was the one that completed it. The same goes for a change that did not itself make an item **Owned**, such as renaming one. The message never covers anything you need: you can click straight through it. If the set later drops below its size, for example because you edit an item back to **Wanted**, completing it again is celebrated again.

## Editing and deleting

Open a collection and choose **Edit collection** to change its name, description, whether it is a finite set and how many items the set has, and — the part that matters most — its fields. Emptying the **Number of items in the set** box, or clearing the **Finite set** tick, removes the stored size when you save. A collection's shape is not fixed at creation: add a field you wish you had, rename one that reads badly, drop one you never fill in, or drag the order around.

### What each change costs your items

Your item values are filed under each field, so most edits cost nothing at all:

| Change                                                                          | What happens to existing items                                                                                                                              |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Add a field**                                                                 | Nothing. Existing items are simply blank for it, and stay valid. Marking it required applies the next time you edit an item — nothing is filled in for you. |
| **Rename a field**, or change its help text, choices, rating range, or currency | Nothing. Values follow the field.                                                                                                                           |
| **Reorder fields**                                                              | Nothing — it only changes what you see.                                                                                                                     |
| **Remove a field**                                                              | The field disappears from every item, but **the values are kept** in your data and stay in a JSON backup. Nothing is deleted.                               |
| **Change a field's type**                                                       | Only possible while the collection is empty.                                                                                                                |

### Why the type is sometimes locked

Once a collection has items, the type of an existing field cannot change: the values already stored were entered as one kind of thing, and MyCollections will not silently reinterpret them. A "Year" holding `about 1985` cannot become a number without either mangling it or throwing it away, so the app refuses instead of guessing. Items in the trash count too — restoring one would bring back values the new field could not read.

If you need a different type, add a new field alongside the old one, move what you want across, and then remove the old field. Your original values stay in your data either way.

Removing a field is not a way to clear data, and adding it back is not a way to recover it: a re-added field is a new field and starts empty. If you want the old values back, restore from a [JSON backup](./settings.md).

### Deleting a collection

Deleting a collection puts it in the trash along with everything inside it, and restoring it brings its items back with it. See [Settings](./settings.md) for emptying the trash.

## Moving items between collections

_How to relocate items when you reorganize._

## Related

- [Items](./items.md) — what lives inside collections
- [Settings](./settings.md#per-collection-settings) — per-collection configuration
