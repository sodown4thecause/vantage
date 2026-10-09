import { UnsafeUrlError } from "@/lib/collectors/safeFetch";

/**
 * Map an internal collector failure to a message a customer can act on.
 * The API layer must never leak provider payloads, stack traces or internal
 * identifiers, so only category-level detail is exposed.
 */
export function publicCollectorError(error: unknown): string {
  if (error instanceof UnsafeUrlError) {
    return "That address was rejected by the fetch policy. Check the source URL.";
  }
  const message = error instanceof Error ? error.message : String(error);

  if (message.includes("fixture fallback is disabled in production")) {
    return "The provider is unavailable and sample data is disabled. Check the source or its credentials.";
  }
  if (message.includes("is not configured")) {
    return "A required provider credential is missing. Add it in workspace settings.";
  }
  if (
    message.includes("fetch failed") ||
    message.includes("ECONNREFUSED") ||
    message.includes("ETIMEDOUT") ||
    message.includes("ENOTFOUND") ||
    message.includes("timed out") ||
    message.includes("The operation was aborted")
  ) {
    return "The upstream provider could not be reached. Try again shortly.";
  }

  return "collector failed";
}
