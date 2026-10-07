/**
 * Diagnostic (not part of the protocol): does TinyFish Search (the free,
 * non-browser path) return Reddit URLs for our topic, where the browser agent
 * is blocked? Also probes YouTube search.
 *
 * Run with:
 *   pnpm tsx experiments/tinyfish-agent-reliability/diag-search.ts ["query"]
 */

import { createClient, loadLocalEnv, redact } from "./lib";

async function main(): Promise<void> {
  loadLocalEnv();
  const query = process.argv[2]?.trim() || "free AI GTM signal buzz tool";
  const client = createClient();

  const probes = [
    { label: "reddit", q: `${query} site:reddit.com`, domains: "reddit.com" },
    { label: "youtube", q: `${query} site:youtube.com`, domains: "youtube.com" },
  ];

  for (const probe of probes) {
    try {
      const res = await client.search.query({
        query: probe.q,
        include_domains: probe.domains,
      });
      const results = res.results ?? [];
      console.log(`[diag-search] ${probe.label}: ${results.length} results for "${probe.q}"`);
      for (const r of results.slice(0, 5)) {
        console.log(`  - ${r.title.slice(0, 70)}`);
        console.log(`    ${r.url}`);
      }
    } catch (err) {
      console.warn(
        `[diag-search] ${probe.label} failed: ${redact(err instanceof Error ? err.message : String(err))}`,
      );
    }
  }
}

main().catch((err) => {
  console.error(`[diag-search] fatal: ${redact(err instanceof Error ? err.message : String(err))}`);
  process.exitCode = 1;
});
