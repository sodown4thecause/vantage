import { optionalEnv } from "@/lib/env/required";

const PRODUCTION_APP_URL = "https://contextfor.dev";
const LOCAL_APP_URL = "http://localhost:3000";

/**
 * Canonical origin for this app, used for digest links, auth callbacks and
 * absolute URLs in markup. Set NEXT_PUBLIC_APP_URL per environment.
 */
export function appUrl(): string {
  const configured = optionalEnv("NEXT_PUBLIC_APP_URL");
  if (configured) {
    return configured.replace(/\/+$/, "");
  }
  return process.env.NODE_ENV === "production"
    ? PRODUCTION_APP_URL
    : LOCAL_APP_URL;
}
