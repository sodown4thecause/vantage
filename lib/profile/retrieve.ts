import type {
  MonitoringProfileInput,
  ProductMaterialResult,
} from "@/lib/profile/types";

/** Hard caps so onboarding never hangs on a bad URL. */
export const PRODUCT_FETCH_TIMEOUT_MS = 4_000;
export const PRODUCT_FETCH_MAX_BYTES = 64_000;
export const PRODUCT_FETCH_MAX_URLS = 4;

export type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchText(
  url: string,
  fetchImpl: FetchLike,
): Promise<{ ok: true; text: string } | { ok: false; reason: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PRODUCT_FETCH_TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        accept: "text/html,text/plain,application/xhtml+xml",
        "user-agent": "VantageOnboarding/1.0",
      },
    });
    if (!res.ok) {
      return { ok: false, reason: `HTTP ${res.status} for ${url}` };
    }
    const buf = await res.arrayBuffer();
    const slice = buf.byteLength > PRODUCT_FETCH_MAX_BYTES
      ? buf.slice(0, PRODUCT_FETCH_MAX_BYTES)
      : buf;
    const raw = new TextDecoder("utf-8", { fatal: false }).decode(slice);
    const text = stripHtml(raw).slice(0, 12_000);
    if (!text) {
      return { ok: false, reason: `Empty body for ${url}` };
    }
    return { ok: true, text };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: `Fetch failed for ${url}: ${message}` };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Boundedly retrieve product + docs material. On total failure, mark
 * inaccessible and prefer any founder-supplied manual text.
 */
export async function retrieveProductMaterial(
  input: MonitoringProfileInput,
  fetchImpl: FetchLike = fetch,
): Promise<ProductMaterialResult> {
  const manual = input.productMaterialManual?.trim() ?? "";

  if (input.forceManualMaterial) {
    return {
      status: "manual",
      text: manual,
      notes: "Founder requested manual product material; network fetch skipped.",
    };
  }

  const urls = [input.productUrl, ...input.docsUrls]
    .map((u) => u.trim())
    .filter(Boolean)
    .slice(0, PRODUCT_FETCH_MAX_URLS);

  const parts: string[] = [];
  const notes: string[] = [];

  for (const url of urls) {
    const result = await fetchText(url, fetchImpl);
    if (result.ok) {
      parts.push(`## ${url}\n${result.text}`);
    } else {
      notes.push(result.reason);
    }
  }

  if (parts.length > 0) {
    return {
      status: "ok",
      text: parts.join("\n\n").slice(0, 40_000),
      notes: notes.length ? notes.join("; ") : "Retrieved product material.",
    };
  }

  if (manual) {
    return {
      status: "manual",
      text: manual,
      notes:
        notes.join("; ") ||
        "Product URLs were inaccessible; using founder-supplied material.",
    };
  }

  return {
    status: "inaccessible",
    text: "",
    notes:
      notes.join("; ") ||
      "Product URLs were inaccessible and no manual material was provided.",
  };
}
