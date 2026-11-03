import { type FieldDefinition, formatItemSort, isSortableFieldType } from "@mycollections/core";
import { useId } from "react";
import { useTranslation } from "react-i18next";

interface ItemSortSelectProps {
  /** The sort in force, already checked against the collection (`effectiveSort`). */
  value: string | undefined;
  /** Whether a search is in force — the default order is then relevance. */
  searching: boolean;
  fields: FieldDefinition[];
  /** `undefined` for the default order. */
  onSort: (sort: string | undefined) => void;
}

/** Direction words by field type, so "low to high" is never said of a title (#41). */
function directionKeys(type: string): [string, string] {
  if (type === "number" || type === "rating" || type === "currency") return ["sort_low_high", "sort_high_low"];
  if (type === "date") return ["sort_oldest", "sort_newest"];
  if (type === "boolean") return ["sort_no_first", "sort_yes_first"];
  return ["sort_a_z", "sort_z_a"];
}

/**
 * The collection screen's "Sort by" control (#41): one native `<select>` with
 * the direction in each option — the GOV.UK "Sort by" pattern. Two selects (key
 * plus direction) would allow meaningless pairs, a direction for "Best match",
 * and cost a second tab stop for every user.
 *
 * The empty value is the default order: relevance while searching, otherwise
 * the order items were added — which is also what "Date added, oldest first"
 * means, so outside a search that option *is* the default rather than a twin.
 */
export function ItemSortSelect({ value, searching, fields, onSort }: ItemSortSelectProps) {
  const { t } = useTranslation("items");
  const id = useId();
  const selected = !value || (!searching && value === "createdAt") ? "" : value;
  const sortable = fields.filter((field) => isSortableFieldType(field.type));

  return (
    <div className="form-row item-sort">
      <label htmlFor={id}>{t("sort_label")}</label>
      <select id={id} value={selected} onChange={(event) => onSort(event.target.value || undefined)}>
        {searching ? (
          <>
            <option value="">{t("sort_best_match")}</option>
            <option value="createdAt">{t("sort_added_oldest")}</option>
          </>
        ) : (
          <option value="">{t("sort_added_oldest")}</option>
        )}
        <option value="-createdAt">{t("sort_added_newest")}</option>
        <option value="-updatedAt">{t("sort_updated")}</option>
        <option value="name">{t("sort_name_a_z")}</option>
        <option value="-name">{t("sort_name_z_a")}</option>
        {sortable.map((field) => {
          const [ascending, descending] = directionKeys(field.type);
          return (
            <optgroup key={field.id} label={field.label}>
              <option value={formatItemSort({ key: "field", fieldId: field.id, direction: "asc" })}>
                {t(ascending, { field: field.label })}
              </option>
              <option value={formatItemSort({ key: "field", fieldId: field.id, direction: "desc" })}>
                {t(descending, { field: field.label })}
              </option>
            </optgroup>
          );
        })}
      </select>
    </div>
  );
}
