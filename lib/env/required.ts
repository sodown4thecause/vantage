// Optional, never checked here: AI_GATEWAY_PROVIDER and the CF_AIG_* values route model
// traffic through Cloudflare AI Gateway (see lib/ai/gateway.ts); all are documented in .env.example.
export function requiredEnv(
  name: string,
  env: Record<string, string | undefined> = process.env,
): string {
  const value = env[name];
  if (!value?.trim()) {
    throw new Error(`Required environment variable ${name} is not configured`);
  }
  return value;
}

/** Trimmed value, or undefined when unset/blank. */
export function optionalEnv(
  name: string,
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  const value = env[name]?.trim();
  return value ? value : undefined;
}
