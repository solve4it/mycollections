import { type FieldDefinition, ITEM_STATUSES, type ItemStatus } from "@mycollections/core";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ItemInput } from "../lib/api-client.js";

type DraftValue = string | boolean | string[];

interface DynamicItemFormProps {
  fields: FieldDefinition[];
  onSubmit: (payload: ItemInput) => void;
  initialStatus?: ItemStatus;
  initialValues?: Record<string, unknown>;
  submitLabel?: string;
  /**
   * Names the form, for the editor that replaces a row (#367).
   *
   * Opening the editor takes the item's own fields off the screen, so a user
   * who has just been put inside it has nothing left saying which item they
   * are editing. A named `<form>` is a landmark, and entering it is announced
   * before its first control — which is where the name belongs, rather than on
   * the control itself.
   */
  label?: string;
  /**
   * Put focus on the first control as the form appears (#367).
   *
   * The APG disclosure rule: a user who opened this is meant to be in it. Only
   * the row editor asks — the add-item form is part of the page, not something
   * that opened.
   */
  focusOnOpen?: boolean;
  onCancel?: () => void;
  pending?: boolean;
  /**
   * Changes to clear the form back to its initial values (#368).
   *
   * The add-item form has to be empty again once an item is saved — a form still
   * holding what it submitted is how pressing Enter a second time made a
   * duplicate. Remounting it with a `key` would do the same job and take focus
   * with it: the submit button the user is standing on would be a different
   * element afterwards, which is the orphaned focus of #367 arriving by the back
   * door. So the signal resets the state in place and the DOM never moves.
   *
   * The row editor passes nothing: it closes on save rather than clearing.
   */
  resetSignal?: number;
}

function toDraft(field: FieldDefinition, raw: unknown): DraftValue {
  if (field.type === "boolean") return Boolean(raw);
  if (field.type === "multiselect") return Array.isArray(raw) ? (raw as string[]) : [];
  if (field.type === "tags") return Array.isArray(raw) ? (raw as string[]).join(", ") : raw == null ? "" : String(raw);
  return raw == null ? "" : String(raw);
}

function fromDraft(field: FieldDefinition, value: DraftValue): unknown {
  switch (field.type) {
    case "boolean":
      return Boolean(value);
    case "number":
    case "currency":
    case "rating":
      return value === "" ? null : Number(value);
    case "multiselect":
      return value as string[];
    case "tags":
      return String(value)
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    default:
      return value;
  }
}

