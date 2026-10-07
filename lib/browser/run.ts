import { recordCost, roundUsd } from "@/lib/costs/ledger";
import { getUnitCost } from "@/lib/costs/prices";
import { isPublicHttpUrl } from "@/lib/http/public-fetch";
import { getSourceSwitch } from "@/lib/sources/switch";

/**
 * The only module allowed to touch the Browser Run binding. Pages and
 * collectors call these helpers so SSRF checks, the platform denylist, the
 * source switch and cost recording cannot be skipped.
 */

export const BROWSER_RUN_SOURCE_KEY = "browser_run";
export const BROWSER_RUN_PROVIDER = "cloudflare_browser_run";
/** Workers Paid overage price, USD per browser hour. Used when provider_price has no row. */
export const DEFAULT_BROWSER_HOUR_USD = 0.09;
export const DEFAULT_TIMEOUT_MS = 20_000;
export const DEFAULT_MAX_BYTES = 1_000_000;
/** PNG screenshots routinely exceed 1 MB. */
export const DEFAULT_SCREENSHOT_MAX_BYTES = 10_000_000;
export const BROWSER_MS_HEADER = "X-Browser-Ms-Used";

/** Platforms whose terms or robots rules forbid a bot-identifying crawler. */
export const DENIED_HOSTS = [
  "reddit.com",
  "linkedin.com",
  "facebook.com",
  "instagram.com",
  "x.com",
  "twitter.com",
  // Short-link redirectors that land on the platforms above.
  "redd.it",
  "lnkd.in",
  "fb.com",
  "fb.me",
  "fb.watch",
  "instagr.am",
  "t.co",
] as const;

export type BrowserRunErrorCode =
  | "invalid_url"
  | "denied_host"
  | "source_paused"
  | "binding_missing"
  | "timeout"
  | "too_large"
  | "upstream_error"
  | "bad_response";

/** Messages are fixed strings: binding errors are logged server-side, never surfaced. */
export class BrowserRunError extends Error {
  constructor(
    readonly code: BrowserRunErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "BrowserRunError";
  }
}

export interface BrowserBinding {
  quickAction(name: string, params: Record<string, unknown>): Promise<Response>;
}

export type BrowserRunDeps = {
  getBinding: () => Promise<BrowserBinding | undefined> | BrowserBinding | undefined;
  getSwitch: typeof getSourceSwitch;
  record: typeof recordCost;
  getUnitCost: (action: string) => Promise<number>;
};

export type BrowserRunOptions = {
  timeoutMs?: number;
  maxBytes?: number;
  workspaceId?: string | null;
  /** Extra Quick Action parameters (viewport, gotoOptions, waitForSelector ...). Never put secrets here. */
  params?: Record<string, unknown>;
  /**
   * Explicit binding (or an env holding `BROWSER`). Use this from Workflows,
   * queue consumers and cron handlers, where no OpenNext request context exists.
   */
  binding?: BrowserBinding;
  env?: { BROWSER?: BrowserBinding };
  deps?: Partial<BrowserRunDeps>;
};

/** True only for a value that really exposes `quickAction`, so a mis-bound or stubbed `BROWSER` is treated as missing. */
export function isBrowserBinding(value: unknown): value is BrowserBinding {
  return typeof value === "object" && value !== null && "quickAction" in value && typeof value.quickAction === "function";
}

/** getCloudflareContext() only works inside an OpenNext request; anywhere else it throws. */
async function defaultGetBinding(): Promise<BrowserBinding | undefined> {
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const env: unknown = getCloudflareContext().env;
    const candidate = typeof env === "object" && env !== null && "BROWSER" in env ? env.BROWSER : undefined;
    return isBrowserBinding(candidate) ? candidate : undefined;
  } catch {
    return undefined;
  }
}

/** Browser Run is billed per browser hour whatever the quick action, so every action uses the one seeded hourly price. */
const PRICE_PROVIDER = "browser_run";
const PRICE_ACTION = "browser_hour";

