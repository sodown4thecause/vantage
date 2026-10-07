import type { Env, Source } from "./types";

// ---------------------------------------------------------------------------
// Single HTTP fetch with conditional GET. No retries here: a thrown fetch error
// propagates to the queue consumer, which owns retry/backoff. Retrying inside
// the consumer would multiply the retry budget.
// ---------------------------------------------------------------------------

export interface FetchOutcome {
  /** 304 means the source is unchanged; skip parsing entirely. */
  readonly kind: "modified" | "not-modified";
  readonly status: number;
  readonly body: string;
  readonly etag: string | null;
  readonly lastModified: string | null;
}

/**
 * A fetch failure that carries the HTTP status and whether retrying can help.
 * `retryable` is false for client errors that will keep failing (any 4xx except
 * 429) — the consumer acks those instead of burning the retry budget.
 */
export class FetchError extends Error {
  readonly status: number;
  readonly retryable: boolean;
  constructor(sourceId: string, status: number, statusText: string) {
    super(`HTTP ${status} ${statusText} for ${sourceId}`);
    this.name = "FetchError";
    this.status = status;
    this.retryable = !(status >= 400 && status < 500 && status !== 429);
  }
}

/** Feeds larger than this are treated as a retryable error, not parsed into OOM. */
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

/** Descriptive UA for SEC EDGAR; general UA otherwise. */
function userAgentFor(source: Source, env: Env): string {
  if (source.rateLimit?.requiresDescriptiveUserAgent) {
    const ua = env.EDGAR_USER_AGENT;
    if (!ua) {
      throw new Error(
        `source "${source.id}" requires a descriptive User-Agent; set EDGAR_USER_AGENT secret`,
      );
    }
    return ua;
  }
  return env.USER_AGENT;
}

/** Append the Stack Exchange key when the source needs it and one is configured. */
function withApiKey(source: Source, url: string, env: Env): string {
  if (!source.rateLimit?.requiresApiKey) return url;
  if (!env.STACKEXCHANGE_KEY) return url; // keyless: still works, lower quota
  const parsed = new URL(url);
  parsed.searchParams.set("key", env.STACKEXCHANGE_KEY);
  return parsed.toString();
}

/**
 * Fetch a source, sending conditional-GET validators when present. Returns a
 * discriminated outcome so the caller cannot confuse a 304 with an empty body.
 */
export async function fetchSource(
  source: Source,
  env: Env,
  validators: { readonly etag: string | null; readonly lastModified: string | null },
): Promise<FetchOutcome> {
  const headers = new Headers({
    "User-Agent": userAgentFor(source, env),
    Accept: "application/rss+xml, application/atom+xml, application/json, text/xml;q=0.9, */*;q=0.5",
  });
  if (validators.etag) headers.set("If-None-Match", validators.etag);
  if (validators.lastModified) headers.set("If-Modified-Since", validators.lastModified);

  const url = withApiKey(source, source.url, env);
  const response = await fetch(url, { headers, redirect: "follow" });

  if (response.status === 304) {
    return {
      kind: "not-modified",
      status: 304,
      body: "",
      etag: validators.etag,
      lastModified: validators.lastModified,
    };
  }

  if (!response.ok) {
    // 4xx (except 429) is permanent: the resource is gone or forbidden and will
    // not appear on retry. Surface it as non-retryable so the consumer acks.
    throw new FetchError(source.id, response.status, response.statusText);
  }

  // Fail loud *before* buffering: a declared oversized Content-Length means we
  // would blow memory parsing it. Retryable so a transient mis-sized header is
  // not permanently fatal.
  const declaredLength = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw new Error(
      `response too large for ${source.id}: ${declaredLength} bytes exceeds ${MAX_RESPONSE_BYTES}`,
    );
  }

  const body = await response.text();
  // Headers can lie or be absent; enforce the cap on the actual byte size too.
  if (body.length > MAX_RESPONSE_BYTES) {
    throw new Error(
      `response too large for ${source.id}: ${body.length} bytes exceeds ${MAX_RESPONSE_BYTES}`,
    );
  }

  return {
    kind: "modified",
    status: response.status,
    body,
    etag: response.headers.get("etag"),
    lastModified: response.headers.get("last-modified"),
  };
}
