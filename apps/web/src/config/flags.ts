import { createStaticFeatureFlagProvider, type FeatureFlagProvider, parseFeatureFlags } from "@mycollections/core";
import flags from "./flags.json";

/**
 * The flags declared in `flags.json`. Gate call sites are typed against this
 * union, so a misspelled flag name is a typecheck failure rather than a feature
 * that silently never renders.
 */
export type FeatureFlagKey = keyof typeof flags;

/**
 * App-wide flags, read from the committed `flags.json` at build time — no
 * fetch, no loading state, so gates resolve on first render.
 *
 * Validation failures throw during module evaluation on purpose: a malformed
 * flags file would otherwise look exactly like "every feature is off". The
 * committed file is schema-checked in `lib/feature-flags.test.tsx`, so this can
 * only fire on an uncommitted hand-edit.
 */
export const appFeatureFlagProvider: FeatureFlagProvider = createStaticFeatureFlagProvider(parseFeatureFlags(flags));
