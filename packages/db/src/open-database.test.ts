import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "./open-database.js";

const MIGRATIONS = new URL("../drizzle", import.meta.url).pathname;

let tmp: string;
const tmpDirs: string[] = [];

function makeTmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "mycollections-db-"));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** Copies the real migrations folder and appends one extra migration to it. */
function migrationsWithExtra(dir: string): string {
  const folder = join(dir, "migrations-extra");
  cpSync(MIGRATIONS, folder, { recursive: true });
  writeFileSync(join(folder, "0001_extra.sql"), "CREATE TABLE extra_test (id text PRIMARY KEY);\n");
  const journalPath = join(folder, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8"));
  const last = journal.entries[journal.entries.length - 1];
  journal.entries.push({ ...last, idx: last.idx + 1, when: last.when + 1, tag: "0001_extra" });
  writeFileSync(journalPath, JSON.stringify(journal));
  return folder;
}

function backupsIn(dir: string): string[] {
  return readdirSync(dir).filter((f) => f.endsWith(".bak"));
}

describe("openDatabase", () => {
  it("runs migrations automatically so all phase-1 tables exist", async () => {
    const handle = await openDatabase({ path: ":memory:" });
    const tables = handle.sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((r) => (r as { name: string }).name);
    expect(tables).toEqual(expect.arrayContaining(["collections", "items", "media", "user_profile"]));
    handle.close();
  });

  it("enables WAL mode and foreign keys on file databases", async () => {
    tmp = makeTmpDir();
    const handle = await openDatabase({ path: join(tmp, "app.db") });
    expect(handle.sqlite.pragma("journal_mode", { simple: true })).toBe("wal");
    expect(handle.sqlite.pragma("foreign_keys", { simple: true })).toBe(1);
    handle.close();
  });

  it("does not create a backup for a fresh database", async () => {
    tmp = makeTmpDir();
    const handle = await openDatabase({ path: join(tmp, "app.db") });
    handle.close();
    expect(backupsIn(tmp)).toHaveLength(0);
  });

  it("does not create a backup when no migrations are pending", async () => {
    tmp = makeTmpDir();
    const path = join(tmp, "app.db");
    (await openDatabase({ path })).close();
    (await openDatabase({ path })).close();
    expect(backupsIn(tmp)).toHaveLength(0);
  });

  it("backs up an existing database before applying pending migrations", async () => {
    tmp = makeTmpDir();
    const path = join(tmp, "app.db");
    (await openDatabase({ path })).close();

    const handle = await openDatabase({ path, migrationsFolder: migrationsWithExtra(tmp) });
    const hasExtra = handle.sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'extra_test'")
      .get();
    handle.close();

    expect(hasExtra).toBeTruthy();
    expect(backupsIn(tmp)).toHaveLength(1);
    expect(existsSync(path)).toBe(true);
  });

  it("does not back up twice for the same migration", async () => {
    tmp = makeTmpDir();
    const path = join(tmp, "app.db");
    (await openDatabase({ path })).close();
    const folder = migrationsWithExtra(tmp);
    (await openDatabase({ path, migrationsFolder: folder })).close();
    (await openDatabase({ path, migrationsFolder: folder })).close();
    expect(backupsIn(tmp)).toHaveLength(1);
  });

  it("the pre-migration backup is itself an openable database", async () => {
    tmp = makeTmpDir();
    const path = join(tmp, "app.db");
    const first = await openDatabase({ path });
    await first.collections.create({
      name: "Books",
      fields: [{ id: "title", type: "text", label: "Title", required: true }],
      isFiniteSet: false,
    });
    first.close();

    (await openDatabase({ path, migrationsFolder: migrationsWithExtra(tmp) })).close();

    const [backup] = backupsIn(tmp);
    expect(backup).toBeDefined();
    const restored = await openDatabase({ path: join(tmp, backup as string) });
    expect(await restored.collections.list()).toHaveLength(1);
    restored.close();
  });
});
