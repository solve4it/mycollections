import { createRoute, redirect, useNavigate } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { buildField, emptyField, type FieldDraft, FieldSchemaBuilder } from "../../components/FieldSchemaBuilder.js";
import { FiniteSetFields, targetCountFromDraft } from "../../components/FiniteSetFields.js";
import { getToken } from "../../lib/api-client.js";
import { useCreateCollection } from "../../lib/queries.js";
import { rootRoute } from "../__root.js";

export const newCollectionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/collections/new",
  staticData: { titleKey: "collections:new_title" },
  beforeLoad: () => {
    if (!getToken()) throw redirect({ to: "/setup" });
  },
  component: NewCollectionPage,
});

function NewCollectionPage() {
  const { t } = useTranslation("collections");
  const navigate = useNavigate();
  const createCollection = useCreateCollection();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isFiniteSet, setIsFiniteSet] = useState(false);
  const [targetCount, setTargetCount] = useState("");
  const [fields, setFields] = useState<FieldDraft[]>([emptyField()]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    // What `disabled` used to do, without taking focus off the button (#368).
    if (createCollection.isPending) return;
    const labeled = fields.filter((f) => f.label.trim().length > 0);
    if (!name.trim() || labeled.length === 0) return;

    createCollection.mutate(
      {
        name: name.trim(),
        description: description.trim() || undefined,
        fields: labeled.map(buildField),
        isFiniteSet,
        // Always sent, `null` when there is none: one rule for both forms, and
        // the server's default would land on the same value anyway (#42).
        targetCount: targetCountFromDraft(isFiniteSet, targetCount),
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

        <FiniteSetFields
          isFiniteSet={isFiniteSet}
          targetCount={targetCount}
          onFiniteSetChange={setIsFiniteSet}
          onTargetCountChange={setTargetCount}
        />

        <FieldSchemaBuilder fields={fields} onChange={setFields} />

        {createCollection.isError && <p role="alert">{t("submit_error")}</p>}

        <div className="form-actions">
          <button type="submit" className="touch-target" aria-disabled={createCollection.isPending || undefined}>
            {t("submit")}
          </button>
        </div>
      </form>
    </div>
  );
}
