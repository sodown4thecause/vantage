/**
 * Returns the URL only if it is plain http(s); otherwise null. Use before
 * rendering any URL that came from a scraped source or a model as an href, so a
 * `javascript:` or `data:` value can never become a clickable link.
 */
export function safeHttpUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}
