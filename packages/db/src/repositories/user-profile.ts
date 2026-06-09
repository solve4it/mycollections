import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "../schema.js";

type Db = BetterSQLite3Database<typeof schema>;
type UserProfileRow = typeof schema.userProfile.$inferSelect;

export interface UserProfile {
  /** Opaque account key from the auth layer (e.g. `${providerId}:${sub}`). */
  id: string;
  displayName: string;
  email: string | null;
  provider: string;
  /** User preferences (theme, locale, opt-outs, ...). */
  settings: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertUserProfileInput {
  id: string;
  displayName: string;
  email?: string;
  provider: string;
  settings: Record<string, unknown>;
}

function rowToProfile(row: UserProfileRow): UserProfile {
  return {
    id: row.id,
    displayName: row.displayName,
    email: row.email,
    provider: row.provider,
    settings: JSON.parse(row.settings),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class UserProfileRepository {
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  async get(id: string): Promise<UserProfile | null> {
    const row = this.#db.select().from(schema.userProfile).where(eq(schema.userProfile.id, id)).get();
    return row ? rowToProfile(row) : null;
  }

  async upsert(input: UpsertUserProfileInput): Promise<UserProfile> {
    const now = new Date().toISOString();
    const existing = await this.get(input.id);
    const profile: UserProfile = {
      id: input.id,
      displayName: input.displayName,
      email: input.email ?? null,
      provider: input.provider,
      settings: input.settings,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    const row = { ...profile, settings: JSON.stringify(profile.settings) };
    this.#db
      .insert(schema.userProfile)
      .values(row)
      .onConflictDoUpdate({ target: schema.userProfile.id, set: row })
      .run();
    return profile;
  }
}
