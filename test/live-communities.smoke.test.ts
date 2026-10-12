/**
 * Live smoke test: do developer forums, blogs and subreddits show up for a real product profile?
 * Runs the production collectors against TinyFish (Firecrawl when TinyFish search fails). Writes
 * nothing to the database. Skipped unless LIVE_SMOKE=1, so `pnpm test` and CI never call providers.
 *
 *   LIVE_SMOKE=1 TINYFISH_API_KEY=... pnpm vitest run test/live-communities.smoke.test.ts
 *   SMOKE_PRODUCT=https://example.com SMOKE_TOPICS="topic one,topic two" LIVE_SMOKE=1 pnpm vitest run test/live-communities.smoke.test.ts
 *
 * Needs outbound HTTPS to api.search.tinyfish.ai and api.fetch.tinyfish.ai (api.firecrawl.dev for the fallback).
 */
import { expect, it, vi } from "vitest";

// Cost rows need a database; the smoke run only reads providers.
vi.mock("@/lib/costs/ledger", () => ({ recordCost: async () => {} }));
vi.mock("@/lib/costs/prices", () => ({ getUnitCost: async () => 0 }));

import { redditCollector } from "@/lib/collectors/reddit";
import type { CollectorResult } from "@/lib/collectors/types";
import { webDiscussionsCollector } from "@/lib/collectors/web-discussions";
import { bareHost, WEB_DISCUSSIONS_PROVIDER } from "@/lib/collectors/web-provider";

const PRODUCT = process.env.SMOKE_PRODUCT ?? "https://www.contextfor.dev";
/** Topics a contextfor.dev owner would enter at onboarding (from the live landing page). */
const TOPICS = process.env.SMOKE_TOPICS?.split(",").map(t => t.trim()).filter(Boolean)
  ?? ["social listening", "reddit lead generation", "buying intent"];

function report(label: string, result: CollectorResult) {
  const lines = result.documents.map(doc => {
    const meta = (doc.metadata ?? {}) as Record<string, unknown>;
    const where = typeof meta.site === "string" ? meta.site : typeof meta.subreddit === "string" ? `r/${meta.subreddit}` : "";
    return `  [${doc.platform}] ${where} · ${doc.postedAt?.toISOString().slice(0, 10) ?? "undated"} · ${doc.title}\n      ${doc.urlCanonical} (${String(meta.provider)}, ${String(meta.contentKind)})`;
  });
  console.log(`\n## ${label}\n${lines.join("\n")}${result.coverageReason ? `\n  coverage: ${result.coverageReason}` : ""}`);
}

it.skipIf(process.env.LIVE_SMOKE !== "1")(`finds forums, blogs and subreddits for ${PRODUCT}`, async () => {
  const ownHost = bareHost(PRODUCT);
  const base = { workspaceId: "00000000-0000-4000-8000-000000000000", sourceId: "smoke", cursor: null };
  const web = await webDiscussionsCollector.run({ ...base, config: {
    provider: WEB_DISCUSSIONS_PROVIDER, queries: TOPICS, kinds: ["forum", "blog"], maxResults: 20, lookbackHours: 168,
    excludeHosts: ownHost ? [ownHost] : [],
  } });
  report("Dev forums & blogs", web);
  const reddit = await redditCollector.run({ ...base, config: { queries: TOPICS, limit: 12 } });
  report("Reddit", reddit);

  const subreddits = new Set(reddit.documents.map(d => (d.metadata as Record<string, unknown>)?.subreddit).filter(Boolean));
  console.log(`\nSummary for ${TOPICS.join(" | ")}: ${web.documents.filter(d => d.platform === "forum").length} forum threads, ` +
    `${web.documents.filter(d => d.platform === "blog").length} blog posts, ${reddit.documents.length} Reddit threads in ${subreddits.size} subreddits`);
  expect(web.documents.some(d => d.platform === "forum")).toBe(true);
  expect(web.documents.some(d => d.platform === "blog")).toBe(true);
  expect(reddit.documents.length).toBeGreaterThan(0);
  expect(web.documents.filter(d => bareHost(d.urlCanonical) === ownHost)).toEqual([]);
}, 180_000);
