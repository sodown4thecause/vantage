type EnvLike = Record<string, string | undefined>;

const FIXTURE_PROVIDER = "fixture";

/** True when a provider result is bundled sample data, not live platform data. */
export function isFixtureProvider(provider: string): boolean {
  return provider === FIXTURE_PROVIDER;
}

/**
 * Fixture fallbacks are allowed in development and in any environment that
 * explicitly opts in. Production silently serving sample data as real leads
 * is never acceptable, so there the collector fails instead.
 */
export function fixturesAllowed(env: EnvLike = process.env): boolean {
  if (env.NODE_ENV !== "production") {
    return true;
  }
  return env.ALLOW_FIXTURES === "true";
}

/**
 * Fail the collector when it would persist fixture data in an environment
 * that has not opted in. Call immediately after every provider fetch.
 */
export function assertRealProvider(
  meta: { provider: string },
  collector: string,
  env: EnvLike = process.env,
): void {
  if (!isFixtureProvider(meta.provider) || fixturesAllowed(env)) {
    return;
  }
  throw new Error(
    `${collector}: fixture fallback is disabled in production; set ALLOW_FIXTURES=true to override`,
  );
}
