import { requiredEnv } from "@/lib/env/required";

export type EnvLike = Record<string, string | undefined>;

/** Trimmed value, or undefined when unset/blank. */
export function optionalEnv(
  name: string,
  env: EnvLike = process.env,
): string | undefined {
  const value = env[name]?.trim();
  return value ? value : undefined;
}

/** True only when the variable is exactly "true". */
export function flagEnv(name: string, env: EnvLike = process.env): boolean {
  return optionalEnv(name, env) === "true";
}

/** Neon pooled connection string used by the runtime DB client. */
export function databaseUrl(env: EnvLike = process.env): string {
  return requiredEnv(
    "DATABASE_URL",
    env,
    "Copy .env.example to .env.local and add your Neon pooled connection string.",
  );
}

/** Bearer secret guarding the scheduled sweep endpoint. Optional in dev. */
export function cronSecret(env: EnvLike = process.env): string | undefined {
  return optionalEnv("CRON_SECRET", env);
}

/** Neon Auth (Managed Better Auth) base URL. */
export function neonAuthBaseUrl(env: EnvLike = process.env): string {
  return requiredEnv(
    "NEON_AUTH_BASE_URL",
    env,
    "Provision Neon Auth and copy the base URL from the Neon console.",
  );
}

/** Cookie-signing secret for Neon Auth sessions (32+ chars). */
export function neonAuthCookieSecret(env: EnvLike = process.env): string {
  return requiredEnv(
    "NEON_AUTH_COOKIE_SECRET",
    env,
    "Generate with: openssl rand -base64 32",
  );
}

/** Collector credentials. All optional: collectors fall back per provider. */
export function scavioApiKey(env: EnvLike = process.env): string | undefined {
  return optionalEnv("SCAVIO_API_KEY", env);
}

export function tinyfishApiKey(env: EnvLike = process.env): string | undefined {
  return optionalEnv("TINYFISH_API_KEY", env);
}

export function productHuntDevToken(env: EnvLike = process.env): string | undefined {
  return optionalEnv("PH_DEV_TOKEN", env);
}

export function youtubeApiKey(env: EnvLike = process.env): string | undefined {
  return optionalEnv("YOUTUBE_API_KEY", env);
}

/** Masters candidate learning weights; default-off until 3.5 lands. */
export function learningEnabled(env: EnvLike = process.env): boolean {
  return flagEnv("LEARNING_ENABLED", env);
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
  return optionalEnv("ALLOW_FIXTURES", env) === "true";
}
