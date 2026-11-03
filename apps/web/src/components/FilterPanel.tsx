import {
  type FieldDefinition,
  formatItemFilters,
  type ItemFilter,
  isFilterableFieldType,
  parseItemFilters,
} from "@mycollections/core";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { draftFromFilters, type FacetDraft, type FilterDraft, filtersFromDraft } from "../lib/filter-draft.js";
import { useTagValues } from "../lib/queries.js";

interface FilterPanelProps {
  collectionId: string;
  fields: FieldDefinition[];
  /** The filters in force (already checked against the schema). */
  filters: ItemFilter[];
  onApply: (filters: ItemFilter[]) => void;
}

/**
 * The collection screen's filters (#41): an APG disclosure — a "Filters" button
 * with `aria-expanded` — revealing one facet per filterable field, applied with
 * a button. This is the MOJ "Filter" component's shape (GOV.UK family): no
 * operator menus, fixed tab stops per schema, and nothing on the page moves
 * while a box is being ticked (WCAG 3.2.2) — the list changes when the user
 * says so.
 *
 * Facets come from the schema, and tag choices from every live item in the
 * collection, never from the filtered result: an option that vanished because
 * of the filter it is part of would take focus with it.
 */
export function FilterPanel({ collectionId, fields, filters, onApply }: FilterPanelProps) {
  const { t } = useTranslation("items");
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const facetFields = fields.filter((field) => isFilterableFieldType(field.type));

  // The draft follows the applied filters when they change from outside (a
  // chip removed, Clear filters, Back) — adjusted during render, so there is no
  // commit showing the stale draft, and nothing remounts under focus.
  const applied = formatItemFilters(filters);
  const [seenApplied, setSeenApplied] = useState(applied);
  const [draft, setDraft] = useState<FilterDraft>(() => draftFromFilters(filters, fields));
  const [tooMany, setTooMany] = useState(false);
  if (seenApplied !== applied) {
    setSeenApplied(applied);
    setDraft(draftFromFilters(filters, fields));
    setTooMany(false);
  }

  if (facetFields.length === 0) return null;

  function update(fieldId: string, facet: FacetDraft) {
    setDraft((current) => ({ ...current, [fieldId]: facet }));
  }

  return (
    <div className="filter-panel">
      <button
        type="button"
        className="touch-target button-quiet"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        {filters.length > 0 ? t("filters_toggle_count", { count: filters.length }) : t("filters_toggle")}
      </button>
      <form
        id={panelId}
        hidden={!open}
        className="filter-form"
        aria-label={t("filters_toggle")}
        onSubmit={(event) => {
          event.preventDefault();
          const next = filtersFromDraft(draft, fields);
          // The API's caps, checked here so a query it would refuse is never sent.
          if (next.length > 0 && parseItemFilters(formatItemFilters(next)) === null) {
            setTooMany(true);
            return;
          }
          setTooMany(false);
          onApply(next);
        }}
      >
        {facetFields.map((field) => (
          <Facet
            key={field.id}
            collectionId={collectionId}
            field={field}
            facet={draft[field.id]}
            panelOpen={open}
            onChange={(facet) => update(field.id, facet)}
          />
        ))}
        {tooMany && <p role="alert">{t("filters_too_many")}</p>}
        <button type="submit" className="touch-target">
          {t("filters_apply")}
        </button>
      </form>
    </div>
  );
}

interface FacetProps {
  collectionId: string;
  field: FieldDefinition;
  facet: FacetDraft | undefined;
  panelOpen: boolean;
  onChange: (facet: FacetDraft) => void;
}

