import { optionalEnv, type EnvLike } from "@/lib/env/server";

const PRODUCTION_APP_URL = "https://app.contextfor.dev";
const LOCAL_APP_URL = "http://localhost:3000";

/**
 * Canonical origin for this app, used for auth callbacks, email links and
 * absolute URLs in markup. Set NEXT_PUBLIC_APP_URL per environment.
 */
export function appUrl(env: EnvLike = process.env): string {
  const configured = optionalEnv("NEXT_PUBLIC_APP_URL", env);
  if (configured) {
    return configured.replace(/\/+$/, "");
  }
  return env.NODE_ENV === "production" ? PRODUCTION_APP_URL : LOCAL_APP_URL;
}
