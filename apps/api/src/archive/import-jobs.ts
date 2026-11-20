import { randomUUID } from "node:crypto";
import type { ImportSummary } from "@mycollections/db";

/**
 * Where a background archive import is (#452). "images" processes and writes
 * each image's files; "saving" is the one database transaction; "done" and
 * "failed" are final.
 */
export type ImportPhase = "images" | "saving" | "done" | "failed";

/**
 * Why a job failed, as a fixed word and never a message (#45): Zod and SQLite
 * messages quote what was in the file. "invalid" is the file's fault (an image
 * the pipeline refused, a row the database refused); "server" is the server's (a
 * full disk, a permission, a shutdown).
 */
export type ImportFailure = "invalid" | "server";

/** What `GET /api/import/:jobId` answers with. */
export interface ImportJobState {
  id: string;
  phase: ImportPhase;
  imagesDone: number;
  imagesTotal: number;
  summary: ImportSummary | null;
  failure: ImportFailure | null;
}

/** What a running job's work can see and report through. */
export interface JobControl {
  /** True once the server is closing; the work stops at its next check. */
  readonly aborted: boolean;
  imageDone(done: number): void;
  saving(): void;
}

interface Slot {
  state: ImportJobState;
  aborted: boolean;
  done: Promise<void>;
}

/**
 * The one import slot (#452). One import at a time, JSON and archive alike: a
 * plan holds only while nothing else adds the items it decided to bring images
 * in with (review of #449). The slot is busy from the moment an upload is
 * accepted (`claim`) until its job ends — across the 202, so the lock and the
 * job's state can never disagree.
 *
 * In memory only, and only the latest job: a restart already clears the
 * uploaded archives (`MediaStore.clearImports`), so a persisted job could never
 * resume, and keeping one finished job bounds the memory.
 */
export class ImportJobs {
  #claimed = false;
  #slot: Slot | null = null;

  get busy(): boolean {
    return this.#claimed || this.#running;
  }

  get #running(): boolean {
    const phase = this.#slot?.state.phase;
    return phase === "images" || phase === "saving";
  }

  /** Takes the lock for an upload being received and checked. False if anything holds it. */
  claim(): boolean {
    if (this.busy) return false;
    this.#claimed = true;
    return true;
  }

  /** Gives up a claim that never became a job. */
  release(): void {
    this.#claimed = false;
  }

  /**
   * Turns the claim into a running job and starts `work` in the background. The
   * work's outcome only ever lands in the job's state: it never rejects into the
   * void, where Node would end the process. `cleanup` runs after the work,
   * before the job reads as finished, so the next import never sees its archive.
   */
  start(
    imagesTotal: number,
    work: (control: JobControl) => Promise<ImportSummary>,
    options: { cleanup: () => Promise<void>; classify: (error: unknown) => ImportFailure },
  ): ImportJobState {
    const state: ImportJobState = {
      id: randomUUID(),
      phase: "images",
      imagesDone: 0,
      imagesTotal,
      summary: null,
      failure: null,
    };
    const slot: Slot = { state, aborted: false, done: Promise.resolve() };
    const control: JobControl = {
      get aborted() {
        return slot.aborted;
      },
      imageDone(done) {
        state.imagesDone = done;
      },
      saving() {
        state.phase = "saving";
      },
    };
    this.#slot = slot;
    this.#claimed = false;
    slot.done = (async () => {
      let summary: ImportSummary | null = null;
      let failure: ImportFailure | null = null;
      try {
        summary = await work(control);
      } catch (error) {
        try {
          failure = options.classify(error);
        } catch {
          failure = "server";
        }
      }
      try {
        await options.cleanup();
      } catch {
        // The archive is left for the next startup's `clearImports`; the import's
        // own outcome stands.
      }
      state.summary = summary;
      state.failure = failure;
      state.phase = failure === null ? "done" : "failed";
    })();
    return { ...state };
  }

  /** A copy of the job's state, or null if it is not the latest job. */
  get(id: string): ImportJobState | null {
    return this.#slot?.state.id === id ? { ...this.#slot.state } : null;
  }

  /** The running job, or the last one to finish; null before any. */
  current(): ImportJobState | null {
    return this.#slot ? { ...this.#slot.state } : null;
  }

  /** Stops a running job at its next check and waits for it to clean up. */
  async shutdown(): Promise<void> {
    if (!this.#slot) return;
    this.#slot.aborted = true;
    await this.#slot.done;
  }
}
