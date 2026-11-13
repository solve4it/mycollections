import { randomUUID } from "node:crypto";
import { createReadStream, type ReadStream } from "node:fs";
import { chmod, mkdir, open, readdir, rename, rmdir, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { MediaFileRef } from "@mycollections/db";

export type MediaVariant = "display" | "thumb";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** The only names this store ever creates inside an item's folder. */
const OWN_FILE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(\.thumb)?\.webp$/;
const TEMP_FILE = /^\.[0-9a-f-]{36}\.tmp$/;

/**
 * How old an unreferenced file must be before a sweep takes it. An upload
 * writes its files and only then inserts the row naming them, so for a moment
 * every new image is unreferenced; a sweep running then (after a purge, say)
 * must not take it.
 */
export const SWEEP_GRACE_MS = 10 * 60 * 1000;

function assertId(value: string): void {
  // Ids come from route params already validated as UUIDs; this is the second
  // line, so no caller can ever build a path out of anything else.
  if (!UUID.test(value)) throw new TypeError("media paths are built from UUIDs only");
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

/**
 * Where image files live: `<dir>/<itemId>/<mediaId>.webp` and
 * `<mediaId>.thumb.webp` (#37). Every path is built from ids, never from
 * anything a client sent, and nothing is ever stored that names a path.
 *
 * Files are the owner's only (0600, folders 0700), like the database.
 */
export class MediaStore {
  readonly #dir: string;
  readonly #graceMs: number;

  private constructor(dir: string, graceMs: number) {
    this.#dir = dir;
    this.#graceMs = graceMs;
  }

  static async open(dir: string, options: { graceMs?: number } = {}): Promise<MediaStore> {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    // `mode` applies only to folders mkdir creates; tighten one that already existed.
    await chmod(dir, 0o700);
    return new MediaStore(dir, options.graceMs ?? SWEEP_GRACE_MS);
  }

  #path(itemId: string, mediaId: string, variant: MediaVariant): string {
    assertId(itemId);
    assertId(mediaId);
    return join(this.#dir, itemId, variant === "thumb" ? `${mediaId}.thumb.webp` : `${mediaId}.webp`);
  }

  /**
   * Writes both files or neither. Each goes to a temporary name in the same
   * folder first — a rename across filesystems fails, so never the system temp
   * directory — and is renamed into place; on any failure everything this call
   * wrote is removed before the error goes on.
   */
  async write(itemId: string, mediaId: string, files: { display: Buffer; thumb: Buffer }): Promise<void> {
    const finals = { display: this.#path(itemId, mediaId, "display"), thumb: this.#path(itemId, mediaId, "thumb") };
    const folder = join(this.#dir, itemId);
    await mkdir(folder, { recursive: true, mode: 0o700 });
    const temps = { display: join(folder, `.${randomUUID()}.tmp`), thumb: join(folder, `.${randomUUID()}.tmp`) };
    try {
      for (const variant of ["display", "thumb"] as const) {
        await writeFile(temps[variant], files[variant], { mode: 0o600, flag: "wx" });
        await rename(temps[variant], finals[variant]);
      }
    } catch (error) {
      await Promise.all(
        [...Object.values(temps), ...Object.values(finals)].map((path) => unlink(path).catch(() => {})),
      );
      throw error;
    }
  }

  /** A stream of the file, or null when it is not on disk (a row can outlive its files after a restore from backup). */
  async read(itemId: string, mediaId: string, variant: MediaVariant): Promise<ReadStream | null> {
    const path = this.#path(itemId, mediaId, variant);
    try {
      const handle = await open(path, "r");
      return createReadStream("", { fd: handle.fd, autoClose: true });
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  }

  async remove(itemId: string, mediaId: string): Promise<void> {
    const paths = [this.#path(itemId, mediaId, "display"), this.#path(itemId, mediaId, "thumb")];
    await Promise.all(
      paths.map((path) =>
        unlink(path).catch((error) => {
          if (!isMissing(error)) throw error;
        }),
      ),
    );
  }

  /**
   * Removes every file this store made that no row names any more — the files
   * of purged items and images, and temporary files a crash left behind — and
   * any item folder that ends up empty. Answers how many files it removed.
   *
   * Only names this store creates are ever touched: a stranger's file, a folder
   * that is not an item id, anything at all if the directory was pointed at the
   * wrong place, is left exactly where it is. And nothing newer than the grace
   * period goes, since that may be an upload whose row is a moment away.
   */
  async sweep(refs: readonly MediaFileRef[]): Promise<number> {
    const keep = new Map<string, Set<string>>();
    for (const ref of refs) {
      const ids = keep.get(ref.itemId) ?? new Set<string>();
      ids.add(ref.id);
      keep.set(ref.itemId, ids);
    }
    const cutoff = Date.now() - this.#graceMs;
    let removed = 0;

    for (const entry of await readdir(this.#dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || !UUID.test(entry.name)) continue;
      const folder = join(this.#dir, entry.name);
      const kept = keep.get(entry.name);
      for (const file of await readdir(folder, { withFileTypes: true })) {
        if (!file.isFile()) continue;
        const own = OWN_FILE.exec(file.name);
        const orphan = TEMP_FILE.test(file.name) || (own !== null && !kept?.has(own[1] as string));
        if (!orphan) continue;
        const path = join(folder, file.name);
        try {
          if ((await stat(path)).mtimeMs > cutoff) continue;
          await unlink(path);
          removed += 1;
        } catch (error) {
          if (!isMissing(error)) throw error;
        }
      }
      // Only succeeds when empty, which is exactly when it should.
      await rmdir(folder).catch(() => {});
    }
    return removed;
  }
}
