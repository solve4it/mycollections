/**
 * Generated collection covers (#223) — the signature element of the "Cabinet &
 * Paper" direction. Every collection gets a cover derived from its id alone:
 * pure, deterministic, identical on every device, and with no network request
 * to make. When real imagery lands (#37) the pattern becomes the fallback.
 *
 * Hand-rolled rather than an identicon dependency (jdenticon, boring-avatars,
 * geopattern, dicebear were all evaluated and all score clean): none of them
 * produce the six *domain* archetypes the direction commits to — they produce
 * abstract hash art. Same call, and the same reasoning, as Icon.tsx.
 *
 * Nothing here may use Intl, toLocaleString, or localeCompare: the output has
 * to be identical for every user, in every locale, forever.
 */

/** Order is load-bearing: reordering this array repaints every existing cover. */
export const COVER_ARCHETYPES = ["rings", "studs", "fan", "dials", "coins", "spines"] as const;

export type CoverArchetype = (typeof COVER_ARCHETYPES)[number];

/**
 * A hand-picked ladder rather than a continuous band, so covers stay a design
 * decision instead of whatever the hash happens to land on. Muted archival
 * hues, deliberately clear of the --stamp indigo (236) that paints every
 * primary action.
 */
export const COVER_HUES = [22, 40, 74, 150, 190, 214, 262, 344] as const;

export interface Cover {
  archetype: CoverArchetype;
  hue: number;
}

/**
 * FNV-1a, 32-bit. Chosen for being tiny, dependency-free and integer-only —
 * float math would make the output engine-dependent. `Math.imul` keeps the
 * multiply from silently losing low bits past 2^53, and every result is coerced
 * back to unsigned: JS bitwise ops yield signed int32, and `negative % 6` would
 * index the archetype array out of bounds and render nothing at all.
 */
function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Ids are case-insensitive — `z.uuid()` accepts uppercase, and a restored backup may carry it. */
function hashOf(id: string): number {
  return fnv1a(id.toLowerCase());
}

/**
 * The cover for a collection id. Archetype and hue read different parts of the
 * hash; sharing bits would lock every "coins" cover to one color.
 */
export function coverFor(id: string): Cover {
  const hash = hashOf(id);
  const archetype = COVER_ARCHETYPES[hash % COVER_ARCHETYPES.length];
  const hue = COVER_HUES[(hash >>> 11) % COVER_HUES.length];
  // Both indexes are in range by construction; the fallbacks exist for the type
  // checker under noUncheckedIndexedAccess rather than for any reachable case.
  return { archetype: archetype ?? "rings", hue: hue ?? 22 };
}

/**
 * The catalog code on a card's eyebrow — `C-4T`. Derived from the same hash
 * rather than the collection's position in a list: `CollectionsRepository.list()`
 * issues no ORDER BY, so a sequence number would renumber itself on every
 * create, delete and re-query. Codes may collide across collections; it is a
 * label in the typewritten voice, never an identifier.
 */
export function catalogCode(id: string): string {
  const code = (hashOf(id) >>> 16) % 1296; // 36^2 — two base-36 characters
  return `C-${code.toString(36).padStart(2, "0").toUpperCase()}`;
}
