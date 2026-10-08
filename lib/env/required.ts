// Optional, never checked here: CF_AIG_BASE_URL and CF_AIG_TOKEN route draft models
// through Cloudflare AI Gateway (see resolveModelEndpoint); both are documented in .env.example.
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
