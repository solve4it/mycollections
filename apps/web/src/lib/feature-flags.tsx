import type { FeatureFlagProvider } from "@mycollections/core";
import { createContext, type ReactNode, useContext } from "react";
import { appFeatureFlagProvider, type FeatureFlagKey } from "../config/flags.js";

// Two things are called a "provider" here: core's `FeatureFlagProvider` is the
// lookup contract (`isEnabled`), and `FeatureFlagsProvider` below is the React
// context provider that makes one available to the tree.

const FeatureFlagsContext = createContext<FeatureFlagProvider | null>(null);

interface FeatureFlagsProviderProps {
  children: ReactNode;
  /** Overrides the app's committed flags. Tests inject their own flag set here. */
  provider?: FeatureFlagProvider;
}

/** Makes feature flags available to {@link useFeatureFlag} and `<FeatureGate>`. */
export function FeatureFlagsProvider({ children, provider = appFeatureFlagProvider }: FeatureFlagsProviderProps) {
  return <FeatureFlagsContext.Provider value={provider}>{children}</FeatureFlagsContext.Provider>;
}

/**
 * Reads a feature flag. Unknown flags are disabled — flags gate UI only, never
 * access: gated code still ships in the bundle, so anything with a security
 * consequence is enforced by the API independently.
 *
 * Throws outside a provider rather than defaulting: a silent default would let
 * a subtree read the committed flags while its test believes it injected its own.
 */
export function useFeatureFlag(flag: FeatureFlagKey): boolean {
  const provider = useContext(FeatureFlagsContext);
  if (!provider) {
    throw new Error(`useFeatureFlag("${flag}") was called outside a <FeatureFlagsProvider>`);
  }
  return provider.isEnabled(flag);
}
