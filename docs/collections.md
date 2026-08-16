---
title: Collections
description: How collections work in MyCollections — creating them, choosing a plugin type, and managing them over time.
---

# Collections

> **Placeholder.** This page will be filled in when the collection CRUD feature lands.

A **collection** is a bucket for related items, backed by a plugin that knows the schema and behavior for that kind of thing. A LEGO collection uses the LEGO plugin; an audio gear collection uses the audio plugin; and so on.

## Creating a collection

_Walkthrough for creating a collection and picking a plugin type._

## Editing and deleting

Open a collection and choose **Edit collection** to change its name, description, whether it is a finite set, and — the part that matters most — its fields. A collection's shape is not fixed at creation: add a field you wish you had, rename one that reads badly, drop one you never fill in, or drag the order around.

### What each change costs your items

Your item values are filed under each field, so most edits cost nothing at all:

| Change | What happens to existing items |
| --- | --- |
| **Add a field** | Nothing. Existing items are simply blank for it, and stay valid. Marking it required applies the next time you edit an item — nothing is filled in for you. |
| **Rename a field**, or change its help text, choices, rating range, or currency | Nothing. Values follow the field. |
| **Reorder fields** | Nothing — it only changes what you see. |
| **Remove a field** | The field disappears from every item, but **the values are kept** in your data and stay in a JSON backup. Nothing is deleted. |
| **Change a field's type** | Only possible while the collection is empty. |

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
