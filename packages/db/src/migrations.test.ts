import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "./open-database.js";

const SHIPPED = fileURLToPath(new URL("../drizzle", import.meta.url));

interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
}

function readJournal(folder: string): { entries: JournalEntry[] } {
  return JSON.parse(readFileSync(join(folder, "meta", "_journal.json"), "utf8"));
}

const tmpDirs: string[] = [];

function makeTmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "mycollections-migrate-"));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** A copy of the shipped migrations that stops before the migration tagged `tag`. */
function migrationsBefore(dir: string, tag: string): string {
  const folder = join(dir, "migrations");
  cpSync(SHIPPED, folder, { recursive: true });
  const journal = readJournal(folder);
  const stop = journal.entries.findIndex((entry) => entry.tag === tag);
  expect(stop).toBeGreaterThan(0);
  journal.entries = journal.entries.slice(0, stop);
  writeFileSync(join(folder, "meta", "_journal.json"), JSON.stringify(journal));
  return folder;
}

describe("0002_target_count (#42)", () => {
  it("only adds a nullable column — no table rebuild that would drop the search triggers", () => {
    const sql = readFileSync(join(SHIPPED, "0002_target_count.sql"), "utf8");
    expect(sql.trim()).toBe("ALTER TABLE `collections` ADD `target_count` integer;");
  });

  it("follows the search migration in the journal", () => {
    const { entries } = readJournal(SHIPPED);
    const index = entries.findIndex((entry) => entry.tag === "0002_target_count");
    expect(index).toBe(2);
    const [previous, current] = [entries[index - 1], entries[index]];
    expect(previous?.tag).toBe("0001_items_fts");
    expect(current?.idx).toBe(2);
    expect(current && previous && current.when > previous.when).toBe(true);
  });

  it("upgrades a database holding collections and items, keeping every row and leaving targets empty", async () => {
    const dir = makeTmpDir();
    const path = join(dir, "app.db");

    // Seeded with raw SQL: the repositories now write target_count, which the
    // pre-migration table does not have.
    const before = await openDatabase({ path, migrationsFolder: migrationsBefore(dir, "0002_target_count") });
    const stamp = "2026-01-01T00:00:00.000Z";
    const insertCollection = before.sqlite.prepare(
      "INSERT INTO collections (id, name, description, fields, is_finite_set, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    );
    const fields = JSON.stringify([{ id: "title", type: "text", label: "Title", required: true }]);
    const quarters = "11111111-1111-4111-8111-111111111111";
    const books = "22222222-2222-4222-8222-222222222222";
    const trashed = "33333333-3333-4333-8333-333333333333";
    insertCollection.run(quarters, "Quarters", "State quarters", fields, 1, stamp, stamp, null);
    insertCollection.run(books, "Books", null, fields, 0, stamp, stamp, null);
    insertCollection.run(trashed, "Old", null, fields, 1, stamp, stamp, stamp);
    const insertItem = before.sqlite.prepare(
      "INSERT INTO items (id, collection_id, status, fields, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    insertItem.run(
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      quarters,
      "owned",
      '{"title":"Delaware"}',
      stamp,
      stamp,
      null,
    );
    insertItem.run(
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      quarters,
      "wanted",
      '{"title":"Hawaii"}',
      stamp,
      stamp,
      null,
    );
    insertItem.run("cccccccc-cccc-4ccc-8ccc-cccccccccccc", books, "owned", '{"title":"Dune"}', stamp, stamp, stamp);
    insertItem.run("dddddddd-dddd-4ddd-8ddd-dddddddddddd", trashed, "ordered", '{"title":"Gone"}', stamp, stamp, null);
    before.close();

    const after = await openDatabase({ path });
    try {
      const collections = await after.collections.list({ includeDeleted: true });
      expect(collections.map((c) => [c.id, c.name, c.isFiniteSet, c.targetCount, c.deletedAt])).toEqual([
        [quarters, "Quarters", true, null, null],
        [books, "Books", false, null, null],
        [trashed, "Old", true, null, stamp],
      ]);
      const counts = after.sqlite
        .prepare("SELECT (SELECT count(*) FROM collections) AS collections, (SELECT count(*) FROM items) AS items")
        .get();
      expect(counts).toEqual({ collections: 3, items: 4 });
      const titles = (await after.items.listByCollection(quarters, { includeDeleted: true })).map(
        (i) => i.fields.title,
      );
      expect(titles).toEqual(["Delaware", "Hawaii"]);
      // The search index survived: no rebuild of `items` dropped its triggers.
      const found = await after.items.listByCollection(quarters, { q: "hawaii" });
      expect(found.map((i) => i.fields.title)).toEqual(["Hawaii"]);
    } finally {
      after.close();
    }

    const backups = readdirSync(dir).filter((name) => name.endsWith(".bak"));
    expect(backups).toHaveLength(1);
    const backup = new Database(join(dir, backups[0] as string), { readonly: true });
    try {
      const columns = (backup.prepare("PRAGMA table_info(collections)").all() as { name: string }[]).map((c) => c.name);
      expect(columns).not.toContain("target_count");
      expect(backup.prepare("SELECT count(*) AS n FROM items").get()).toEqual({ n: 4 });
    } finally {
      backup.close();
    }
  });
});

describe("0003_media (#37)", () => {
  it("follows the target-count migration in the journal", () => {
    const { entries } = readJournal(SHIPPED);
    const index = entries.findIndex((entry) => entry.tag === "0003_media");
    expect(index).toBe(3);
    const [previous, current] = [entries[index - 1], entries[index]];
    expect(previous?.tag).toBe("0002_target_count");
    expect(current && previous && current.when > previous.when).toBe(true);
  });

  it("upgrades a database with items, replacing only the media table and leaving search intact", async () => {
    const dir = makeTmpDir();
    const path = join(dir, "app.db");
    const before = await openDatabase({ path, migrationsFolder: migrationsBefore(dir, "0003_media") });
    const stamp = "2026-01-01T00:00:00.000Z";
    const books = "22222222-2222-4222-8222-222222222222";
    const fields = JSON.stringify([{ id: "title", type: "text", label: "Title", required: true }]);
    before.sqlite
      .prepare(
        "INSERT INTO collections (id, name, description, fields, is_finite_set, target_count, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(books, "Books", null, fields, 0, null, stamp, stamp, null);
    before.sqlite
      .prepare(
        "INSERT INTO items (id, collection_id, status, fields, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run("cccccccc-cccc-4ccc-8ccc-cccccccccccc", books, "owned", '{"title":"Dune"}', stamp, stamp, null);
    before.close();

    const after = await openDatabase({ path });
    try {
      const columns = (
        after.sqlite.prepare("PRAGMA table_info(media)").all() as { name: string; notnull: number }[]
      ).map((c) => [c.name, c.notnull]);
      expect(columns).toEqual([
        ["id", 1],
        ["item_id", 1],
        ["kind", 1],
        ["source", 1],
        ["mime_type", 1],
        ["bytes", 1],
        ["width", 1],
        ["height", 1],
        ["position", 1],
        ["created_at", 1],
        ["deleted_at", 0],
      ]);
      // The cascade from items survived the replacement.
      const fks = after.sqlite.prepare("PRAGMA foreign_key_list(media)").all() as {
        table: string;
        on_delete: string;
      }[];
      expect(fks.map((fk) => [fk.table, fk.on_delete])).toEqual([["items", "CASCADE"]]);
      const found = await after.items.listByCollection(books, { q: "dune" });
      expect(found.map((i) => i.fields.title)).toEqual(["Dune"]);
    } finally {
      after.close();
    }
  });
});

describe("0004_item_view (#38)", () => {
  it("only adds a column with a default — no table rebuild that could fire the cascade to items", () => {
    const sql = readFileSync(join(SHIPPED, "0004_item_view.sql"), "utf8");
    expect(sql.trim()).toBe("ALTER TABLE `collections` ADD `item_view` text DEFAULT 'list' NOT NULL;");
  });

  it("follows the media migration in the journal", () => {
    const { entries } = readJournal(SHIPPED);
    const index = entries.findIndex((entry) => entry.tag === "0004_item_view");
    expect(index).toBe(4);
    const [previous, current] = [entries[index - 1], entries[index]];
    expect(previous?.tag).toBe("0003_media");
    expect(current && previous && current.when > previous.when).toBe(true);
  });

  it("upgrades a database holding collections, items and photos, giving every collection the list view", async () => {
    const dir = makeTmpDir();
    const path = join(dir, "app.db");
    const before = await openDatabase({ path, migrationsFolder: migrationsBefore(dir, "0004_item_view") });
    const stamp = "2026-01-01T00:00:00.000Z";
    const quarters = "11111111-1111-4111-8111-111111111111";
    const trashed = "33333333-3333-4333-8333-333333333333";
    const item = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const fields = JSON.stringify([{ id: "title", type: "text", label: "Title", required: true }]);
    const insertCollection = before.sqlite.prepare(
      "INSERT INTO collections (id, name, description, fields, is_finite_set, target_count, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    insertCollection.run(quarters, "Quarters", null, fields, 1, 50, stamp, stamp, null);
    insertCollection.run(trashed, "Old", null, fields, 0, null, stamp, stamp, stamp);
    before.sqlite
      .prepare(
        "INSERT INTO items (id, collection_id, status, fields, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(item, quarters, "owned", '{"title":"Delaware"}', stamp, stamp, null);
    before.sqlite
      .prepare(
        "INSERT INTO media (id, item_id, kind, source, mime_type, bytes, width, height, position, created_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        item,
        "image",
        "user-attached",
        "image/webp",
        10,
        4,
        3,
        0,
        stamp,
        null,
      );
    before.close();

    const after = await openDatabase({ path });
    try {
      const collections = await after.collections.list({ includeDeleted: true });
      expect(collections.map((c) => [c.id, c.targetCount, c.itemView, c.updatedAt, c.deletedAt])).toEqual([
        [quarters, 50, "list", stamp, null],
        [trashed, null, "list", stamp, stamp],
      ]);
      const counts = after.sqlite
        .prepare(
          "SELECT (SELECT count(*) FROM collections) AS collections, (SELECT count(*) FROM items) AS items, (SELECT count(*) FROM media) AS media",
        )
        .get();
      expect(counts).toEqual({ collections: 2, items: 1, media: 1 });
      const found = await after.items.listByCollection(quarters, { q: "delaware" });
      expect(found.map((i) => i.id)).toEqual([item]);
    } finally {
      after.close();
    }

    const backups = readdirSync(dir).filter((name) => name.endsWith(".bak"));
    expect(backups).toHaveLength(1);
  });
});