/** Cached provider_price lookup for browser hours; getUnitCost falls back to the seeded default price. */
function defaultGetUnitCost(): Promise<number> {
  return getUnitCost(PRICE_PROVIDER, PRICE_ACTION);
}

function resolveDeps(opts: BrowserRunOptions): BrowserRunDeps {
  const explicit = opts.binding ?? opts.env?.BROWSER;
  return {
    getBinding: explicit ? () => explicit : defaultGetBinding,
    getSwitch: getSourceSwitch,
    record: recordCost,
    getUnitCost: defaultGetUnitCost,
    ...opts.deps,
  };
}

export function isDeniedHost(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  return DENIED_HOSTS.some((d) => h === d || h.endsWith(`.${d}`));
}

/** Throws unless the URL is public http(s) and not on a denied platform. Returns the normalized URL. */
export function assertBrowsableUrl(url: string): string {
  if (typeof url !== "string" || !isPublicHttpUrl(url)) {
    throw new BrowserRunError("invalid_url", "A public HTTP(S) URL is required.");
  }
  const parsed = new URL(url);
  if (isDeniedHost(parsed.hostname)) {
    throw new BrowserRunError(
      "denied_host",
      "Browser Run is not used for this platform (terms of service).",
    );
  }
  return parsed.href;
}

type Invocation = {
  action: string;
  params: Record<string, unknown>;
};

async function readCapped(response: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel();
    throw new BrowserRunError("too_large", "Browser Run output exceeds the size limit.");
  }
  if (!response.body) return new Uint8Array(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        throw new BrowserRunError("too_large", "Browser Run output exceeds the size limit.");
      }
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

/** Shared pipeline: switch, binding call with timeout, size cap, cost row. */
async function run(
  inv: Invocation,
  opts: BrowserRunOptions,
): Promise<{ body: Uint8Array; ms: number }> {
  const deps = resolveDeps(opts);
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;

  const decision = await deps.getSwitch(BROWSER_RUN_SOURCE_KEY);
  if (!decision.enabled) {
    throw new BrowserRunError("source_paused", `Browser Run is ${decision.state}: ${decision.reason}`);
  }
  const binding = await deps.getBinding();
  if (!binding) {
    throw new BrowserRunError("binding_missing", "Browser Run is not configured.");
  }

  const started = Date.now();
  let ms = 0;
  let measured = false;
  let ok = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const call = (async () => {
      const response = await binding.quickAction(inv.action, { ...opts.params, ...inv.params });
      const header = Number(response.headers.get(BROWSER_MS_HEADER));
      if (response.headers.has(BROWSER_MS_HEADER) && Number.isFinite(header) && header >= 0) {
        ms = header;
        measured = true;
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        console.error("[browser-run] upstream status", { action: inv.action, status: response.status });
        throw new BrowserRunError("upstream_error", "Browser Run request failed.");
      }
      return readCapped(response, maxBytes);
    })();
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new BrowserRunError("timeout", "Browser Run timed out.")),
        timeoutMs,
      );
    });
    call.catch(() => undefined); // a late rejection after timeout must not be unhandled
    const body = await Promise.race([call, timeout]);
    ok = true;
    return { body, ms };
  } catch (err) {
    if (err instanceof BrowserRunError) throw err;
    console.error("[browser-run] binding error", {
      action: inv.action,
      error: err instanceof Error ? err.name : "unknown",
    });
    throw new BrowserRunError("upstream_error", "Browser Run request failed.");
  } finally {
    if (timer) clearTimeout(timer);
    // Without the header (or on timeout, where the call may still be running
    // and billing) fall back to wall time so billable time is never recorded as $0.
    if (!measured) {
      ms = Date.now() - started;
      console.error("[browser-run] no X-Browser-Ms-Used; using wall time", { action: inv.action, ms });
    }
    // cost_event.units is numeric(14,4): hours would truncate, so units are seconds
    // (0.1 ms resolution) priced per second. getUnitCost returns USD per hour.
    const hourly = await deps.getUnitCost(inv.action).catch(() => DEFAULT_BROWSER_HOUR_USD);
    await deps.record({
      sourceKey: BROWSER_RUN_SOURCE_KEY,
      provider: BROWSER_RUN_PROVIDER,
      action: inv.action,
      units: ms / 1000,
      unitCostUsd: roundUsd(hourly / 3600),
      workspaceId: opts.workspaceId ?? null,
      ok,
      chargedOnFailure: !ok,
    });
  }
}

