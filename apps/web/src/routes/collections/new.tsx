import { BUILT_IN_FIELD_TYPES, type BuiltInFieldType, type FieldDefinition } from "@mycollections/core";
import { createRoute, redirect, useNavigate } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { getToken } from "../../lib/api-client.js";
import { useCreateCollection } from "../../lib/queries.js";
import { rootRoute } from "../__root.js";

export const newCollectionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/collections/new",
  beforeLoad: () => {
    if (!getToken()) throw redirect({ to: "/setup" });
  },
  component: NewCollectionPage,
});

interface FieldDraft {
  key: string;
  label: string;
  type: BuiltInFieldType;
  required: boolean;
  optionsText: string;
}

const TYPES_WITH_OPTIONS: BuiltInFieldType[] = ["select", "multiselect"];

function emptyField(): FieldDraft {
  return { key: crypto.randomUUID(), label: "", type: "text", required: false, optionsText: "" };
}

function parseOptions(text: string): string[] {
  return text
    .split(",")
    .map((o) => o.trim())
    .filter((o) => o.length > 0);
}

function buildField(draft: FieldDraft): FieldDefinition {
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

function NewCollectionPage() {
  const { t } = useTranslation("collections");
  const navigate = useNavigate();
  const createCollection = useCreateCollection();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isFiniteSet, setIsFiniteSet] = useState(false);
  const [fields, setFields] = useState<FieldDraft[]>([emptyField()]);

  function updateField(key: string, patch: Partial<FieldDraft>) {
    setFields((prev) => prev.map((f) => (f.key === key ? { ...f, ...patch } : f)));
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const labeled = fields.filter((f) => f.label.trim().length > 0);
    if (!name.trim() || labeled.length === 0) return;

    createCollection.mutate(
      {
        name: name.trim(),
        description: description.trim() || undefined,
        fields: labeled.map(buildField),
        isFiniteSet,
      },
      { onSuccess: () => navigate({ to: "/collections" }) },
    );
  }

  return (
    <div className="new-collection-page">
      <h1>{t("new_title")}</h1>
      <form onSubmit={handleSubmit}>
        <div className="form-row">
          <label htmlFor="collection-name">{t("name_label")}</label>
          <input
            id="collection-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("name_placeholder")}
            required
          />
        </div>

        <div className="form-row">
          <label htmlFor="collection-description">{t("description_label")}</label>
          <textarea id="collection-description" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>

        <div className="form-row">
          <label htmlFor="collection-finite" className="checkbox-row">
            <input
              id="collection-finite"
              type="checkbox"
              checked={isFiniteSet}
              onChange={(e) => setIsFiniteSet(e.target.checked)}
            />
            {t("finite_label")}
          </label>
        </div>

        <fieldset className="fields-builder">
          <legend>{t("fields_legend")}</legend>
          {fields.map((field, index) => {
            const labelId = `field-label-${index}`;
            const typeId = `field-type-${index}`;
            const optionsId = `field-options-${index}`;
            const requiredId = `field-required-${index}`;
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
                    onChange={(e) => updateField(field.key, { type: e.target.value as BuiltInFieldType })}
                  >
                    {BUILT_IN_FIELD_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {t(`field_types.${type}`)}
                      </option>
                    ))}
                  </select>
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
                  className="touch-target"
                  onClick={() => setFields((prev) => prev.filter((f) => f.key !== field.key))}
                >
                  {t("remove_field")}
                </button>
              </div>
            );
          })}
          <button type="button" className="touch-target" onClick={() => setFields((prev) => [...prev, emptyField()])}>
            {t("add_field")}
          </button>
        </fieldset>

        {createCollection.isError && <p role="alert">{t("submit_error")}</p>}

        <div className="form-actions">
          <button type="submit" className="touch-target" disabled={createCollection.isPending}>
            {t("submit")}
          </button>
        </div>
      </form>
    </div>
  );
}
