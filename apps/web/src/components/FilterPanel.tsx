import {
  type FieldDefinition,
  formatItemFilters,
  type ItemFilter,
  isFilterableFieldType,
  parseItemFilters,
} from "@mycollections/core";
import { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { draftFromFilters, type FacetDraft, type FilterDraft, filtersFromDraft } from "../lib/filter-draft.js";
import { useTagValues } from "../lib/queries.js";

/**
 * The longest URL-encoded filter the panel will send — well inside Node's 16 KB
 * request-header limit, with room for the rest of the URL and the headers.
 */
export const FILTER_MAX_ENCODED_LENGTH = 6_000;

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
  //
  // Only the facets whose filters changed are re-read: removing the Year chip
  // must not throw away a box the user has just ticked under Genre.
  const applied = formatItemFilters(filters);
  const [seen, setSeen] = useState({ applied, filters });
  const [draft, setDraft] = useState<FilterDraft>(() => draftFromFilters(filters, fields));
  const [tooMany, setTooMany] = useState(false);
  if (seen.applied !== applied) {
    const incoming = draftFromFilters(filters, fields);
    const forField = (list: ItemFilter[], id: string) => JSON.stringify(list.filter((f) => f.field === id));
    setDraft((current) => {
      const next = { ...current };
      for (const field of fields) {
        if (forField(seen.filters, field.id) !== forField(filters, field.id)) {
          const facet = incoming[field.id];
          if (facet) next[field.id] = facet;
        }
      }
      return next;
    });
    setSeen({ applied, filters });
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
          // The API's caps, checked here so a query it would refuse is never sent —
          // including the encoded length, which the API cannot check: past Node's
          // 16 KB header limit a request is refused with a 431 before it arrives.
          const encoded = formatItemFilters(next);
          if (
            next.length > 0 &&
            (parseItemFilters(encoded) === null || encodeURIComponent(encoded).length > FILTER_MAX_ENCODED_LENGTH)
          ) {
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
  // Every tag this facet has shown stays offered while it is mounted: a refetch
  // that no longer lists one (its last use just removed) must not pull a
  // checkbox out from under focus.
  const shownTags = useRef<string[]>([]);
  for (const entry of tags.data?.values ?? []) {
    if (!shownTags.current.includes(entry.value)) shownTags.current.push(entry.value);
  }
  if (!facet) return null;

  if (facet.kind === "choice") {
    const offered = field.type === "select" || field.type === "multiselect" ? field.options : shownTags.current;
    // A value chosen earlier stays offered even if it fell out of the top tags.
    const options = [...offered, ...facet.values.filter((value) => !offered.includes(value))];
    const canMatchAll = field.type !== "select";
    return (
      <fieldset className="form-row filter-facet">
        <legend>{field.label}</legend>
        {field.type === "tags" && tags.isPending && options.length === 0 && (
          <p className="form-hint">{t("filters_loading_tags")}</p>
        )}
        {field.type === "tags" && tags.isError && <p role="alert">{t("filters_tags_error")}</p>}
        {field.type === "tags" && tags.isSuccess && options.length === 0 && (
          <p className="form-hint">{t("filters_no_tags")}</p>
        )}
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
                {match === "in" ? t("filters_match_any") : t("filters_match_all")}
              </label>
            ))}
          </fieldset>
        )}
      </fieldset>
    );
  }

  if (facet.kind === "range") {
    const type = field.type === "date" ? "date" : "number";
    const isDate = field.type === "date";
    const fromLabel = isDate ? t("filters_from") : t("filters_min");
    const toLabel = isDate ? t("filters_to") : t("filters_max");
    return (
      <fieldset className="form-row filter-facet filter-range">
        <legend>{field.label}</legend>
        <label htmlFor={`${id}-min`}>{fromLabel}</label>
        <input
          id={`${id}-min`}
          type={type}
          value={facet.min}
          onChange={(event) => onChange({ ...facet, min: event.target.value })}
        />
        <label htmlFor={`${id}-max`}>{toLabel}</label>
        <input
          id={`${id}-max`}
          type={type}
          value={facet.max}
          onChange={(event) => onChange({ ...facet, max: event.target.value })}
        />
      </fieldset>
    );
  }

  // Literal keys, so the locale-keys check can see every one.
  const booleanLabels = {
    any: t("filters_bool_any"),
    yes: t("filters_bool_yes"),
    no: t("filters_bool_no"),
    unset: t("filters_bool_unset"),
  };
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
          {booleanLabels[value]}
        </label>
      ))}
    </fieldset>
  );
}

interface AppliedFiltersProps {
  fields: FieldDefinition[];
  filters: ItemFilter[];
  /** `chip` is the control being removed, for the focus handoff to wait on. */
  onRemove: (index: number, chip: HTMLElement) => void;
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
              onClick={(event) => onRemove(index, event.currentTarget)}
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
