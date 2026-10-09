export const DEFAULT_FETCH_TIMEOUT_MS = 10_000;
export const DEFAULT_MAX_RESPONSE_BYTES = 2_000_000;
const MAX_REDIRECTS = 3;

/** Raised when a URL or response violates collector fetch policy. */
export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

/** Hostname-only description, safe to put in errors and logs. */
export function describeUrl(raw: string): string {
  try {
    const parsed = new URL(raw);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    return "[unparseable url]";
  }
}

function isIpv4Literal(hostname: string): boolean {
  return /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(hostname);
}

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) {
    return true;
  }
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b !== undefined && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b !== undefined && b >= 64 && b <= 127) return true;
  if (a === 192 && b === 0) return true;
  if (a === 198 && b !== undefined && (b === 18 || b === 19)) return true;
  if (a !== undefined && a >= 224) return true;
  return false;
}

function isPrivateIpv6(hostname: string): boolean {
  const value = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const dotted = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(value);
  if (dotted?.[1]) return isPrivateIpv4(dotted[1]);

  // URL parsing may normalize ::ffff:a.b.c.d to ::ffff:hhhh:hhhh hex form.
  const mappedHex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(value);
  if (mappedHex?.[1] && mappedHex[2]) {
    const high = Number.parseInt(mappedHex[1], 16);
    const low = Number.parseInt(mappedHex[2], 16);
    if (Number.isFinite(high) && Number.isFinite(low)) {
      const ipv4 = [
        (high >> 8) & 0xff,
        high & 0xff,
        (low >> 8) & 0xff,
        low & 0xff,
      ].join(".");
      return isPrivateIpv4(ipv4);
    }
  }

  if (value === "::" || value === "::1") return true;
  if (/^f[cd]/.test(value)) return true;
  if (/^fe[89ab]/.test(value)) return true;
  if (/^ff/.test(value)) return true;
  return false;
}

function isPrivateHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host) return true;
  if (isIpv4Literal(host)) return isPrivateIpv4(host);
  if (host.includes(":")) return isPrivateIpv6(host);
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host.endsWith(".local") || host.endsWith(".internal")) return true;
  return host === "metadata.google.internal" || host === "metadata.goog";
}

/**
 * Rejects anything that is not a plain public http(s) URL: non-web schemes,
 * embedded credentials, and hosts that point at loopback/private/link-local
 * or cloud-metadata addresses. Workers cannot reach RFC1918 ranges either;
 * this guard also protects the Node runtime.
 */
export function assertPublicHttpUrl(raw: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new UnsafeUrlError(`Rejected URL: ${describeUrl(raw)}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new UnsafeUrlError(
      `Rejected URL scheme ${parsed.protocol}: ${describeUrl(parsed.toString())}`,
    );
  }
  if (parsed.username || parsed.password) {
    throw new UnsafeUrlError(
      `Rejected URL with embedded credentials: ${describeUrl(parsed.toString())}`,
    );
  }
  if (isPrivateHost(parsed.hostname)) {
    throw new UnsafeUrlError(
      `Rejected private or internal host: ${parsed.hostname}`,
    );
  }
  return parsed;
}

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function assertContentLengthWithinLimit(res: Response, maxBytes: number): void {
  const header = res.headers.get("content-length");
  if (!header) return;
  const declared = Number(header);
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new UnsafeUrlError(
      `Response declared ${declared} bytes, over the ${maxBytes}-byte limit`,
    );
  }
}

export type GuardedFetchOptions = {
  headers?: Record<string, string>;
  timeoutMs?: number;
  maxBytes?: number;
};

/**
 * Fetch a user-supplied URL with policy enforcement: scheme/host validation,
 * manual redirect following with per-hop validation (so a public URL cannot
 * bounce the request at an internal address), a request timeout, and a
 * response size cap.
 */
export async function guardedFetch(
  rawUrl: string,
  options: GuardedFetchOptions = {},
): Promise<Response> {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  let current = assertPublicHttpUrl(rawUrl);

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const res = await fetch(current, {
      headers: options.headers,
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS),
    });

    if (!isRedirectStatus(res.status)) {
      assertContentLengthWithinLimit(res, maxBytes);
      return res;
    }

    const location = res.headers.get("location");
    if (!location) {
      throw new UnsafeUrlError(
        `Redirect without location from ${describeUrl(current.toString())}`,
      );
    }
    const next = new URL(location, current);
    assertPublicHttpUrl(next.toString());
    current = next;
  }

  throw new UnsafeUrlError(`Too many redirects for ${describeUrl(current.toString())}`);
}

/** Read a response body, refusing payloads over the size limit. */
export async function readTextWithinLimit(
  res: Response,
  maxBytes: number = DEFAULT_MAX_RESPONSE_BYTES,
): Promise<string> {
  const buffer = await res.arrayBuffer();
  if (buffer.byteLength > maxBytes) {
    throw new UnsafeUrlError(
      `Response body was ${buffer.byteLength} bytes, over the ${maxBytes}-byte limit`,
    );
  }
  return new TextDecoder().decode(buffer);
}
