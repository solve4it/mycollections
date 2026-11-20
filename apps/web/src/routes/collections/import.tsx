import { type FieldDefinition, ITEM_STATUSES, type ItemStatus } from "@mycollections/core";
import { createRoute, Link } from "@tanstack/react-router";
import type { TFunction } from "i18next";
import { type ChangeEvent, type MouseEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FailureSurface } from "../../components/ErrorScreen.js";
import { FieldValue } from "../../components/FieldValue.js";
import { Icon } from "../../components/Icon.js";
import { CollectionDetailSkeleton } from "../../components/Skeleton.js";
import {
  type CellIssue,
  type ColumnTarget,
  type CsvReadFailure,
  type CsvTable,
  convertRows,
  fieldsCsvCannotFill,
  mappingProblems,
  readCsv,
  suggestMapping,
} from "../../lib/csv-import.js";
import { useFocusHandoff } from "../../lib/focus-handoff.js";
import { CONTENT_LINK_ACTIVE_OPTIONS } from "../../lib/links.js";
import { useCollection, useImportItems } from "../../lib/queries.js";
import { authenticatedRoute } from "../_authenticated.js";

export const importItemsRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: "/collections/$id/import",
  staticData: { titleKey: "collections:import_title" },
  component: ImportItemsPage,
});

/** How many rows the preview table shows, and how many skipped rows it lists. */
const PREVIEW_ROWS = 5;
const SKIPPED_SHOWN = 50;

const READ_ERROR_KEYS: Record<CsvReadFailure, string> = {
  "too-large": "import_read_error_too_large",
  encoding: "import_read_error_encoding",
  unreadable: "import_read_error_unreadable",
  empty: "import_read_error_empty",
  "too-many-rows": "import_read_error_too_many_rows",
  "too-many-columns": "import_read_error_too_many_columns",
};

const targetValue = (target: ColumnTarget) =>
  target.kind === "field" ? `field:${target.fieldId}` : target.kind === "status" ? "status" : "skip";

function parseTarget(value: string): ColumnTarget {
  if (value === "status") return { kind: "status" };
  if (value.startsWith("field:")) return { kind: "field", fieldId: value.slice("field:".length) };
  return { kind: "skip" };
}

/** Why a cell was refused, in words that say what the field wanted. */
function issueReason(
  t: TFunction<"collections">,
  issue: CellIssue,
  field: FieldDefinition | undefined,
  statusLabels: Record<ItemStatus, string>,
): string {
  if (issue === "extra-cells") return t("import_issue_extra_cells");
  if (issue === "required") return t("import_issue_required");
  if (issue === "too-long") return t("import_issue_too_long");
  if (!field)
    return t("import_issue_invalid_status", { statuses: ITEM_STATUSES.map((s) => statusLabels[s]).join(", ") });
  switch (field.type) {
    case "number":
    case "currency":
    case "boolean":
    case "date":
    case "url":
    case "email":
    case "select":
    case "multiselect":
      return t(`import_issue_invalid_${field.type}`);
    case "rating":
      return t("import_issue_invalid_rating", { max: field.max });
    default:
      return t("import_issue_invalid");
  }
}

interface ChosenFile {
  table: CsvTable;
  mapping: ColumnTarget[];
}

/**
 * Importing items from a CSV file into one collection (#44): choose a file, match
 * its columns to the collection's fields, check the preview, and add the rows
 * that convert. The rest are skipped and listed (the owner's call). Every cell is
 * typed with core's rules, which the server checks the rows against again.
 */
