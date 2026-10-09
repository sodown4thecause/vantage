import { fixturesAllowed, type EnvLike } from "@/lib/env/server";

const FIXTURE_PROVIDER = "fixture";

/** True when a provider result is bundled sample data, not live platform data. */
export function isFixtureProvider(provider: string): boolean {
  return provider === FIXTURE_PROVIDER;
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
