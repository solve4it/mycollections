import { useQueryClient } from "@tanstack/react-query";
import { type ChangeEvent, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAnnounce } from "../lib/announcer.js";
import type { ImportMode, ImportSummary } from "../lib/api-client.js";
import {
  isGone,
  isImportRunning,
  refreshAfterImport,
  useCurrentImport,
  useImportData,
  useImportJob,
} from "../lib/queries.js";
import { isZipFile } from "../lib/zip-file.js";
import { Icon } from "./Icon.js";

/** Milestones announced while images are processed: a quarter, a half, three quarters. The end has its own message. */
const MILESTONES = [25, 50, 75] as const;

/**
 * The import half of the Settings page's Data section (#45): choose a backup, follow an archive's
 * background job to its end (#452), optionally attaching photos to items that
 * are already here (#453).
 */
export function ImportBackup() {
  const { t } = useTranslation("settings");
  const queryClient = useQueryClient();
  const announce = useAnnounce();
  const ids = useId();
  const progressId = `${ids}-progress`;
  const attachHintId = `${ids}-attach-hint`;

  const importData = useImportData();
  const [attach, setAttach] = useState(false);
  const [invalidFile, setInvalidFile] = useState(false);
  // The job this page follows: one it started, or one still running when it opened.
  const [jobId, setJobId] = useState<string | null>(null);
  const current = useCurrentImport();
  const jobQuery = useImportJob(jobId);
  const job = jobId === null ? undefined : jobQuery.data;
  const lost = jobId !== null && isGone(jobQuery.error);
  const running = !lost && isImportRunning(job);
  const busy = importData.isPending || running;

  // A reload finds an import still under way and follows it. One that had already
  // finished before the page opened is not this visit's news, so it stays unsaid.
  // Only ever once, and never after the page has followed a job of its own: the
  // query is read once on mount, so later it still says "running" about a job
  // long done, and adopting it again would bring that job's result back over a
  // new import (review of #452).
  const adopted = useRef(false);
  const currentJob = current.data;
  useEffect(() => {
    if (adopted.current || currentJob === undefined) return;
    adopted.current = true;
    if (jobId === null && currentJob !== null && isImportRunning(currentJob)) setJobId(currentJob.id);
  }, [currentJob, jobId]);

  // The rows are in only once the job is done; the lists reload then, not at the 202.
  const refreshed = useRef<string | null>(null);
  useEffect(() => {
    if (job?.phase !== "done" || refreshed.current === job.id) return;
    refreshed.current = job.id;
    void refreshAfterImport(queryClient);
  }, [job, queryClient]);

  // A quarter at a time through the shell's announcer, never every image: a
  // screen reader user hears that it is moving without a running count.
  const announced = useRef<{ id: string; percent: number } | null>(null);
  useEffect(() => {
    if (job?.phase !== "images" || job.imagesTotal === 0) return;
    const percent = (job.imagesDone / job.imagesTotal) * 100;
    const reached = MILESTONES.filter((milestone) => percent >= milestone).at(-1);
    if (reached === undefined) return;
    const last = announced.current?.id === job.id ? announced.current.percent : 0;
    if (reached <= last) return;
    announced.current = { id: job.id, percent: reached };
    announce(t("import_milestone", { percent: reached }));
  }, [job, announce, t]);

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    // What `disabled` used to do (#368). A file input cannot refuse the picker
    // through ARIA, so the refusal is here: `aria-disabled` tells a screen
    // reader the control is busy and keeps it in the tab order, and a file
    // chosen while an import is uploading or running is ignored rather than
    // queued — the upload's answer is not the end of an archive import (#452).
    if (busy) return;
    const file = event.target.files?.[0];
    // Reset the input so re-selecting the same file fires onChange again.
    event.target.value = "";
    if (!file) return;

    setInvalidFile(false);
    adopted.current = true;
    setJobId(null);
    importData.reset();
    const mode: ImportMode = attach ? "attach-media" : "skip";
    const follow = (result: Awaited<ReturnType<typeof importData.mutateAsync>>) => {
      if ("job" in result) setJobId(result.job.id);
    };
    // Failures are read from the mutation's state; nothing more to do with them here.
    const ignore = () => {};
    // An export archive (#45) goes as it is; anything else must be a JSON backup.
    if (await isZipFile(file)) {
      importData.mutateAsync({ input: { archive: file }, mode }).then(follow, ignore);
      return;
    }
    let document: unknown;
    try {
      document = JSON.parse(await file.text());
    } catch {
      setInvalidFile(true);
      return;
    }
    importData.mutateAsync({ input: { document }, mode }).then(follow, ignore);
  }

  const summary: ImportSummary | null =
    importData.data && "summary" in importData.data
      ? importData.data.summary
      : job?.phase === "done"
        ? job.summary
        : null;

  const errorKey = failureKey();
  function failureKey(): string | null {
    if (invalidFile) return "import_error";
    if (importData.isError) {
      // Too large and busy are not "your file is broken", so they say what they are.
      // Read by status, as `ApiError` carries it; anything without one is a plain failure.
      const status = (importData.error as { status?: unknown } | null)?.status;
      return status === 413 ? "import_too_large" : status === 409 ? "import_busy" : "import_error";
    }
    if (lost) return "import_interrupted";
    if (job?.phase === "failed") return job.failure === "server" ? "import_server_error" : "import_error";
    return null;
  }

  const saving = job?.phase === "saving" || (running && job?.imagesTotal === 0);

  return (
    <>
      <p>{t("import_description")}</p>
      <div className="form-row">
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={attach}
            aria-describedby={attachHintId}
            onChange={(event) => setAttach(event.target.checked)}
          />
          {t("import_attach_label")}
        </label>
        <p id={attachHintId} className="form-hint">
          {t("import_attach_hint")}
        </p>
      </div>
      {/* The icon sits beside the file input rather than inside a styled
          label: restyling the picker itself belongs to the forms pass (#224). */}
      <div className="import-row">
        <Icon name="import" />
        <input
          id="import-file"
          type="file"
          accept=".zip,application/zip,.json,application/json"
          className="touch-target"
          aria-label={t("import_button")}
          aria-disabled={busy || undefined}
          onChange={handleFile}
        />
      </div>
      {/* Outside the live region (#452): the count changes with every poll, and
          inside it every change would be read out. Milestones go through the
          shell's announcer instead. While saving there is no count to give, so
          the bar loses its value and reads as indeterminate. */}
      {running && job && (
        <div className="import-progress">
          <label htmlFor={progressId}>{t("import_progress_label")}</label>
          <progress id={progressId} max={Math.max(job.imagesTotal, 1)} value={saving ? undefined : job.imagesDone} />
          <p className="form-hint">
            {saving ? t("import_saving") : t("import_progress", { done: job.imagesDone, total: job.imagesTotal })}
          </p>
        </div>
      )}
      {/* Always rendered, never conditional (#326). Both messages used to be
          `role="status"` nodes created with their text already inside them,
          and a live region inserted with content is announced by VoiceOver but
          usually not by NVDA or JAWS — so an import's progress, and its
          result, were announced to a fraction of the readers who needed them.
          The region is here from the section's first commit, empty, and the
          words arrive in it.

          No role on the region and none on what lands inside: `role="status"`
          implies `aria-live`, so a role on the message would make the message
          the nearest live region for its own insertion and lose the
          announcement. No `aria-atomic` either — the pending line is replaced
          in place by the summary, and atomic would re-read the whole region
          rather than what changed.

          No layout wrapper, unlike the undo toast's: this region is in normal
          flow with nothing to position, and an empty one is zero-height.

          The failure stays outside it. `role="alert"` is a live region in its
          own right, and a live region nested in a live region owns its own
          subtree, so the polite one would never speak for it. */}
      <div className="import-live" aria-live="polite">
        {busy && <p>{t("import_pending")}</p>}
        {summary && (
          <>
            <p>{t("import_success", { ...summary })}</p>
            {summary.mediaAttached > 0 && <p>{t("import_success_attached", { ...summary })}</p>}
            {summary.mediaOverLimit > 0 && <p>{t("import_success_over_limit", { ...summary })}</p>}
          </>
        )}
      </div>
      {errorKey && <p role="alert">{t(errorKey)}</p>}
    </>
  );
}