export function DynamicItemForm({
  fields,
  onSubmit,
  initialStatus,
  initialValues = {},
  submitLabel,
  label,
  focusOnOpen = false,
  onCancel,
  pending = false,
  resetSignal = 0,
}: DynamicItemFormProps) {
  const { t } = useTranslation("items");
  const [status, setStatus] = useState<ItemStatus>(initialStatus ?? "owned");
  const [values, setValues] = useState<Record<string, DraftValue>>(() =>
    Object.fromEntries(fields.map((f) => [f.id, toDraft(f, initialValues[f.id])])),
  );

  // Adjusted during render rather than in an effect, which is React's own
  // answer for state that has to follow a prop: the re-render happens before
  // anything is painted, so the cleared form is the first thing shown. An
  // effect would also have to list `initialValues` among its dependencies — a
  // fresh object on every render — and so would run on every one of them.
  const [lastReset, setLastReset] = useState(resetSignal);
  if (lastReset !== resetSignal) {
    setLastReset(resetSignal);
    setStatus(initialStatus ?? "owned");
    setValues(Object.fromEntries(fields.map((f) => [f.id, toDraft(f, initialValues[f.id])])));
  }

  const statusRef = useRef<HTMLSelectElement>(null);
  useEffect(() => {
    if (focusOnOpen) statusRef.current?.focus();
  }, [focusOnOpen]);

  function setValue(id: string, value: DraftValue) {
    setValues((prev) => ({ ...prev, [id]: value }));
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    // The refusal that `disabled` used to carry (#368). The attribute is gone
    // because Chrome drops focus to <body> the moment the focused control
    // becomes disabled, so the button that reports its own progress threw the
    // user out of the page; `aria-disabled` says the same thing to a screen
    // reader and keeps them on it, and this is what stops the second send.
    if (pending) return;
    const out: Record<string, unknown> = {};
    for (const field of fields) {
      out[field.id] = fromDraft(field, values[field.id] ?? toDraft(field, undefined));
    }
    onSubmit({ status, fields: out });
  }

  return (
    <form onSubmit={handleSubmit} className="dynamic-item-form" aria-label={label}>
      <div className="form-row">
        <label htmlFor="item-status">{t("status_label")}</label>
        <select
          id="item-status"
          ref={statusRef}
          value={status}
          onChange={(e) => setStatus(e.target.value as ItemStatus)}
        >
          {ITEM_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`status_${s}`)}
            </option>
          ))}
        </select>
      </div>

      {fields.map((field) => (
        <FieldControl
          key={field.id}
          field={field}
          value={values[field.id] ?? ""}
          onChange={(v) => setValue(field.id, v)}
        />
      ))}

      <div className="form-actions">
        <button type="submit" className="touch-target" aria-disabled={pending || undefined}>
          {submitLabel ?? t("save")}
        </button>
        {onCancel && (
          <button type="button" className="touch-target button-quiet" onClick={onCancel}>
            {t("cancel")}
          </button>
        )}
      </div>
    </form>
  );
}

interface FieldControlProps {
  field: FieldDefinition;
  value: DraftValue;
  onChange: (value: DraftValue) => void;
}

function FieldControl({ field, value, onChange }: FieldControlProps) {
  const inputId = `field-${field.id}`;

  if (field.type === "boolean") {
    return (
      <div className="form-row">
        <label htmlFor={inputId} className="checkbox-row">
          <input id={inputId} type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} />
          {field.label}
        </label>
      </div>
    );
  }

  if (field.type === "select") {
    return (
      <div className="form-row">
        <label htmlFor={inputId}>{field.label}</label>
        <select id={inputId} value={String(value)} onChange={(e) => onChange(e.target.value)} required={field.required}>
          <option value="">—</option>
          {field.options.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      </div>
    );
  }

  if (field.type === "rating") {
    const ratings = Array.from({ length: field.max + 1 }, (_, i) => i);
    return (
      <div className="form-row">
        <label htmlFor={inputId}>{field.label}</label>
        <select id={inputId} value={String(value)} onChange={(e) => onChange(e.target.value)} required={field.required}>
          <option value="">—</option>
          {ratings.map((n) => (
            <option key={n} value={String(n)}>
              {n}
            </option>
          ))}
        </select>
      </div>
    );
  }

  if (field.type === "multiselect") {
    const selected = Array.isArray(value) ? value : [];
    return (
      <fieldset className="form-row">
        <legend>{field.label}</legend>
        {field.options.map((opt) => (
          <label key={opt} className="checkbox-row">
            <input
              type="checkbox"
              checked={selected.includes(opt)}
              onChange={(e) => onChange(e.target.checked ? [...selected, opt] : selected.filter((o) => o !== opt))}
            />
            {opt}
          </label>
        ))}
      </fieldset>
    );
  }

  const inputType =
    field.type === "number" || field.type === "currency"
      ? "number"
      : field.type === "date"
        ? "date"
        : field.type === "url" || field.type === "image"
          ? "url"
          : field.type === "email"
            ? "email"
            : "text";

  return (
    <div className="form-row">
      <label htmlFor={inputId}>{field.label}</label>
      <input
        id={inputId}
        type={inputType}
        value={String(value)}
        onChange={(e) => onChange(e.target.value)}
        required={field.required}
        step={field.type === "currency" ? "0.01" : undefined}
      />
    </div>
  );
}
