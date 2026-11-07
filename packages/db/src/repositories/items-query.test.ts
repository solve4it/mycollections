import type { Collection, FieldDefinition, Item } from "@mycollections/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type DatabaseHandle, openDatabase } from "../open-database.js";
import { InvalidItemQueryError } from "./items.js";

const fields: FieldDefinition[] = [
  { id: "title", type: "text", label: "Title", required: true },
  { id: "pages", type: "number", label: "Pages", required: false },
  { id: "read", type: "boolean", label: "Read", required: false },
  { id: "link", type: "url", label: "Link", required: false },
  { id: "tags", type: "tags", label: "Tags", required: false },
  { id: "genre", type: "select", label: "Genre", required: false, options: ["Fiction", "History"] },
  { id: "stars", type: "rating", label: "Stars", required: false, max: 5 },
];

let handle: DatabaseHandle;
let books: Collection;

beforeEach(async () => {
  handle = await openDatabase({ path: ":memory:" });
  books = await handle.collections.create({ name: "Books", fields, isFiniteSet: false });
});

afterEach(() => {
  handle.close();
});

async function add(values: Record<string, unknown>, collection: Collection = books): Promise<Item> {
  return handle.items.create({ collectionId: collection.id, fields: values });
}

async function titles(options: Parameters<DatabaseHandle["items"]["listByCollection"]>[1]): Promise<unknown[]> {
  const items = await handle.items.listByCollection(books.id, options);
  return items.map((item) => item.fields.title ?? null);
}

describe("ItemsRepository search (q)", () => {
  beforeEach(async () => {
    await add({ title: "Dune", genre: "Fiction", tags: ["desert", "classic"], pages: 412 });
    await add({ title: "Café Society", genre: "History", tags: ["paris"] });
    await add({ title: "Foundation", genre: "Fiction", link: "https://example.com/dune-review", read: true });
  });

  it("matches a word prefix, case- and accent-insensitively", async () => {
    expect(await titles({ q: "dun" })).toEqual(["Dune"]);
    expect(await titles({ q: "CAFE" })).toEqual(["Café Society"]);
  });

  it("requires every term to match (AND)", async () => {
    expect(await titles({ q: "fiction desert" })).toEqual(["Dune"]);
    expect(await titles({ q: "fiction paris" })).toEqual([]);
  });

  it("searches select values, tag values and numbers", async () => {
    expect(await titles({ q: "history" })).toEqual(["Café Society"]);
    expect(await titles({ q: "classic" })).toEqual(["Dune"]);
    expect(await titles({ q: "412" })).toEqual(["Dune"]);
  });

  it("does not search urls, booleans, field ids or labels", async () => {
    // "dune" appears only inside Foundation's url, so Foundation must not match.
    expect(await titles({ q: "dune" })).toEqual(["Dune"]);
    expect(await titles({ q: "example" })).toEqual([]);
    expect(await titles({ q: "true" })).toEqual([]);
    expect(await titles({ q: "genre" })).toEqual([]);
    expect(await titles({ q: "Title" })).toEqual([]);
  });

  it("searches a number stored in a text field, as the name sort already reads it", async () => {
    await add({ title: 1984 });
    expect(await titles({ q: "1984" })).toEqual([1984]);
  });

  it("does not search values whose key is not in the collection's schema", async () => {
    await add({ title: "Emma", leftover: "orphaned" });
    expect(await titles({ q: "orphaned" })).toEqual([]);
  });

  it("re-indexes when a collection's schema changes", async () => {
    await add({ title: "Emma", note: "regency" });
    expect(await titles({ q: "regency" })).toEqual([]);

    await handle.collections.update(books.id, {
      fields: [...fields, { id: "note", type: "text", label: "Note", required: false }],
    });
    expect(await titles({ q: "regency" })).toEqual(["Emma"]);

    await handle.collections.update(books.id, { fields: fields.filter((f) => f.id !== "genre") });
    expect(await titles({ q: "history" })).toEqual([]);
  });

  it("re-indexes an item when its fields change", async () => {
    const [dune] = await handle.items.listByCollection(books.id, { q: "dune" });
    await handle.items.update(dune?.id as string, { fields: { title: "Arrival" } });
    expect(await titles({ q: "dune" })).toEqual([]);
    expect(await titles({ q: "arrival" })).toEqual(["Arrival"]);
  });

  it("only searches the collection asked for, and leaves out trashed items", async () => {
    const movies = await handle.collections.create({ name: "Movies", fields, isFiniteSet: false });
    await add({ title: "Dune (film)" }, movies);
    const [dune] = await handle.items.listByCollection(books.id, { q: "dune" });
    expect(await titles({ q: "dune" })).toEqual(["Dune"]);

    await handle.items.softDelete(dune?.id as string);
    expect(await titles({ q: "dune" })).toEqual([]);
    expect(await titles({ q: "dune", includeDeleted: true })).toEqual(["Dune"]);
  });

  it("drops a purged collection's items from the index", async () => {
    await handle.sqlite.prepare("DELETE FROM collections WHERE id = ?").run(books.id);
    const row = handle.sqlite.prepare("SELECT count(*) AS n FROM items_fts").get() as { n: number };
    expect(row.n).toBe(0);
  });

  it("indexes items restored from a backup", async () => {
    const [dune] = await handle.items.listByCollection(books.id, { q: "dune" });
    await handle.items.hardDelete(dune?.id as string);
    handle.items.insertImported(dune as Item);
    expect(await titles({ q: "dune" })).toEqual(["Dune"]);
  });

  it("ranks the denser match first when no sort is asked for", async () => {
    await add({ title: "Spice", genre: "Fiction", tags: ["spice", "spice trade"] });
    const ranked = await titles({ q: "spice" });
    expect(ranked).toEqual(["Spice"]);
    await add({ title: "Spice Spice Spice Spice" });
    expect(await titles({ q: "spice" })).toEqual(["Spice Spice Spice Spice", "Spice"]);
  });

  it.each([
    ['"', "quote"],
    ['du"ne', "embedded quote"],
    ["NEAR(dune foundation)", "operator syntax"],
    ["title:dune", "column filter"],
    ["{title}:dune ^dune -dune dune*", "fts punctuation"],
    ["dune AND OR NOT", "boolean keywords"],
    ["a\u0000b", "NUL byte"],
    ["\u{1F600} \uD800", "emoji and lone surrogate"],
    ["x".repeat(200), "a long token"],
  ])("treats %j (%s) as literal text and never throws", async (q) => {
    await expect(handle.items.listByCollection(books.id, { q })).resolves.toBeInstanceOf(Array);
  });

  it("treats a query with no letters or digits as no search at all", async () => {
    expect(await titles({ q: "  - & !  " })).toHaveLength(3);
    expect(await titles({ q: "" })).toHaveLength(3);
  });

  it("ignores everything past the tenth distinct term", async () => {
    // Repeats collapse first, so they cannot push a real term out of the ten.
    const repeats = [...Array.from({ length: 10 }, () => "dune"), "absent"].join(" ");
    expect(await titles({ q: repeats })).toEqual([]);
    const eleven = ["d", "du", "dun", "dune", "f", "fi", "fic", "fiction", "des", "desert", "absent"].join(" ");
    expect(await titles({ q: eleven })).toEqual(["Dune"]);
  });

  it("can rebuild the index from scratch", async () => {
    handle.sqlite.exec("DELETE FROM items_fts");
    expect(await titles({ q: "dune" })).toEqual([]);
    handle.items.reindex();
    expect(await titles({ q: "dune" })).toEqual(["Dune"]);
  });
});

