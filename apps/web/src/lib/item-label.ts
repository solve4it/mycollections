import type { Collection, Item } from "@mycollections/core";

/**
 * The field an item is named by: the first field carrying a single value, or
 * null when nothing is filled in. The row links that field's value to the
 * item's own page (#37), so the link reads as the item's name.
 */
export function labelFieldId(collection: Collection, item: Item): string | null {
  for (const field of collection.fields) {
    const value = item.fields[field.id];
    if (value != null && value !== "" && !Array.isArray(value)) return field.id;
  }
  return null;
}

/**
 * What to call an item in a message about it. The first field carrying a value
 * is the item's name in practice — collections put the title-ish field first —
 * and an item with nothing filled in still has to be nameable.
 */
export function itemLabel(collection: Collection, item: Item, untitled: string): string {
  const fieldId = labelFieldId(collection, item);
  return fieldId === null ? untitled : String(item.fields[fieldId]);
}
