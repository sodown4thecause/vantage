import { AGENT_MAX_REDIRECT_URIS } from "@/lib/agent/config";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Absolute https URL, or http on a loopback host for local clients. Fragments and
 * embedded credentials are refused: both are ways to smuggle a different target
 * past an exact-match check.
 */
export function isAllowedRedirectUri(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 2_000) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.hash || url.username || url.password) return false;
  if (url.protocol === "https:") return true;
  return url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname);
}

/** Deduplicated redirect URIs, or null when any entry is missing or invalid. */
export function normalizeRedirectUris(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > AGENT_MAX_REDIRECT_URIS) {
    return null;
  }
  if (!value.every(isAllowedRedirectUri)) return null;
  return [...new Set(value)];
}