describe("the search index's triggers", () => {
  it("exist after every migration has run", () => {
    const names = handle.sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name")
      .all()
      .map((row) => (row as { name: string }).name);
    expect(names).toEqual([
      "collections_fields_reindex",
      "items_fts_after_insert",
      "items_fts_after_update",
      "items_fts_before_delete",
    ]);
  });
});

describe("ItemsRepository sort", () => {
  it("keeps insertion order by default, even for items created in the same millisecond", async () => {
    for (const title of ["c", "a", "b", "e", "d"]) await add({ title });
    expect(await titles({})).toEqual(["c", "a", "b", "e", "d"]);
    expect(await titles({ sort: { key: "createdAt", direction: "desc" } })).toEqual(["d", "e", "b", "a", "c"]);
  });

  it("orders by last update", async () => {
    const first = await add({ title: "first" });
    await add({ title: "second" });
    await new Promise((resolve) => setTimeout(resolve, 2));
    await handle.items.update(first.id, { status: "wanted" });
    expect(await titles({ sort: { key: "updatedAt", direction: "desc" } })).toEqual(["first", "second"]);
  });

  it("orders by name — the first schema field with a scalar value — ignoring case", async () => {
    await add({ title: "banana" });
    await add({ pages: 7 });
    await add({ title: "Apple" });
    await add({ tags: ["only", "tags"] });
    const items = await handle.items.listByCollection(books.id, { sort: { key: "name", direction: "asc" } });
    expect(items.map((i) => i.fields.title ?? i.fields.pages ?? null)).toEqual([7, "Apple", "banana", null]);
  });

  it("counts a boolean as a name, as the web's itemLabel does", async () => {
    const flagged = await handle.collections.create({
      name: "Flags",
      fields: [
        { id: "done", type: "boolean", label: "Done", required: false },
        { id: "title", type: "text", label: "Title", required: false },
      ],
      isFiniteSet: false,
    });
    await add({ done: true, title: "a" }, flagged);
    await add({ title: "b" }, flagged);
    await add({ done: false, title: "c" }, flagged);
    const items = await handle.items.listByCollection(flagged.id, { sort: { key: "name", direction: "asc" } });
    // Names are "true", "b", "false": b < false < true.
    expect(items.map((item) => item.fields.title)).toEqual(["b", "c", "a"]);
  });

  it("sorts by name in a collection with more fields than SQLite allows function arguments", async () => {
    const wide = await handle.collections.create({
      name: "Wide",
      fields: Array.from({ length: 1100 }, (_, i) => ({
        id: `f${i}`,
        type: "text" as const,
        label: `F${i}`,
        required: false,
      })),
      isFiniteSet: false,
    });
    await add({ f0: "zulu" }, wide);
    await add({ f0: "alpha" }, wide);
    const items = await handle.items.listByCollection(wide.id, { sort: { key: "name", direction: "asc" } });
    expect(items.map((item) => item.fields.f0)).toEqual(["alpha", "zulu"]);
  });

  it("orders a number field numerically, with empty values last in both directions", async () => {
    await add({ title: "ten", pages: 10 });
    await add({ title: "none" });
    await add({ title: "nine", pages: 9 });
    await add({ title: "text", pages: "9" });
    const sort = (direction: "asc" | "desc") => ({ key: "field" as const, fieldId: "pages", direction });
    expect(await titles({ sort: sort("asc") })).toEqual(["nine", "ten", "none", "text"]);
    // Ties — the empty values here — break on insertion order in the sort's own direction.
    expect(await titles({ sort: sort("desc") })).toEqual(["ten", "nine", "text", "none"]);
  });

  it("orders a text field case-insensitively", async () => {
    await add({ title: "zebra" });
    await add({ title: "Apple" });
    await add({ title: "mango" });
    expect(await titles({ sort: { key: "field", fieldId: "title", direction: "asc" } })).toEqual([
      "Apple",
      "mango",
      "zebra",
    ]);
  });

  it("orders a boolean field false before true", async () => {
    await add({ title: "yes", read: true });
    await add({ title: "no", read: false });
    await add({ title: "unset" });
    expect(await titles({ sort: { key: "field", fieldId: "read", direction: "asc" } })).toEqual(["no", "yes", "unset"]);
  });

  it("applies the sort to search results instead of rank", async () => {
    await add({ title: "Dune Messiah" });
    await add({ title: "Dune" });
    expect(await titles({ q: "dune", sort: { key: "field", fieldId: "title", direction: "asc" } })).toEqual([
      "Dune",
      "Dune Messiah",
    ]);
  });

  describe("by status (#42)", () => {
    // Insertion, name and status orders all disagree, so only the status sort
    // (with its insertion-order tie-break) can produce the expected lists.
    beforeEach(async () => {
      await handle.items.create({ collectionId: books.id, status: "wanted", fields: { title: "Alpha" } });
      await handle.items.create({ collectionId: books.id, status: "owned", fields: { title: "Echo" } });
      await handle.items.create({ collectionId: books.id, status: "ordered", fields: { title: "Bravo" } });
      await handle.items.create({ collectionId: books.id, status: "wanted", fields: { title: "Delta" } });
      await handle.items.create({ collectionId: books.id, status: "owned", fields: { title: "Charlie" } });
    });

    const status = (direction: "asc" | "desc") => ({ key: "status" as const, direction });

    it("puts collected items first: owned, ordered, wanted, ties in insertion order", async () => {
      expect(await titles({ sort: status("asc") })).toEqual(["Echo", "Charlie", "Bravo", "Alpha", "Delta"]);
    });

    it("reverses exactly for still-to-get first: wanted, ordered, owned, ties newest first", async () => {
      expect(await titles({ sort: status("desc") })).toEqual(["Delta", "Alpha", "Bravo", "Charlie", "Echo"]);
    });

    it("breaks ties on insertion order, not on a timestamp or the name", async () => {
      // Backdate the later-inserted owned item: a createdAt tie-break would now
      // put Charlie before Echo, and a name tie-break always would.
      handle.sqlite
        .prepare(
          "UPDATE items SET created_at = '2000-01-01T00:00:00.000Z', updated_at = created_at WHERE json_extract(fields, '$.title') = ?",
        )
        .run("Charlie");
      expect(await titles({ sort: status("asc") })).toEqual(["Echo", "Charlie", "Bravo", "Alpha", "Delta"]);
      expect(await titles({ sort: status("desc") })).toEqual(["Delta", "Alpha", "Bravo", "Charlie", "Echo"]);
    });

    it("orders search results by status instead of rank", async () => {
      await handle.items.create({ collectionId: books.id, status: "wanted", fields: { title: "Dune Dune Dune" } });
      await handle.items.create({ collectionId: books.id, status: "owned", fields: { title: "Dune Messiah" } });
      // Unsorted, rank puts the denser match first; the status sort overrides it.
      expect(await titles({ q: "dune" })).toEqual(["Dune Dune Dune", "Dune Messiah"]);
      expect(await titles({ q: "dune", sort: status("asc") })).toEqual(["Dune Messiah", "Dune Dune Dune"]);
      expect(await titles({ q: "dune", sort: status("desc") })).toEqual(["Dune Dune Dune", "Dune Messiah"]);
    });

    it("composes with a filter", async () => {
      await handle.items.create({
        collectionId: books.id,
        status: "wanted",
        fields: { title: "Foxtrot", genre: "Fiction" },
      });
      await handle.items.create({
        collectionId: books.id,
        status: "owned",
        fields: { title: "Golf", genre: "History" },
      });
      await handle.items.create({
        collectionId: books.id,
        status: "owned",
        fields: { title: "Hotel", genre: "Fiction" },
      });
      const filters = [{ field: "genre", op: "in" as const, value: ["Fiction"] }];
      expect(await titles({ filters, sort: status("asc") })).toEqual(["Hotel", "Foxtrot"]);
      expect(await titles({ filters, sort: status("desc") })).toEqual(["Foxtrot", "Hotel"]);
    });

    it("leaves out trashed items and other collections' items", async () => {
      const trashed = await handle.items.create({ collectionId: books.id, status: "owned", fields: { title: "Zulu" } });
      await handle.items.softDelete(trashed.id);
      const other = await handle.collections.create({ name: "Records", fields, isFiniteSet: false });
      await handle.items.create({ collectionId: other.id, status: "owned", fields: { title: "Kilo" } });
      expect(await titles({ sort: status("asc") })).toEqual(["Echo", "Charlie", "Bravo", "Alpha", "Delta"]);
    });

    it("composes with the status filter", async () => {
      expect(await titles({ status: "wanted", sort: status("desc") })).toEqual(["Delta", "Alpha"]);
    });
  });

  it.each([
    ["missing", "an unknown field"],
    ["tags", "a tags field"],
  ])("refuses to sort by %s (%s)", async (fieldId) => {
    await expect(
      handle.items.listByCollection(books.id, { sort: { key: "field", fieldId, direction: "asc" } }),
    ).rejects.toBeInstanceOf(InvalidItemQueryError);
  });
});

