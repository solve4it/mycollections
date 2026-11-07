import { BUILT_IN_FIELD_TYPES, type BuiltInFieldType, type FieldDefinition } from "@mycollections/core";
import { type RefObject, useId, useRef } from "react";
import { useTranslation } from "react-i18next";
import { scopedId } from "../lib/dom-id.js";
import { useFocusHandoff } from "../lib/focus-handoff.js";
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
  /**
   * Why the form refused a submit with no field left (#42) — a collection needs
   * at least one. Shown as an alert after Add field, which it also describes:
   * that is the control that fixes it, and there is no field box to mark
   * invalid. The form decides when; leave it unset otherwise.
   */
  noFieldsError?: string;
  /** Lets the form move focus to Add field when it refuses a submit with no field. */
  addFieldRef?: RefObject<HTMLButtonElement | null>;
}

export function FieldSchemaBuilder({
  fields,
  onChange,
  lockedTypeKeys,
  lockedTypeHint,
  noFieldsError,
  addFieldRef: givenAddFieldRef,
}: FieldSchemaBuilderProps) {
  const { t } = useTranslation("collections");

  // Held here rather than in the row: the row is what gets removed, and a
  // handoff asked for from inside it would be unmounted before it could finish.
  const handOffFocus = useFocusHandoff();
  const ownAddFieldRef = useRef<HTMLButtonElement>(null);
  const addFieldRef = givenAddFieldRef ?? ownAddFieldRef;

  // Keyed by the field's own key, the same thing React keys the row by (#369).
  // Array positions renumbered the ids under every row that survived a removal,
  // and a literal prefix would collide with a second builder on the screen.
  const idPrefix = useId();
  const rowId = (key: string, part: string) => scopedId(idPrefix, part, key);
  const noFieldsId = scopedId(idPrefix, "no-fields");

  function updateField(key: string, patch: Partial<FieldDraft>) {
    onChange(fields.map((f) => (f.key === key ? { ...f, ...patch } : f)));
  }

  return (
    <fieldset className="fields-builder">
      <legend>{t("fields_legend")}</legend>
      {fields.map((field, index) => {
        const labelId = rowId(field.key, "label");
        const typeId = rowId(field.key, "type");
        const optionsId = rowId(field.key, "options");
        const requiredId = rowId(field.key, "required");
        const hintId = rowId(field.key, "type-hint");
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
                // Every field needs a label — the server refuses one without —
                // so an empty row stops the submit here rather than being
                // dropped, and a label of only spaces says why, as the
                // collection's name does (#42).
                required
                ref={(input) => {
                  input?.setCustomValidity(
                    field.label !== "" && field.label.trim() === "" ? t("field_label_blank") : "",
                  );
                }}
              />
            </div>

            <div className="form-row">
              <label htmlFor={typeId}>{t("field_type_label")}</label>
              <select
                id={typeId}
                value={field.type}
                // `aria-disabled`, never `disabled` (#368). A disabled control is
                // skipped by Tab, and this one carries the only explanation of why
                // the type cannot change — so `disabled` hid the rule from exactly
                // the user who cannot see the greyed-out select. Marked instead,
                // reachable, named, and refused in the handler.
                aria-disabled={typeLocked || undefined}
                aria-describedby={typeLocked ? hintId : undefined}
                onChange={(e) => {
                  if (typeLocked) return;
                  updateField(field.key, { type: e.target.value as BuiltInFieldType });
                }}
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
              onClick={() => {
                // The field that takes this one's place, by the APG
                // successor-element rule (#367) — its *label*, not its own
                // Remove field: the label names the surviving field, so arrival
                // says where the user is, where a second destructive control
                // under the keyboard says nothing and invites a slip. The
                // successor is the row after this one, named by its key now
                // rather than looked up at this index; with none after it, the
                // control that makes one.
                const next = fields[index + 1];
                handOffFocus(
                  () => (next ? document.getElementById(rowId(next.key, "label")) : null) ?? addFieldRef.current,
                );
                onChange(fields.filter((f) => f.key !== field.key));
              }}
            >
              <Icon name="delete" />
              {t("remove_field")}
            </button>
          </div>
        );
      })}
      <button
        type="button"
        ref={addFieldRef}
        className="touch-target button-quiet"
        onClick={() => onChange([...fields, emptyField()])}
        aria-describedby={noFieldsError ? noFieldsId : undefined}
      >
        <Icon name="add" />
        {t("add_field")}
      </button>
      {/* Inserted with its message already inside: a `role="alert"` is
          announced when it appears. */}
      {noFieldsError && (
        <p id={noFieldsId} role="alert">
          {noFieldsError}
        </p>
      )}
    </fieldset>
  );
}
