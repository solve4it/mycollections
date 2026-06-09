import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { type BetterSQLite3Database, drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { CollectionsRepository } from "./repositories/collections.js";
import { ItemsRepository } from "./repositories/items.js";
import { MediaRepository } from "./repositories/media.js";
import { UserProfileRepository } from "./repositories/user-profile.js";
import * as schema from "./schema.js";

/** Migrations that ship with this package. */
const DEFAULT_MIGRATIONS_FOLDER = fileURLToPath(new URL("../drizzle", import.meta.url));

export interface OpenDatabaseOptions {
  /** SQLite file path, or ":memory:" for an ephemeral database (tests). */
  path: string;
  /** Override the migrations folder; defaults to the folder shipped with this package. */
  migrationsFolder?: string;
}

export interface DatabaseHandle {
  /** Drizzle query interface, for callers needing queries beyond the repositories. */
  db: BetterSQLite3Database<typeof schema>;
  /** Raw better-sqlite3 connection (pragmas, prepared statements, backups). */
  sqlite: Database.Database;
  collections: CollectionsRepository;
  items: ItemsRepository;
  media: MediaRepository;
  userProfile: UserProfileRepository;
  close(): void;
}

/**
 * Opens (creating if needed) the application database and migrates it to the
 * latest schema. If the database already has data and migrations are pending,
 * a backup copy is written next to it first (`<path>.<timestamp>.bak`).
 */
export async function openDatabase(options: OpenDatabaseOptions): Promise<DatabaseHandle> {
  const { path, migrationsFolder = DEFAULT_MIGRATIONS_FOLDER } = options;
  const isFile = path !== ":memory:";

  const sqlite = new Database(path);
  if (isFile) {
    sqlite.pragma("journal_mode = WAL");
  }
  sqlite.pragma("foreign_keys = ON");

  if (isFile && hasUserTables(sqlite) && countPendingMigrations(sqlite, migrationsFolder) > 0) {
    const timestamp = new Date().toISOString().replaceAll(":", "-");
    await sqlite.backup(`${path}.${timestamp}.bak`);
  }

  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder });

  return {
    db,
    sqlite,
    collections: new CollectionsRepository(db),
    items: new ItemsRepository(db),
    media: new MediaRepository(db),
    userProfile: new UserProfileRepository(db),
    close: () => sqlite.close(),
  };
}

function hasUserTables(sqlite: Database.Database): boolean {
  const row = sqlite
    .prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .get() as { n: number };
  return row.n > 0;
}

/**
 * Pending = journal entries not yet recorded in drizzle's migrations table.
 * Counts are sufficient here: drizzle migrations are append-only, and the
 * migrator itself verifies hashes when it runs.
 */
function countPendingMigrations(sqlite: Database.Database, migrationsFolder: string): number {
  const journalPath = `${migrationsFolder}/meta/_journal.json`;
  if (!existsSync(journalPath)) {
    return 0;
  }
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: unknown[] };

  const migrationsTable = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'")
    .get();
  const applied = migrationsTable
    ? (sqlite.prepare("SELECT count(*) AS n FROM __drizzle_migrations").get() as { n: number }).n
    : 0;

  return Math.max(0, journal.entries.length - applied);
}