describe("upgrading a database that already holds items", () => {
  it("indexes the existing items when the search migration runs", async () => {
    const { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { fileURLToPath } = await import("node:url");

    const dir = mkdtempSync(join(tmpdir(), "mycollections-fts-"));
    try {
      const shipped = fileURLToPath(new URL("../../drizzle", import.meta.url));
      const initOnly = join(dir, "migrations");
      cpSync(shipped, initOnly, { recursive: true });
      const journalPath = join(initOnly, "meta", "_journal.json");
      const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: { tag: string }[] };
      journal.entries = journal.entries.filter((entry) => entry.tag === "0000_init");
      writeFileSync(journalPath, JSON.stringify(journal));

      // Seeded with raw SQL, not the repositories: they write the columns of the
      // latest schema (target_count, #42), which a 0000_init table does not have.
      const path = join(dir, "app.db");
      const before = await openDatabase({ path, migrationsFolder: initOnly });
      const stamp = "2026-01-01T00:00:00.000Z";
      const collectionId = "11111111-1111-4111-8111-111111111111";
      before.sqlite
        .prepare(
          "INSERT INTO collections (id, name, fields, is_finite_set, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run(collectionId, "Books", JSON.stringify(fields), 0, stamp, stamp);
      const insertItem = before.sqlite.prepare(
        "INSERT INTO items (id, collection_id, status, fields, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      );
      insertItem.run(
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        collectionId,
        "owned",
        '{"title":"Dune","tags":["desert"]}',
        stamp,
        stamp,
      );
      insertItem.run("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", collectionId, "wanted", '{"title":"Emma"}', stamp, stamp);
      before.close();

      const after = await openDatabase({ path });
      const collection = await after.collections.getById(collectionId);
      const all = await after.items.listByCollection(collectionId);
      const found = await after.items.listByCollection(collectionId, { q: "desert" });
      after.close();
      expect(collection?.targetCount).toBeNull();
      expect(all.map((item) => item.fields.title)).toEqual(["Dune", "Emma"]);
      expect(found.map((item) => item.fields.title)).toEqual(["Dune"]);
      expect(readdirSync(dir).filter((name) => name.endsWith(".bak"))).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
