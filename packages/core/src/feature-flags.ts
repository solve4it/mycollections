import { z } from "zod";
import type { FeatureFlagProvider } from "./providers.js";

/**
 * A feature-flag configuration: flag name → enabled. Deliberately flat and
 * boolean-only — flags are release gates, not user preferences or config
 * values. Anything richer belongs in Settings, not here.
 *
 * Note: a flag literally named `__proto__` is dropped by `z.record` rather than
 * rejected. Harmless (the provider reports unknown flags as disabled), and not
 * worth guarding a name nobody would choose.
 */
export const FeatureFlagsSchema = z.record(z.string(), z.boolean());

export type FeatureFlags = z.infer<typeof FeatureFlagsSchema>;

/**
 * Validates untrusted flag configuration (a JSON file, an env override) at the
 * boundary. Throws on malformed input: a silent empty result would read as
 * "every feature is off", which is indistinguishable from a working config.
 */
export function parseFeatureFlags(input: unknown): FeatureFlags {
  return FeatureFlagsSchema.parse(input);
}

/**
 * A {@link FeatureFlagProvider} backed by a fixed flag map.
 *
 * Unknown flags are disabled — a typo'd flag name must never turn a gated
 * feature on. Flags are copied into a null-prototype object so inherited
 * members (`constructor`, `toString`, …) can't be mistaken for enabled flags,
 * and so later mutation of the caller's object can't change the answers.
 *
 * Flags are a UI gate only, never an authorization boundary: gated code still
 * ships in the bundle, so anything with a security consequence must be enforced
 * server-side independently.
 */
export function createStaticFeatureFlagProvider(flags: FeatureFlags): FeatureFlagProvider {
  const snapshot: Record<string, boolean> = Object.assign(Object.create(null), flags);
  return {
    isEnabled: (key) => snapshot[key] === true,
  };
}