function Facet({ collectionId, field, facet, panelOpen, onChange }: FacetProps) {
  const { t } = useTranslation("items");
  const id = useId();
  const tags = useTagValues(collectionId, field.id, panelOpen && field.type === "tags");
  if (!facet) return null;

  if (facet.kind === "choice") {
    const offered =
      field.type === "select" || field.type === "multiselect"
        ? field.options
        : (tags.data?.values.map((entry) => entry.value) ?? []);
    // A value chosen earlier stays offered even if it fell out of the top tags.
    const options = [...offered, ...facet.values.filter((value) => !offered.includes(value))];
    const canMatchAll = field.type !== "select";
    return (
      <fieldset className="form-row filter-facet">
        <legend>{field.label}</legend>
        {options.length === 0 && <p className="form-hint">{t("filters_no_tags")}</p>}
        {options.map((option) => (
          <label key={option} className="checkbox-row">
            <input
              type="checkbox"
              checked={facet.values.includes(option)}
              onChange={(event) =>
                onChange({
                  ...facet,
                  values: event.target.checked
                    ? [...facet.values, option]
                    : facet.values.filter((value) => value !== option),
                })
              }
            />
            {option}
          </label>
        ))}
        {canMatchAll && options.length > 1 && (
          <fieldset className="filter-match">
            <legend>{t("filters_match_legend", { field: field.label })}</legend>
            {(["in", "all"] as const).map((match) => (
              <label key={match} className="checkbox-row">
                <input
                  type="radio"
                  name={`${id}-match`}
                  checked={facet.match === match}
                  onChange={() => onChange({ ...facet, match })}
                />
                {t(match === "in" ? "filters_match_any" : "filters_match_all")}
              </label>
            ))}
          </fieldset>
        )}
      </fieldset>
    );
  }

  if (facet.kind === "range") {
    const type = field.type === "date" ? "date" : "number";
    const [fromKey, toKey] = field.type === "date" ? ["filters_from", "filters_to"] : ["filters_min", "filters_max"];
    return (
      <fieldset className="form-row filter-facet filter-range">
        <legend>{field.label}</legend>
        <label htmlFor={`${id}-min`}>{t(fromKey)}</label>
        <input
          id={`${id}-min`}
          type={type}
          value={facet.min}
          onChange={(event) => onChange({ ...facet, min: event.target.value })}
        />
        <label htmlFor={`${id}-max`}>{t(toKey)}</label>
        <input
          id={`${id}-max`}
          type={type}
          value={facet.max}
          onChange={(event) => onChange({ ...facet, max: event.target.value })}
        />
      </fieldset>
    );
  }

  return (
    <fieldset className="form-row filter-facet">
      <legend>{field.label}</legend>
      {(["any", "yes", "no", "unset"] as const).map((value) => (
        <label key={value} className="checkbox-row">
          <input
            type="radio"
            name={`${id}-bool`}
            checked={facet.value === value}
            onChange={() => onChange({ kind: "boolean", value })}
          />
          {t(`filters_bool_${value}`)}
        </label>
      ))}
    </fieldset>
  );
}

interface AppliedFiltersProps {
  fields: FieldDefinition[];
  filters: ItemFilter[];
  onRemove: (index: number) => void;
  onClear: () => void;
}

/** What one filter says on its chip, e.g. "Year: from 1959". */
export function useFilterLabel(fields: FieldDefinition[]): (filter: ItemFilter) => string {
  const { t } = useTranslation("items");
  return (filter) => {
    const field = fields.find((candidate) => candidate.id === filter.field)?.label ?? filter.field;
    switch (filter.op) {
      case "in":
        return t("chip_in", { field, values: filter.value.join(", ") });
      case "all":
        return t("chip_all", { field, values: filter.value.join(", ") });
      case "gte":
        return t("chip_gte", { field, value: filter.value });
      case "lte":
        return t("chip_lte", { field, value: filter.value });
      case "eq":
        return t(filter.value ? "chip_eq_true" : "chip_eq_false", { field });
      case "empty":
        return t("chip_empty", { field });
    }
  };
}

/**
 * The filters in force, each a button that removes it, plus Clear filters —
 * visible with the panel closed, so what narrows the list is never hidden
 * (MOJ "Filter": selected filters). Rendered only while filters apply.
 */
export function AppliedFilters({ fields, filters, onRemove, onClear }: AppliedFiltersProps) {
  const { t } = useTranslation("items");
  const label = useFilterLabel(fields);
  if (filters.length === 0) return null;
  return (
    <div className="applied-filters">
      <ul aria-label={t("filters_applied_label")}>
        {filters.map((filter, index) => (
          <li key={`${filter.field}:${filter.op}`}>
            <button
              type="button"
              className="touch-target button-quiet filter-chip"
              data-filter-chip=""
              aria-label={t("remove_filter", { label: label(filter) })}
              onClick={() => onRemove(index)}
            >
              {label(filter)}
              <span aria-hidden="true"> ×</span>
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className="touch-target button-quiet" onClick={onClear}>
        {t("filters_clear")}
      </button>
    </div>
  );
}
