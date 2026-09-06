import { createRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { buildField, type FieldDraft, FieldSchemaBuilder, fieldToDraft } from "../../components/FieldSchemaBuilder.js";
import { Icon } from "../../components/Icon.js";
import { CollectionDetailSkeleton } from "../../components/Skeleton.js";
import { getToken } from "../../lib/api-client.js";
import { useCollection, useItems, useTrash, useUpdateCollection } from "../../lib/queries.js";
import { rootRoute } from "../__root.js";

export const editCollectionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/collections/$id/edit",
  staticData: { titleKey: "collections:edit_title" },
  beforeLoad: () => {
    if (!getToken()) throw redirect({ to: "/setup" });
  },
  component: EditCollectionPage,
});

function EditCollectionPage() {
  const { id } = editCollectionRoute.useParams();
  const { t } = useTranslation("collections");
  const navigate = useNavigate();
  const collectionQuery = useCollection(id);
  const itemsQuery = useItems(id);
  const trashQuery = useTrash();
  const updateCollection = useUpdateCollection(id);

  const collection = collectionQuery.data;

  // Editing starts from the stored schema, so the drafts are seeded once the
  // collection arrives rather than held in state from the first render.
  const [draft, setDraft] = useState<{
    loadedFrom: string;
    name: string;
    description: string;
    isFiniteSet: boolean;
    fields: FieldDraft[];
  } | null>(null);

  if (collection && draft?.loadedFrom !== collection.id) {
    setDraft({
      loadedFrom: collection.id,
      name: collection.name,
      description: collection.description ?? "",
      isFiniteSet: collection.isFiniteSet,
      fields: collection.fields.map(fieldToDraft),
    });
  }

  if (collection === undefined || draft === null) {
    if (collectionQuery.error)
      return (
        <div role="alert">
          <h1>{t("error_title")}</h1>
          <p>{t("error_description")}</p>
        </div>
      );
    return (
      <div className="edit-collection-page">
        <Link to="/collections" className="back-link">
          <Icon name="back" />
          {t("back_to_collections")}
        </Link>
        <CollectionDetailSkeleton label={t("loading")} />
      </div>
    );
  }

  // Whether any value is filed under these field ids decides whether a type may
  // still change. Trashed items count: restoring one would bring back values the
  // retyped control could not read, which is exactly why the server refuses it.
  // A failed count locks rather than guesses — offering an edit the server will
  // reject is worse than withholding one it might have allowed.
  const countsFailed = itemsQuery.error != null || trashQuery.error != null;
  const countsKnown = itemsQuery.data !== undefined && trashQuery.data !== undefined;
  if (!countsKnown && !countsFailed) {
    return (
      <div className="edit-collection-page">
        <CollectionDetailSkeleton label={t("loading")} />
      </div>
    );
  }
  const hasItems =
    countsFailed ||
    (itemsQuery.data?.length ?? 0) > 0 ||
    (trashQuery.data?.items ?? []).some((deleted) => deleted.collectionId === id);
  const storedFieldKeys = new Set(collection.fields.map((field) => field.id));
  const lockedTypeKeys = hasItems ? storedFieldKeys : undefined;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (draft === null) return;
    const labeled = draft.fields.filter((f) => f.label.trim().length > 0);
    if (!draft.name.trim() || labeled.length === 0) return;

    updateCollection.mutate(
      {
        name: draft.name.trim(),
        // Sent even when empty: a cleared description has to clear the stored
        // one, and an omitted key would leave the old text in place.
        description: draft.description.trim(),
        fields: labeled.map(buildField),
        isFiniteSet: draft.isFiniteSet,
      },
      { onSuccess: () => navigate({ to: "/collections/$id", params: { id } }) },
    );
  }

  return (
    <div className="edit-collection-page">
      <Link to="/collections/$id" params={{ id }} className="back-link">
        <Icon name="back" />
        {t("back_to_collection")}
      </Link>
      <h1>{t("edit_title")}</h1>
      <form onSubmit={handleSubmit}>
        <div className="form-row">
          <label htmlFor="collection-name">{t("name_label")}</label>
          <input
            id="collection-name"
            type="text"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            required
          />
        </div>

        <div className="form-row">
          <label htmlFor="collection-description">{t("description_label")}</label>
          <textarea
            id="collection-description"
            value={draft.description}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
          />
        </div>

        <div className="form-row">
          <label htmlFor="collection-finite" className="checkbox-row">
            <input
              id="collection-finite"
              type="checkbox"
              checked={draft.isFiniteSet}
              onChange={(e) => setDraft({ ...draft, isFiniteSet: e.target.checked })}
            />
            {t("finite_label")}
          </label>
        </div>

        <FieldSchemaBuilder
          fields={draft.fields}
          onChange={(fields) => setDraft({ ...draft, fields })}
          lockedTypeKeys={lockedTypeKeys}
          lockedTypeHint={t("field_type_locked")}
        />
        <p className="form-hint">{t("remove_field_note")}</p>

        {updateCollection.isError && <p role="alert">{t("save_error")}</p>}

        <div className="form-actions">
          <button type="submit" className="touch-target" disabled={updateCollection.isPending}>
            {t("save")}
          </button>
        </div>
      </form>
    </div>
  );
}
