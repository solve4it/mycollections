import type { FieldDefinition, Item } from "@mycollections/core";

/** How many labelled values a grid card shows under the item's name (#38). */
export const CARD_FIELD_COUNT = 3;

function filled(value: unknown): boolean {
  return value != null && value !== "" && !(Array.isArray(value) && value.length === 0);
}

/**
 * The fields a grid card shows (#38): the first few with a value, in schema
 * order, leaving out the one the item is named by — the card's link already
 * says it. The field the list is sorted by comes first, filled or not: a grid
 * ordered by something it does not show reads as shuffled, and an empty value
 * ("—") is exactly why an item sits at the end.
 */
export function cardFields(
  fields: FieldDefinition[],
  item: Item,
  nameFieldId: string | null,
  sortFieldId: string | undefined,
): FieldDefinition[] {
  const others = fields.filter((field) => field.id !== nameFieldId);
  const sorted = others.find((field) => field.id === sortFieldId);
  const rest = others.filter((field) => field !== sorted && filled(item.fields[field.id]));
  return (sorted ? [sorted, ...rest] : rest).slice(0, CARD_FIELD_COUNT);
}
