import { COLLECTION_DESCRIPTION_MAX, COLLECTION_NAME_MAX } from "@mycollections/core";
import { createRoute, redirect, useNavigate } from "@tanstack/react-router";
import { type FormEvent, useRef, useState } from "react";
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
  const [noFieldsRefused, setNoFieldsRefused] = useState(false);
  const addFieldRef = useRef<HTMLButtonElement>(null);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    // What `disabled` used to do, without taking focus off the button (#368).
    if (createCollection.isPending) return;
    // A blank name or label never reaches here: each box is invalid, and the
    // browser stops the submit at it. No field box is left to mark when every
    // field has been removed, so that one is said at Add field (#42).
    if (fields.length === 0) {
      setNoFieldsRefused(true);
      addFieldRef.current?.focus();
      return;
    }

    createCollection.mutate(
      {
        name: name.trim(),
        description: description.trim() || undefined,
        fields: fields.map(buildField),
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
            maxLength={COLLECTION_NAME_MAX}
            ref={(input) => {
              // `required` lets a name of spaces through, which the submit
              // handler then refused without a word. Marking it invalid makes
              // the browser stop the submit and say why, as it does for an empty
              // box; set on every render, so it never outlives the problem.
              input?.setCustomValidity(name !== "" && name.trim() === "" ? t("name_blank") : "");
            }}
          />
        </div>

        <div className="form-row">
          <label htmlFor="collection-description">{t("description_label")}</label>
          <textarea
            id="collection-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={COLLECTION_DESCRIPTION_MAX}
          />
        </div>

        <FiniteSetFields
          isFiniteSet={isFiniteSet}
          targetCount={targetCount}
          onFiniteSetChange={setIsFiniteSet}
          onTargetCountChange={setTargetCount}
        />

        <FieldSchemaBuilder
          fields={fields}
          onChange={(next) => {
            setFields(next);
            if (next.length > 0) setNoFieldsRefused(false);
          }}
          noFieldsError={noFieldsRefused ? t("fields_none") : undefined}
          addFieldRef={addFieldRef}
        />

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
