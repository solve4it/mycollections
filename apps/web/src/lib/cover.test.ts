import { describe, expect, it } from "vitest";
import { COVER_ARCHETYPES, COVER_HUES, catalogCode, coverFor } from "./cover.js";

/**
 * Covers are the one piece of the UI a user will notice changing. Every
 * assertion here exists to stop a refactor from silently reshuffling the covers
 * of collections people already have.
 */

/** Deterministic uuid-shaped ids — a seeded LCG, so the distribution test can never flake. */
function* fakeIds(count: number): Generator<string> {
  let seed = 0x2f6e2b1;
  const hex = () => {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    return (seed >>> 24).toString(16).padStart(2, "0");
  };
  for (let i = 0; i < count; i++) {
    const bytes = Array.from({ length: 16 }, hex).join("");
    yield [bytes.slice(0, 8), bytes.slice(8, 12), bytes.slice(12, 16), bytes.slice(16, 20), bytes.slice(20, 32)].join(
      "-",
    );
  }
}

const SAMPLE = "00000000-0000-0000-0000-000000000001";

describe("coverFor", () => {
  it("is pure — the same id always produces the same cover", () => {
    const first = coverFor(SAMPLE);
    for (let i = 0; i < 100; i++) expect(coverFor(SAMPLE)).toEqual(first);
  });

  it("ignores id case, so a backup restored with uppercase ids keeps its covers", () => {
    // z.uuid() accepts uppercase, so an externally produced or hand-edited
    // export can carry one. Hashing it raw would repaint the whole dashboard.
    expect(coverFor("A1B2C3D4-0000-4000-8000-00000000000F")).toEqual(coverFor("a1b2c3d4-0000-4000-8000-00000000000f"));
  });

  it("only ever returns a declared archetype and a declared hue", () => {
    for (const id of fakeIds(1000)) {
      const { archetype, hue } = coverFor(id);
      expect(COVER_ARCHETYPES).toContain(archetype);
      expect(COVER_HUES).toContain(hue);
    }
  });

  it("uses all six archetypes without favouring one", () => {
    // A signed-modulo or precision bug shows up here as a missing archetype or a
    // lopsided share long before anyone notices it on a dashboard.
    const counts = new Map<string, number>();
    let total = 0;
    for (const id of fakeIds(1000)) {
      const { archetype } = coverFor(id);
      counts.set(archetype, (counts.get(archetype) ?? 0) + 1);
      total++;
    }
    expect([...counts.keys()].sort()).toEqual([...COVER_ARCHETYPES].sort());
    for (const [archetype, count] of counts) {
      expect(count / total, `${archetype} share`).toBeLessThan(0.25);
    }
  });

  it("varies hue independently of archetype", () => {
    // Deriving both from the same bits makes every "coins" cover the same color.
    const huesByArchetype = new Map<string, Set<number>>();
    for (const id of fakeIds(400)) {
      const { archetype, hue } = coverFor(id);
      const seen = huesByArchetype.get(archetype) ?? new Set<number>();
      seen.add(hue);
      huesByArchetype.set(archetype, seen);
    }
    for (const [archetype, hues] of huesByArchetype) {
      expect(hues.size, `${archetype} should not be locked to one hue`).toBeGreaterThan(1);
    }
  });

  it("keeps hues inside the archival band, away from the stamp indigo", () => {
    // The band is a design decision, not an accident: an unconstrained hue
    // eventually produces a magenta cover that fights --stamp on every card.
    for (const hue of COVER_HUES) {
      expect(hue).toBeGreaterThanOrEqual(0);
      expect(hue).toBeLessThan(360);
      expect(Math.abs(hue - 236), `hue ${hue} is too close to --stamp`).toBeGreaterThan(15);
    }
  });

  it("pins the archetype order, because reordering it repaints every cover", () => {
    expect([...COVER_ARCHETYPES]).toEqual(["rings", "studs", "fan", "dials", "coins", "spines"]);
  });
});

describe("catalogCode", () => {
  it("is a stable two-character code derived from the id, not from list position", () => {
    // List order is not contractual (the repository issues no ORDER BY), so a
    // positional number would renumber on every create, delete, and re-query.
    expect(catalogCode(SAMPLE)).toMatch(/^C-[0-9A-Z]{2}$/);
    expect(catalogCode(SAMPLE)).toBe(catalogCode(SAMPLE));
  });

  it("ignores id case, like the cover it sits under", () => {
    expect(catalogCode("A1B2C3D4-0000-4000-8000-00000000000F")).toBe(
      catalogCode("a1b2c3d4-0000-4000-8000-00000000000f"),
    );
  });

  it("distinguishes collections", () => {
    const codes = new Set<string>();
    for (const id of fakeIds(200)) codes.add(catalogCode(id));
    // 1296 possible codes over 200 ids: collisions are expected and harmless
    // (the code is a label, not a key), but one code for everything is a bug.
    expect(codes.size).toBeGreaterThan(100);
  });
});

/**
 * The regression lock. These literals were generated once from the
 * implementation and frozen: their only job is to fail loudly if a change to
 * the hash, the archetype list, or the hue ladder would repaint covers that
 * users have already seen. If this table needs updating, that is a deliberate
 * decision to reshuffle every existing collection's cover — not a rubber stamp.
 */
describe("frozen output", () => {
  it.each([
    ["00000000-0000-0000-0000-000000000001", "coins", 40, "C-DZ"],
    ["00000000-0000-0000-0000-000000000002", "spines", 40, "C-6V"],
    ["11111111-1111-4111-8111-111111111111", "studs", 150, "C-B7"],
    ["550e8400-e29b-41d4-a716-446655440000", "rings", 262, "C-ZI"],
    ["6ba7b810-9dad-11d1-80b4-00c04fd430c8", "coins", 190, "C-M0"],
    ["9f8d7c6b-5a4e-4f3d-9c2b-1a0e9f8d7c6b", "rings", 214, "C-NW"],
    ["deadbeef-dead-4eef-8eef-deadbeefdead", "spines", 214, "C-0B"],
    ["ffffffff-ffff-4fff-8fff-ffffffffffff", "dials", 74, "C-YB"],
  ])("%s renders %s / hue %i / %s", (id, archetype, hue, code) => {
    expect(coverFor(id)).toEqual({ archetype, hue });
    expect(catalogCode(id)).toBe(code);
  });
});
