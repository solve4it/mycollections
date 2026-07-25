import type { ReactNode } from "react";
import type { FeatureFlagKey } from "../config/flags.js";
import { useFeatureFlag } from "../lib/feature-flags.js";

interface FeatureGateProps {
  flag: FeatureFlagKey;
  children: ReactNode;
  /** Rendered in place of the children while the flag is off. Nothing by default. */
  fallback?: ReactNode;
}

/**
 * Renders `children` only while `flag` is enabled.
 *
 * Children are not mounted at all when the flag is off (so their queries never
 * fire), and the gate adds no wrapper element — it renders a fragment so it can
 * sit inside flex/grid containers, lists, and tables.
 *
 * This gates rendering only. A route whose loader must not run when a flag is
 * off has to check the flag in `beforeLoad`, not here.
 */
export function FeatureGate({ flag, children, fallback = null }: FeatureGateProps) {
  return <>{useFeatureFlag(flag) ? children : fallback}</>;
}
