import { optionalEnv, requiredEnv } from "@/lib/env/required";

const LOCAL_APP_URL = "http://localhost:3000";

/**
 * Canonical origin for digest links. Production-mode deployments, including
 * staging, must set NEXT_PUBLIC_APP_URL explicitly to avoid cross-environment links.
 */
export function appUrl(): string {
  const configured = optionalEnv("NEXT_PUBLIC_APP_URL");
  if (configured) {
    return configured.replace(/\/+$/, "");
  }
  return process.env.NODE_ENV === "production"
    ? requiredEnv("NEXT_PUBLIC_APP_URL")
    : LOCAL_APP_URL;
}
