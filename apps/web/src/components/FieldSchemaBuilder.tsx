import { BUILT_IN_FIELD_TYPES, type BuiltInFieldType, type FieldDefinition } from "@mycollections/core";
import { useTranslation } from "react-i18next";
import { Icon } from "./Icon.js";

/**
 * A field being edited. `key` is both the React key and the field's id, so a
 * field carried in from an existing collection keeps the id its stored values
 * are filed under — relabelling, reordering and retyping all leave the values
 * exactly where they are.
 */
export interface FieldDraft {
  key: string;
  label: string;
  type: BuiltInFieldType;
  required: boolean;
  optionsText: string;
}

const TYPES_WITH_OPTIONS: BuiltInFieldType[] = ["select", "multiselect"];

export function emptyField(): FieldDraft {
  return { key: crypto.randomUUID(), label: "", type: "text", required: false, optionsText: "" };
}

function parseOptions(text: string): string[] {
  return text
    .split(",")
    .map((o) => o.trim())
    .filter((o) => o.length > 0);
}

export function buildField(draft: FieldDraft): FieldDefinition {
  const base = { id: draft.key, label: draft.label.trim(), required: draft.required };
  switch (draft.type) {
    case "select":
    case "multiselect":
      return { ...base, type: draft.type, options: parseOptions(draft.optionsText) };
    case "rating":
      return { ...base, type: "rating", max: 5 };
    case "currency":
      return { ...base, type: "currency", currencyCode: "USD" };
    default:
      return { ...base, type: draft.type };
  }
}

/** The inverse of `buildField`, for loading a stored schema back into the editor. */
export function fieldToDraft(field: FieldDefinition): FieldDraft {
  return {
    key: field.id,
    label: field.label,
    type: field.type,
    required: field.required,
    optionsText: field.type === "select" || field.type === "multiselect" ? field.options.join(", ") : "",
  };
}

export interface FieldSchemaBuilderProps {
  fields: FieldDraft[];
  onChange: (fields: FieldDraft[]) => void;
  /**
   * Field keys whose type must not change. Item values are stored keyed by field
   * id and are never coerced, so retyping a field that already has values behind
   * it would strand them — the server refuses it, and the control says so rather
   * than letting the user discover it on save.
   */
  lockedTypeKeys?: ReadonlySet<string>;
  /** Why those types are locked. Required whenever `lockedTypeKeys` is non-empty. */
  lockedTypeHint?: string;
}

export function FieldSchemaBuilder({ fields, onChange, lockedTypeKeys, lockedTypeHint }: FieldSchemaBuilderProps) {
  const { t } = useTranslation("collections");

  function updateField(key: string, patch: Partial<FieldDraft>) {
    onChange(fields.map((f) => (f.key === key ? { ...f, ...patch } : f)));
  }

  return (
    <fieldset className="fields-builder">
      <legend>{t("fields_legend")}</legend>
      {fields.map((field, index) => {
        const labelId = `field-label-${index}`;
        const typeId = `field-type-${index}`;
        const optionsId = `field-options-${index}`;
        const requiredId = `field-required-${index}`;
        const hintId = `field-type-hint-${index}`;
        const typeLocked = lockedTypeKeys?.has(field.key) ?? false;
        return (
          <div className="field-row" key={field.key}>
            <div className="form-row">
              <label htmlFor={labelId}>{t("field_label_label")}</label>
              <input
                id={labelId}
                type="text"
                value={field.label}
                onChange={(e) => updateField(field.key, { label: e.target.value })}
              />
            </div>

            <div className="form-row">
              <label htmlFor={typeId}>{t("field_type_label")}</label>
              <select
                id={typeId}
                value={field.type}
                disabled={typeLocked}
                aria-describedby={typeLocked ? hintId : undefined}
                onChange={(e) => updateField(field.key, { type: e.target.value as BuiltInFieldType })}
              >
                {BUILT_IN_FIELD_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {t(`field_types.${type}`)}
                  </option>
                ))}
              </select>
              {typeLocked && (
                <p id={hintId} className="field-hint">
                  {lockedTypeHint}
                </p>
              )}
            </div>

            {TYPES_WITH_OPTIONS.includes(field.type) && (
              <div className="form-row">
                <label htmlFor={optionsId}>{t("field_options_label")}</label>
                <input
                  id={optionsId}
                  type="text"
                  value={field.optionsText}
                  onChange={(e) => updateField(field.key, { optionsText: e.target.value })}
                />
              </div>
            )}

            <div className="form-row">
              <label htmlFor={requiredId} className="checkbox-row">
                <input
                  id={requiredId}
                  type="checkbox"
                  checked={field.required}
                  onChange={(e) => updateField(field.key, { required: e.target.checked })}
                />
                {t("field_required_label")}
              </label>
            </div>

            <button
              type="button"
              className="touch-target button-quiet"
              onClick={() => onChange(fields.filter((f) => f.key !== field.key))}
            >
              <Icon name="delete" />
              {t("remove_field")}
            </button>
          </div>
        );
      })}
      <button type="button" className="touch-target button-quiet" onClick={() => onChange([...fields, emptyField()])}>
        <Icon name="add" />
        {t("add_field")}
      </button>
    </fieldset>
  );
}
