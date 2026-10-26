import posthog from "posthog-js";

/** Typed flag-name boundary; replace the string alias with known literals as flags are added. */
export type FeatureFlagName = string;

/** PostHog returns undefined while flags are loading; callers should treat that as disabled. */
export function isFeatureEnabled(flag: FeatureFlagName): boolean {
  const name = flag.trim();
  return name.length > 0 && posthog.isFeatureEnabled(name) === true;
}
