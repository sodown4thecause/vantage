import { isPublicHttpUrl } from "@/lib/http/public-fetch";
import { resolveSourceChange, strategyChangeSchema, type StrategyChange } from "@/lib/gtm/proposals/types";
import type { DiscoveryPlan } from "./profile";
import type { ResearchEvidence } from "./types";

export type DiscoverySource = DiscoveryPlan["sources"][number];

function canonicalUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (!isPublicHttpUrl(url.href) || !["http:", "https:"].includes(url.protocol)) return null;
    url.hash = "";
    return url.href;
  } catch { return null; }
}

function terms(value: string): string[] {
  return [...new Set(value.toLowerCase().match(/[a-z0-9][a-z0-9.+#-]{2,}/g) ?? [])];
}

function matchesPlatform(type: DiscoverySource["type"], value: string, excerpt: string): boolean {
  const canonical = canonicalUrl(value);
  if (!canonical) return false;
  const url = new URL(canonical), host = url.hostname.toLowerCase();
  const pathSegments = url.pathname.toLowerCase().split("/").filter(Boolean);
  const hostLabels = host.split(".");
  switch (type) {
    case "hn": return host === "news.ycombinator.com" && url.pathname === "/item" && /^\d+$/.test(url.searchParams.get("id") ?? "") && /\b(?:ask hn|show hn|hacker news|points?|comments?)\b/i.test(excerpt);
    case "reddit": return /(^|\.)reddit\.com$/.test(host) && /^\/r\/[A-Za-z0-9_]{2,21}\/comments\/[A-Za-z0-9]+(?:\/|$)/i.test(url.pathname) && /\b(?:reddit|r\/[a-z0-9_]+|upvotes?|comments?)\b/i.test(excerpt);
    case "stackoverflow": return host === "stackoverflow.com" && /^\/questions\/\d+(?:\/|$)/.test(url.pathname) && /\b(?:stack overflow|asked|answers?|votes?)\b/i.test(excerpt);
    case "github": return host === "github.com" && /^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/issues\/\d+(?:\/|$)/.test(url.pathname) && /\b(?:github|issue|opened|closed|comments?|pull request)\b/i.test(excerpt);
    case "forums": return [...pathSegments, ...hostLabels].some(part => /^(?:forums?|threads?|topics?|discussions?|t)$/.test(part)) && /\b(?:forum|thread|topic|discussion|repl(?:y|ies))\b/i.test(excerpt);
    case "blogs": return [...pathSegments, ...hostLabels].some(part => /^(?:blogs?|articles?|posts?|insights?)$/.test(part)) && /\b(?:blog|article|author|published|publication|post)\b/i.test(excerpt);
  }
}

/** A sample must itself be a full verified page on the proposed platform, not a product-site link or model invention. */
export function groundSources(candidates: DiscoverySource[], evidence: ResearchEvidence[]): { sources: DiscoverySource[]; unknowns: string[] } {
  const byId = new Map(evidence.map(row => [row.id, row]));
  const sources: DiscoverySource[] = [];
  const unknowns: string[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const query = candidate.config.query.replace(/\s+/g, " ").trim();
    const key = `${candidate.type}:${query.toLowerCase()}:${candidate.config.subreddit?.toLowerCase() ?? ""}:${candidate.config.tag?.toLowerCase() ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const cited = candidate.evidenceIds.map(id => byId.get(id)!);
    const words = terms(query).filter(word => word.length > 3);
    const queryGrounded = words.length > 0 && cited.some(row => words.every(word => row.excerpt.toLowerCase().includes(word)));
    const sampleUrls = candidate.sampleUrls.map(canonicalUrl);
    const urlsGrounded = sampleUrls.length > 0 && sampleUrls.every(url => url !== null && cited.some(row => canonicalUrl(row.url) === url && matchesPlatform(candidate.type, url, row.excerpt)));
    if (!queryGrounded || !urlsGrounded) {
      unknowns.push(`The ${candidate.type} source proposal was withheld because its query or a full verified sample on that platform is unavailable.`);
      continue;
    }
    try { resolveSourceChange({ type: candidate.type, config: candidate.config, enabled: false }); }
    catch {
      unknowns.push(`The ${candidate.type} source proposal was withheld because its configuration is unsupported.`);
      continue;
    }
    sources.push({ ...candidate, config: { ...candidate.config, query }, sampleUrls: sampleUrls as string[] });
  }
  return { sources, unknowns };
}

/** Creates only an exact StrategyChange payload; createStrategyProposal persists it as pending. */
export function discoveryPlanToStrategyChange(plan: DiscoveryPlan, input: {
  currentProfile: { productUrl: string; productDescription: string; targetCustomer: string; competitors: string[]; topics: string[] } | null;
  exclusions?: string[];
}): StrategyChange {
  const payload: Record<string, unknown> = {};
  if (input.currentProfile) {
    const profile: Record<string, unknown> = {};
    if (plan.profile.productUrl !== input.currentProfile.productUrl) profile.productUrl = plan.profile.productUrl;
    if (plan.profile.productDescription !== input.currentProfile.productDescription) profile.productDescription = plan.profile.productDescription;
    if (plan.profile.targetCustomer !== input.currentProfile.targetCustomer) profile.targetCustomer = plan.profile.targetCustomer;
    if (plan.competitors.length >= 3) {
      const competitors = plan.competitors.slice(0, 5).map(row => row.domain);
      if (JSON.stringify(competitors) !== JSON.stringify(input.currentProfile.competitors)) payload.competitors = competitors;
    }
    if (Object.keys(profile).length) payload.profile = profile;
    if (plan.keywords.length && JSON.stringify(plan.keywords.map(row => row.term)) !== JSON.stringify(input.currentProfile.topics)) payload.keywords = plan.keywords.map(row => row.term);
  } else if (plan.keywords.length >= 1) {
    payload.profile = {
      productUrl: plan.profile.productUrl,
      docsUrls: [],
      productDescription: plan.profile.productDescription,
      targetCustomer: plan.profile.targetCustomer,
      ...(plan.competitors.length >= 3 ? { competitors: plan.competitors.slice(0, 5).map(row => row.domain) } : {}),
      topics: plan.keywords.map(row => row.term),
    };
  }
  if (plan.sources.length) payload.sources = plan.sources.map(row => ({ type: row.type, config: row.config, enabled: false }));
  if (input.exclusions?.length) payload.exclusions = [...new Set(input.exclusions.map(value => value.trim()).filter(Boolean))];
  return strategyChangeSchema.parse(payload);
}