function ImportItemsPage() {
  const { id } = importItemsRoute.useParams();
  const { t } = useTranslation("collections");
  const { t: tItems } = useTranslation("items");
  const ids = useId();
  const fileHintId = `${ids}-file-hint`;
  const problemsId = `${ids}-problems`;
  const collectionQuery = useCollection(id);
  const collection = collectionQuery.data;
  const importItems = useImportItems(id);
  const handoff = useFocusHandoff();

  const [chosen, setChosen] = useState<ChosenFile | null>(null);
  const [readError, setReadError] = useState<CsvReadFailure | null>(null);
  const [done, setDone] = useState<{ created: number; skipped: number } | null>(null);
  const columnsHeadingRef = useRef<HTMLHeadingElement>(null);
  const doneHeadingRef = useRef<HTMLHeadingElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Which file choice is the latest: a slow read of an earlier file must not land over it.
  const latestRead = useRef(0);
  // Bumped on each file read, so the move into "Match columns" happens once per file.
  const [readCount, setReadCount] = useState(0);

  // Disclosure: a chosen file opens the mapping, and focus enters what opened.
  useEffect(() => {
    if (readCount > 0) columnsHeadingRef.current?.focus();
  }, [readCount]);

  const statusLabels = useMemo(
    () =>
      Object.fromEntries(ITEM_STATUSES.map((status) => [status, tItems(`status_${status}`)])) as Record<
        ItemStatus,
        string
      >,
    [tItems],
  );

  const fields = collection?.fields ?? [];
  const converted = useMemo(
    () => (chosen ? convertRows(chosen.table, chosen.mapping, fields, statusLabels) : null),
    [chosen, fields, statusLabels],
  );
  const problems = chosen ? mappingProblems(chosen.mapping, fields) : null;
  const blocked = problems !== null && (problems.missingRequired.length > 0 || problems.duplicateColumns.length > 0);
  const toAdd = converted?.items.length ?? 0;
  const pending = importItems.isPending;

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    if (pending) return;
    const file = event.target.files?.[0];
    // Reset so choosing the same file again (after fixing it) fires onChange.
    event.target.value = "";
    if (!file || !collection) return;
    importItems.reset();
    setDone(null);
    // Cleared first, so a second file refused for the same reason inserts its alert
    // anew and is announced again, rather than leaving the first one in place.
    setReadError(null);
    const read = ++latestRead.current;
    const result = await readCsv(file);
    if (read !== latestRead.current) return;
    if (!result.ok) {
      setChosen(null);
      setReadError(result.reason);
      return;
    }
    setReadError(null);
    const statusHeaders = ["status", tItems("status_label")];
    setChosen({ table: result.table, mapping: suggestMapping(result.table.headers, collection.fields, statusHeaders) });
    setReadCount((count) => count + 1);
  }

  function setTarget(column: number, value: string) {
    setChosen((current) =>
      current
        ? {
            ...current,
            mapping: current.mapping.map((target, index) => (index === column ? parseTarget(value) : target)),
          }
        : current,
    );
  }

  function handleImport(event: MouseEvent<HTMLButtonElement>) {
    // aria-disabled, not disabled: the button keeps focus and its name, and refuses here.
    if (pending || blocked || !converted || toAdd === 0 || !collection) return;
    const skipped = converted.rows.length - toAdd;
    const removing = event.currentTarget;
    importItems.mutateAsync(converted.items).then(
      (result) => {
        // The wizard goes, this button with it: focus moves to the heading that says what happened.
        handoff(() => doneHeadingRef.current, { removing });
        setDone({ created: result.created, skipped });
        setChosen(null);
      },
      // Read from the mutation's state below.
      () => {},
    );
  }

  function handleAnother(event: MouseEvent<HTMLButtonElement>) {
    handoff(() => fileInputRef.current, { removing: event.currentTarget });
    setDone(null);
  }

  const backLink = (
    <Link to="/collections/$id" params={{ id }} className="back-link" activeOptions={CONTENT_LINK_ACTIVE_OPTIONS}>
      <Icon name="back" />
      {collection ? tItems("back_to_named_collection", { name: collection.name }) : t("back_to_collection")}
    </Link>
  );

  if (!collection) {
    return (
      <div className="import-items-page">
        {backLink}
        {collectionQuery.error ? (
          <FailureSurface title={t("collection_error_title")} description={t("collection_error_description")} />
        ) : (
          <CollectionDetailSkeleton label={t("collection_loading")} count={1} />
        )}
      </div>
    );
  }

  // Decided with the owner: no column can fill a required image field, so the page
  // says so instead of offering a mapping whose Add could never be pressed.
  const imageFieldsRequired = fieldsCsvCannotFill(fields);
  if (imageFieldsRequired.length > 0) {
    return (
      <div className="import-items-page">
        {backLink}
        <h1>{t("import_heading", { name: collection.name })}</h1>
        {imageFieldsRequired.map((fieldId) => (
          <p key={fieldId}>
            {t("import_unavailable_image", { field: fields.find((field) => field.id === fieldId)?.label ?? "" })}
          </p>
        ))}
      </div>
    );
  }

  const columnLabel = (column: number) =>
    chosen?.table.headers[column] || t("import_column_unnamed", { number: column + 1 });
  const targetLabel = (target: ColumnTarget) =>
    target.kind === "status"
      ? t("import_target_status")
      : target.kind === "field"
        ? (fields.find((field) => field.id === target.fieldId)?.label ?? "")
        : "";
  const mappable = fields.filter((field) => field.type !== "image");
  const mappedColumns = chosen
    ? chosen.mapping.flatMap((target, column) => (target.kind === "skip" ? [] : [column]))
    : [];
  const skippedRows = converted ? converted.rows.flatMap((row) => (row.ok ? [] : [row])) : [];
  const previewRows = converted ? converted.rows.flatMap((row) => (row.ok ? [row] : [])).slice(0, PREVIEW_ROWS) : [];

  function errorKey(): string | null {
    if (!importItems.isError) return null;
    const status = (importItems.error as { status?: unknown } | null)?.status;
    if (status === 413) return "import_error_too_large";
    if (status === 404) return "import_error_gone";
    // The server re-checks every row against the collection's current fields, so a
    // refused row means they changed since the page loaded them.
    if (status === 400) return "import_error_changed";
    return "import_error";
  }
  const failure = errorKey();

  return (
    <div className="import-items-page">
      {backLink}
      <h1>{t("import_heading", { name: collection.name })}</h1>

      {done ? (
        <section className="import-items-done">
          <h2 ref={doneHeadingRef} tabIndex={-1}>
            {t("import_done", { count: done.created, name: collection.name })}
          </h2>
          {done.skipped > 0 && <p>{t("import_done_skipped", { count: done.skipped })}</p>}
          <button type="button" className="touch-target button-quiet" onClick={handleAnother}>
            <Icon name="import" />
            {t("import_another")}
          </button>
        </section>
      ) : (
        <>
          <div className="form-row">
            <label htmlFor={`${ids}-file`}>{t("import_file_label")}</label>
            <input
              id={`${ids}-file`}
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              className="touch-target"
              aria-describedby={fileHintId}
              aria-disabled={pending || undefined}
              onChange={handleFile}
            />
            <p id={fileHintId} className="form-hint">
              {t("import_file_hint")}
            </p>
          </div>
          {/* Inserted with its message inside: a role="alert" is announced on insertion. */}
          {readError && <p role="alert">{t(READ_ERROR_KEYS[readError])}</p>}

          {chosen && converted && problems && (
            <>
              <section className="import-items-columns" aria-labelledby={`${ids}-columns`}>
                <h2 id={`${ids}-columns`} ref={columnsHeadingRef} tabIndex={-1}>
                  {t("import_columns_heading")}
                </h2>
                <p className="form-hint">{t("import_columns_hint")}</p>
                {chosen.table.headers.map((_, column) => {
                  const selectId = `${ids}-column-${column}`;
                  const sampleId = `${selectId}-sample`;
                  const sample = chosen.table.rows.find((row) => (row[column] ?? "").trim() !== "")?.[column]?.trim();
                  const duplicate = problems.duplicateColumns.includes(column);
                  return (
                    // Columns never reorder or change while a file is chosen, so the index is stable.
                    // biome-ignore lint/suspicious/noArrayIndexKey: see above
                    <div className="form-row" key={column}>
                      <label htmlFor={selectId}>{columnLabel(column)}</label>
                      <select
                        id={selectId}
                        value={targetValue(chosen.mapping[column] ?? { kind: "skip" })}
                        aria-describedby={sampleId}
                        aria-invalid={duplicate || undefined}
                        onChange={(event) => setTarget(column, event.target.value)}
                      >
                        <option value="skip">{t("import_target_skip")}</option>
                        <option value="status">{t("import_target_status")}</option>
                        {mappable.map((field) => (
                          <option key={field.id} value={`field:${field.id}`}>
                            {field.label}
                          </option>
                        ))}
                      </select>
                      <p id={sampleId} className="form-hint">
                        {sample ? t("import_column_sample", { value: sample }) : t("import_column_sample_none")}
                      </p>
                    </div>
                  );
                })}
              </section>

              <section className="import-items-preview" aria-labelledby={`${ids}-preview`}>
                <h2 id={`${ids}-preview`}>{t("import_preview_heading")}</h2>
                <p>{t("import_summary_add", { count: toAdd })}</p>
                {skippedRows.length > 0 && <p>{t("import_summary_skip", { count: skippedRows.length })}</p>}
                {previewRows.length > 0 && (
                  <div className="table-scroll">
                    <table>
                      <caption>{t("import_preview_caption")}</caption>
                      <thead>
                        <tr>
                          <th scope="col">{t("import_preview_row")}</th>
                          {mappedColumns.map((column) => (
                            <th scope="col" key={column}>
                              {targetLabel(chosen.mapping[column] as ColumnTarget)}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {previewRows.map((row) => (
                          <tr key={row.row}>
                            <th scope="row">{row.row}</th>
                            {mappedColumns.map((column) => {
                              const target = chosen.mapping[column] as ColumnTarget;
                              return (
                                <td key={column}>
                                  {target.kind === "status" ? (
                                    tItems(`status_${row.item.status ?? "owned"}`)
                                  ) : (
                                    <FieldValue
                                      value={target.kind === "field" ? row.item.fields[target.fieldId] : null}
                                    />
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {skippedRows.length > 0 && (
                  <>
                    <h3 id={`${ids}-skipped`}>{t("import_skipped_heading")}</h3>
                    <ul className="import-items-skipped" aria-labelledby={`${ids}-skipped`}>
                      {skippedRows.slice(0, SKIPPED_SHOWN).map((row) => (
                        <li key={row.row}>
                          {t("import_skipped_row", { row: row.row })}
                          <ul>
                            {row.issues.map(({ column, issue }) => {
                              // Undefined for an extra cell past the header, which has no target.
                              const target = chosen.mapping[column];
                              const field =
                                target?.kind === "field" ? fields.find((f) => f.id === target.fieldId) : undefined;
                              return (
                                <li key={column}>
                                  {t("import_issue_cell", {
                                    column: columnLabel(column),
                                    reason: issueReason(t, issue, field, statusLabels),
                                  })}
                                </li>
                              );
                            })}
                          </ul>
                        </li>
                      ))}
                    </ul>
                    {skippedRows.length > SKIPPED_SHOWN && (
                      <p>{t("import_skipped_more", { count: skippedRows.length - SKIPPED_SHOWN })}</p>
                    )}
                  </>
                )}
              </section>

              <div className="import-items-submit">
                {/* Plain text, not a live region: it changes with each choice, and the
                    button it describes says so when it is reached. */}
                <div id={problemsId}>
                  {problems.missingRequired.map((fieldId) => (
                    <p key={fieldId} className="form-error">
                      {t("import_missing_required", { field: fields.find((f) => f.id === fieldId)?.label ?? "" })}
                    </p>
                  ))}
                  {[
                    ...new Set(
                      problems.duplicateColumns.map((column) => targetLabel(chosen.mapping[column] as ColumnTarget)),
                    ),
                  ].map((label) => (
                    <p key={label} className="form-error">
                      {t("import_duplicate", { target: label })}
                    </p>
                  ))}
                  {!blocked && toAdd === 0 && <p className="form-hint">{t("import_none_to_add")}</p>}
                </div>
                <button
                  type="button"
                  className="touch-target button-primary"
                  aria-disabled={pending || blocked || toAdd === 0 || undefined}
                  aria-describedby={problemsId}
                  onClick={handleImport}
                >
                  {t("import_submit", { count: blocked ? 0 : toAdd })}
                </button>
              </div>
            </>
          )}
          {failure && <p role="alert">{t(failure)}</p>}
        </>
      )}
    </div>
  );
}
