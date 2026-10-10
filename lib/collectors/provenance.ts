/**
 * Fixture provenance policy.
 *
 * Every collector records which provider produced its documents
 * (`metadata.provider`, `metadata.mocked`). When a provider path fails, the
 * provider clients fall back to bundled sample data — which is fine in
 * development and demos, but must never reach a customer's workspace in
 * production: sample data presented as a real lead is a lie with a source
 * link attached.
 *
 * Call `assertRealProvider` immediately after every provider fetch.
 */

const FIXTURE_PROVIDER = "fixture";

/** True when a provider result is bundled sample data, not live platform data. */
export function isFixtureProvider(provider: string): boolean {
  return provider === FIXTURE_PROVIDER;
}

function isProduction(env: NodeJS.ProcessEnv): boolean {
  return env.NODE_ENV === "production";
}

/**
 * Fixtures are allowed in development and in any environment that explicitly
 * opts in with ALLOW_FIXTURES=true (intentional demos, staging with sample
 * data). In production the collector fails instead of returning samples.
 */
export function fixturesAllowed(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!isProduction(env)) {
    return true;
  }
  return env.ALLOW_FIXTURES === "true";
}

/**
 * Fail the collector when it would persist fixture data in an environment
 * that has not opted in. Kept separate from the fetch itself so collectors
 * stay readable and the policy is unit-testable.
 */
export function assertRealProvider(
  meta: { provider: string },
  collector: string,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (!isFixtureProvider(meta.provider) || fixturesAllowed(env)) {
    return;
  }
  throw new Error(
    `${collector}: fixture fallback is disabled in production; set ALLOW_FIXTURES=true to override`,
  );
}
