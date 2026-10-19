import { peekDataForSeo, runDataForSeo } from "@/lib/dataforseo/gate";
import { TTL_SECONDS } from "@/lib/dataforseo/cache";

export type BacklinkSummary = {
  target: string;
  rank: number;
  backlinks: number;
  referringDomains: number;
  referringMainDomains: number;
  brokenBacklinks: number;
  spamScore: number;
  firstSeen: string | null;
};

export type ReferringDomain = { domain: string; rank: number; backlinks: number; spamScore: number; firstSeen: string | null };

export type Anchor = { anchor: string; backlinks: number; referringDomains: number };

export type BacklinkCall = { endpoint: string; task: Record<string, unknown>; estimateUsd: number };

type GateOptions = NonNullable<Parameters<typeof runDataForSeo>[1]>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const num = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);
const str = (value: unknown): string | null => (typeof value === "string" ? value : null);
const firstRecord = (result: unknown[]): Record<string, unknown> => (isRecord(result[0]) ? result[0] : {});
const items = (result: unknown[]): Record<string, unknown>[] => {
  const raw = firstRecord(result).items;
  return Array.isArray(raw) ? raw.filter(isRecord) : [];
};

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** Reduces user input to a bare public hostname, or null when it is not a domain we can look up. */
export function normalizeTarget(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  let host: string;
  try {
    host = new URL(withScheme).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (host.endsWith(".")) host = host.slice(0, -1);
  if (host.startsWith("www.")) host = host.slice(4);

  if (!host || host.length > 253 || !host.includes(".")) return null;
  if (host.includes(":") || host.startsWith("[") || IPV4.test(host)) return null;
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return null;
  if (!host.split(".").every(label => LABEL.test(label))) return null;
  return host;
}

/** Trims the DataForSEO summary result. Copies only typed primitives, so provider objects never reach the cache. */
export function trimSummary(result: unknown[]): BacklinkSummary {
  const row = firstRecord(result);
  return {
    target: str(row.target) ?? "",
    rank: num(row.rank),
    backlinks: num(row.backlinks),
    referringDomains: num(row.referring_domains),
    referringMainDomains: num(row.referring_main_domains),
    brokenBacklinks: num(row.broken_backlinks),
    spamScore: num(row.backlinks_spam_score),
    firstSeen: str(row.first_seen),
  };
}

/** Trims referring domain items; items without a string domain are dropped. */
export function trimReferringDomains(result: unknown[]): ReferringDomain[] {
  return items(result).flatMap((item) => {
    const domain = str(item.domain);
    if (domain === null) return [];
    return [{
      domain,
      rank: num(item.rank),
      backlinks: num(item.backlinks),
      spamScore: num(item.backlinks_spam_score),
      firstSeen: str(item.first_seen),
    }];
  });
}

/** Trims anchor items; items without a string anchor are dropped. */
export function trimAnchors(result: unknown[]): Anchor[] {
  return items(result).flatMap((item) => {
    const anchor = str(item.anchor);
    if (anchor === null) return [];
    return [{ anchor, backlinks: num(item.backlinks), referringDomains: num(item.referring_domains) }];
  });
}

/**
 * Competitor referring domains that do not already link to us, ignoring case, excluding our own domain,
 * highest rank first. `ownTarget` is our normalized domain; pass "" to skip that exclusion.
 */
export function referringDomainGap(own: ReferringDomain[], competitor: ReferringDomain[], ownTarget = ""): ReferringDomain[] {
  const have = new Set(own.map(row => row.domain.toLowerCase()));
  const self = ownTarget.toLowerCase();
  return competitor
    .filter(row => {
      const domain = row.domain.toLowerCase();
      return domain !== self && !have.has(domain);
    })
    .sort((a, b) => b.rank - a.rank);
}

const BACKLINK_FLAGS = { include_subdomains: true, exclude_internal_backlinks: true, backlinks_status_type: "live" } as const;

/** Summary call for a normalized target. */
export function summaryTask(target: string): BacklinkCall {
  return {
    endpoint: "/v3/backlinks/summary/live",
    task: { target, ...BACKLINK_FLAGS },
    estimateUsd: 0.025,
  };
}

/** Referring domains call (top 1000 by rank) for a normalized target. */
export function referringDomainsTask(target: string): BacklinkCall {
  return {
    endpoint: "/v3/backlinks/referring_domains/live",
    task: { target, ...BACKLINK_FLAGS, limit: 1000, order_by: ["rank,desc"] },
    estimateUsd: 0.0625,
  };
}

/** Anchors call (top 100 by backlinks) for a normalized target. */
export function anchorsTask(target: string): BacklinkCall {
  return {
    endpoint: "/v3/backlinks/anchors/live",
    task: { target, ...BACKLINK_FLAGS, limit: 100, order_by: ["backlinks,desc"] },
    estimateUsd: 0.03,
  };
}

/** Backlink summary through the spend gate. The target must already be normalized. */
export function fetchBacklinkSummary(workspaceId: string, target: string, opts?: GateOptions) {
  const call = summaryTask(target);
  return runDataForSeo<unknown, BacklinkSummary>({
    workspaceId,
    endpoint: call.endpoint,
    task: call.task,
    ttlSeconds: TTL_SECONDS.backlinks,
    estimateUsd: call.estimateUsd,
    trim: trimSummary,
  }, opts);
}

/** Referring domains through the spend gate. The target must already be normalized. */
export function fetchReferringDomains(workspaceId: string, target: string, opts?: GateOptions) {
  const call = referringDomainsTask(target);
  return runDataForSeo<unknown, ReferringDomain[]>({
    workspaceId,
    endpoint: call.endpoint,
    task: call.task,
    ttlSeconds: TTL_SECONDS.backlinks,
    estimateUsd: call.estimateUsd,
    trim: trimReferringDomains,
  }, opts);
}

/** Anchor texts through the spend gate. The target must already be normalized. */
export function fetchAnchors(workspaceId: string, target: string, opts?: GateOptions) {
  const call = anchorsTask(target);
  return runDataForSeo<unknown, Anchor[]>({
    workspaceId,
    endpoint: call.endpoint,
    task: call.task,
    ttlSeconds: TTL_SECONDS.backlinks,
    estimateUsd: call.estimateUsd,
    trim: trimAnchors,
  }, opts);
}

/** Cache-only read of all three backlink views for a normalized target. Never spends. */
export async function peekBacklinkReport(target: string): Promise<{
  summary: BacklinkSummary | null;
  referringDomains: ReferringDomain[] | null;
  anchors: Anchor[] | null;
}> {
  const s = summaryTask(target);
  const r = referringDomainsTask(target);
  const a = anchorsTask(target);
  const [summary, referringDomains, anchors] = await Promise.all([
    peekDataForSeo<BacklinkSummary>(s.endpoint, s.task),
    peekDataForSeo<ReferringDomain[]>(r.endpoint, r.task),
    peekDataForSeo<Anchor[]>(a.endpoint, a.task),
  ]);
  return { summary, referringDomains, anchors };
}
