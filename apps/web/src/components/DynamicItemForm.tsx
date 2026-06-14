import { type FieldDefinition, ITEM_STATUSES, type ItemStatus } from "@mycollections/core";
import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ItemInput } from "../lib/api-client.js";

type DraftValue = string | boolean | string[];

interface DynamicItemFormProps {
  fields: FieldDefinition[];
  onSubmit: (payload: ItemInput) => void;
  initialStatus?: ItemStatus;
  initialValues?: Record<string, unknown>;
  submitLabel?: string;
  onCancel?: () => void;
  pending?: boolean;
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
  onCancel,
  pending = false,
}: DynamicItemFormProps) {
  const { t } = useTranslation("items");
  const [status, setStatus] = useState<ItemStatus>(initialStatus ?? "owned");
  const [values, setValues] = useState<Record<string, DraftValue>>(() =>
    Object.fromEntries(fields.map((f) => [f.id, toDraft(f, initialValues[f.id])])),
  );

  function setValue(id: string, value: DraftValue) {
    setValues((prev) => ({ ...prev, [id]: value }));
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const out: Record<string, unknown> = {};
    for (const field of fields) {
      out[field.id] = fromDraft(field, values[field.id] ?? toDraft(field, undefined));
    }
    onSubmit({ status, fields: out });
  }

  return (
    <form onSubmit={handleSubmit} className="dynamic-item-form">
      <div className="form-row">
        <label htmlFor="item-status">{t("status_label")}</label>
        <select id="item-status" value={status} onChange={(e) => setStatus(e.target.value as ItemStatus)}>
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
        <button type="submit" className="touch-target" disabled={pending}>
          {submitLabel ?? t("save")}
        </button>
        {onCancel && (
          <button type="button" className="touch-target" onClick={onCancel}>
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