function parseResult(body: Uint8Array): unknown {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(body));
  } catch {
    throw new BrowserRunError("bad_response", "Browser Run returned an unreadable response.");
  }
  if (typeof parsed !== "object" || parsed === null || !("result" in parsed) || ("success" in parsed && parsed.success === false)) {
    throw new BrowserRunError("bad_response", "Browser Run returned an unexpected response.");
  }
  return parsed.result;
}

export async function browserMarkdown(
  url: string,
  opts: BrowserRunOptions = {},
): Promise<{ markdown: string; ms: number }> {
  const href = assertBrowsableUrl(url);
  const { body, ms } = await run({ action: "markdown", params: { url: href } }, opts);
  const result = parseResult(body);
  if (typeof result !== "string") {
    throw new BrowserRunError("bad_response", "Browser Run returned an unexpected response.");
  }
  return { markdown: result, ms };
}

/**
 * AI extraction. `schema` is a JSON Schema describing the output. Without `opts.validate` the data is
 * `unknown` and must be checked by the caller; pass `validate` (e.g. a zod parse) to get a typed result.
 */
// Overload order matters: the validator overload must come first so options held in a variable still get
// the validated type instead of falling through to the broad `unknown` overload.
export async function browserJson<T>(
  url: string,
  schema: Record<string, unknown>,
  opts: BrowserRunOptions & { prompt?: string; validate: (value: unknown) => T },
): Promise<{ data: T; ms: number }>;
export async function browserJson(
  url: string,
  schema: Record<string, unknown>,
  opts?: BrowserRunOptions & { prompt?: string },
): Promise<{ data: unknown; ms: number }>;
export async function browserJson(
  url: string,
  schema: Record<string, unknown>,
  opts: BrowserRunOptions & { prompt?: string; validate?: (value: unknown) => unknown } = {},
): Promise<{ data: unknown; ms: number }> {
  const href = assertBrowsableUrl(url);
  const params: Record<string, unknown> = {
    url: href,
    response_format: { type: "json_schema", json_schema: schema },
  };
  if (opts.prompt) params.prompt = opts.prompt;
  const { body, ms } = await run({ action: "json", params }, opts);
  const result = parseResult(body);
  let data: unknown;
  try {
    data = opts.validate ? opts.validate(result) : result;
  } catch {
    throw new BrowserRunError("bad_response", "Browser Run output did not match the schema.");
  }
  return { data, ms };
}

export async function browserScreenshot(
  input: { url?: string; html?: string },
  opts: BrowserRunOptions = {},
): Promise<{ png: Uint8Array; ms: number }> {
  const href = input.url !== undefined ? assertBrowsableUrl(input.url) : undefined;
  if (href === undefined && typeof input.html !== "string") {
    throw new BrowserRunError("invalid_url", "A public HTTP(S) URL or HTML is required.");
  }
  const params = href !== undefined ? { url: href } : { html: input.html };
  const { body, ms } = await run(
    { action: "screenshot", params },
    { maxBytes: DEFAULT_SCREENSHOT_MAX_BYTES, ...opts },
  );
  return { png: body, ms };
}

export async function browserLinks(url: string, opts: BrowserRunOptions = {}): Promise<string[]> {
  const href = assertBrowsableUrl(url);
  const { body } = await run({ action: "links", params: { url: href } }, opts);
  const result = parseResult(body);
  if (!Array.isArray(result) || !result.every((l) => typeof l === "string")) {
    throw new BrowserRunError("bad_response", "Browser Run returned an unexpected response.");
  }
  return result;
}
