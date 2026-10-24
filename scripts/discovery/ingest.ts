import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseCsv, writeCsv, type Row } from "./csv";
import { createProbe, type Probe } from "./probe";

export const files = ["communities-input.csv", "buyer-requests-input.csv", "rules-input.csv", "directories-input.csv"] as const;
const unknown = "unknown";
const known = (value?: string) => Boolean(value && value !== unknown);
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const unique = (values: string[]) => [...new Set(values.filter(known))].sort(compare).join("; ") || unknown;
const tri = (value?: string) => value === "yes" || value === "no" ? value : unknown;
const agree = (values: string[]) => { const distinct = [...new Set(values.filter(known))]; return distinct.length === 1 ? distinct[0] : unknown; };

export function subreddit(value: string): string | null {
  const match = /^(?:r\/)?([a-z0-9_]{2,21})$/i.exec(value.trim());
  return match ? match[1].toLowerCase() : null;
}

export function domain(value: string): string {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("Invalid input URL");
  return url.hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
}

type Input = Record<(typeof files)[number], Row[]>;
type Reference = { file: string; record: number; source: string; checked_date: string };
type Group = { key: string; rows: Row[]; references: Reference[] };
export type Community = Row & { name: string; url: string; type: string; topic: string; est_size: string; public_readable: string; has_api_or_rss: string; allows_self_promo: string; source_file: string };

export function normalise(input: Input) {
  const required = [
    ["name", "url", "platform", "tool", "members", "readable_without_login", "rss_or_api", "self_promo_rule"],
    ["community", "title", "text_excerpt", "url"],
    ["community", "rules_url", "policy_clef", "regex_policy", "quote"],
    ["name", "submit_url", "category", "cost", "dofollow", "requirements", "evidence_url"],
  ];
  files.forEach((file, index) => {
    for (const row of input[file]) if (required[index].some(header => !(header in row))) throw new Error(`Missing columns in ${file}`);
  });
  for (const file of files) for (const row of input[file]) {
    if (!known(row.source) || !/^\d{4}-\d{2}-\d{2}$/.test(row.checked_date ?? "")) throw new Error(`Missing provenance in ${file}`);
  }
  const groups = new Map<string, Group>();
  const add = (key: string, row: Row, file: string, index: number) => {
    let group = groups.get(key);
    if (!group) { group = { key, rows: [], references: [] }; groups.set(key, group); }
    group.rows.push(row);
    group.references.push({ file, record: index + 2, source: row.source, checked_date: row.checked_date });
  };
  input[files[0]].forEach((row, index) => {
    const host = domain(row.url);
    const sub = host === "reddit.com" ? subreddit(new URL(row.url).pathname.split("/")[2] ?? "") : null;
    if (host === "reddit.com" && !sub) throw new Error("Invalid subreddit URL");
    add(sub ? `reddit:${sub}` : host, row, files[0], index);
  });
  for (const file of [files[1], files[2]]) input[file].forEach((row, index) => {
    const sub = subreddit(row.community);
    if (!sub) throw new Error(`Invalid subreddit in ${file}`);
    add(`reddit:${sub}`, row, file, index);
  });
  const communities: Community[] = [];
  const subreddits: Row[] = [];
  const evidence: Array<{ key: string; names: string[]; references: Reference[]; buyer_examples: string[]; observed_requests: number }> = [];
  for (const group of [...groups.values()].sort((a, b) => compare(a.key, b.key))) {
    const sub = group.key.startsWith("reddit:") ? group.key.slice(7) : null;
    const seeds = group.rows.filter(row => row.name);
    const rules = group.rows.filter(row => row.rules_url);
    const threads = group.rows.filter(row => row.title && row.url);
    const requests = threads.filter(row => /alternativ|recommend|looking for|what (?:tools?|do you use)|which .*(?:tool|agent|model)|best .*(?:tool|agent|model)/i.test(`${row.title} ${row.text_excerpt}`));
    const examples = [...new Set(requests.map(row => row.url))].sort(compare);
    const rule = unique(rules.map(row => `${row.policy_clef} (classifier); ${row.regex_policy} (regex); quote: ${row.quote || unknown}`));
    const chosen = [...seeds].sort((a, b) => a.url.length - b.url.length || compare(a.url, b.url))[0];
    const promo = agree(rules.map(row => row.policy_clef === "never" && row.regex_policy === "never" ? "no" : unknown));
    const community: Community = {
      name: sub ? `r/${sub}` : chosen.name,
      url: sub ? `https://www.reddit.com/r/${sub}/` : chosen.url,
      type: sub ? "Reddit" : unique(seeds.map(row => row.platform)),
      topic: unique(seeds.map(row => row.tool)),
      est_size: agree(seeds.map(row => /^\d+$/.test(row.members) ? row.members : unknown)),
      public_readable: agree(seeds.map(row => tri(row.readable_without_login))),
      has_api_or_rss: agree(seeds.map(row => tri(row.rss_or_api))),
      allows_self_promo: promo,
      source_file: unique(group.references.map(ref => ref.file)),
    };
    communities.push(community);
    evidence.push({ key: group.key, names: [...new Set(seeds.map(row => row.name))].sort(compare), references: group.references, buyer_examples: examples, observed_requests: examples.length });
    if (sub) subreddits.push({ subreddit: sub, members: community.est_size, topic: community.topic,
      buyer_intent: examples.length ? `${examples.length} observed request(s) in dated pilot; not prevalence` : unknown,
      self_promo_rule: rule !== unknown ? rule : unique(seeds.map(row => row.self_promo_rule)), example_url: examples[0] ?? unknown });
  }
  const directoryGroups = new Map<string, Row[]>();
  input[files[3]].forEach(row => {
    const key = domain(row.submit_url);
    directoryGroups.set(key, [...(directoryGroups.get(key) ?? []), row]);
  });
  const directories = [...directoryGroups.entries()].sort(([a], [b]) => compare(a, b)).map(([key, rows]) => ({
    name: unique(rows.map(row => row.name)), submit_url: [...rows].sort((a, b) => compare(a.submit_url, b.submit_url))[0].submit_url,
    category: unique(rows.map(row => row.category)), cost: agree(rows.map(row => row.cost)), dofollow: agree(rows.map(row => tri(row.dofollow))), requirements: unique(rows.map(row => row.requirements)),
    key,
  }));
  const directoryEvidence = [...directoryGroups.entries()].sort(([a], [b]) => compare(a, b)).map(([key, rows]) => ({ key,
    references: rows.map(row => ({ file: files[3], record: input[files[3]].indexOf(row) + 2, source: row.source, checked_date: row.checked_date, evidence_url: row.evidence_url })) }));
  return { communities, subreddits, directories, evidence, directoryEvidence };
}

export function coverage(community: Community): { status: string; evidence: string } {
  if (community.type === "Reddit") return { status: "existing capability", evidence: "lib/sources/keys.ts; lib/collectors/registry.ts; lib/collectors/reddit.ts (query/subreddit); live configuration unknown" };
  if (community.type === "GitHub Discussions") return { status: "new collector needed", evidence: "lib/collectors/github.ts only searches issues; Discussions are not covered" };
  if (community.type === "Discord") return { status: "new collector needed", evidence: "lib/collectors/registry.ts has no Discord collector; landing-page readability is not message access" };
  return { status: "feed configuration needed", evidence: "lib/sources/keys.ts; lib/collectors/registry.ts; lib/collectors/rss.ts accepts feedUrl; a verified feed URL is required" };
}

export async function ingest(sourceDir: string, outputDir: string, revision: string, online: boolean) {
  if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error("Pass the exact 40-character input revision with --revision");
  const input = {} as Input;
  const hashes: Record<string, string> = {};
  for (const file of files) {
    const text = await readFile(join(sourceDir, file), "utf8");
    hashes[file] = createHash("sha256").update(text).digest("hex");
    input[file] = parseCsv(text);
  }
  const result = normalise(input);
  await mkdir(outputDir, { recursive: true });
  const probe = createProbe(join(outputDir, ".cache"), online);
  const checks: Probe[] = [];
  try {
    for (const item of result.communities) {
      if (item.has_api_or_rss !== unknown) continue;
      const base = item.url.endsWith("/") ? item.url : `${item.url}/`;
      for (const path of ["feed", "rss", ".rss", ...(item.type === "Discourse" ? ["latest.json"] : [])]) {
        const checked = await probe.check(new URL(path, base).toString());
        if (!checked) continue;
        checks.push(checked);
        if (checked.result === "yes") { item.has_api_or_rss = "yes"; break; }
      }
    }
  } finally { await probe.close(); }
  const coverageRows = result.communities.map((item, index) => {
    const observed = result.evidence[index].observed_requests;
    const access = item.type === "Discord" ? 0 : item.public_readable === "yes" ? 2 : 0;
    const score = Math.min(observed, 5) * 10 + access + (item.has_api_or_rss === "yes" ? 1 : 0);
    const current = coverage(item);
    return { name: item.name, url: item.url, collector_coverage: current.status, evidence: current.evidence,
      buyer_requests: String(observed), public_readable: item.public_readable, has_api_or_rss: item.has_api_or_rss, score: String(score),
      buyer_evidence: result.evidence[index].buyer_examples.join("; ") || unknown };
  });
  const ranked = [...coverageRows].sort((a, b) => Number(b.score) - Number(a.score) || compare(a.name, b.name));
  const newLanes = ranked.filter(row => row.collector_coverage !== "existing capability").slice(0, 20);
  const rankedSubs = ranked.filter(row => row.name.startsWith("r/")).slice(0, 20);
  const rankedDirs = [...result.directories].sort((a, b) => Number(/^free/i.test(b.cost)) - Number(/^free/i.test(a.cost)) || Number(b.dofollow === "yes") - Number(a.dofollow === "yes") || compare(a.name, b.name)).slice(0, 20);
  const table = (headers: string[], rows: string[][]) => [headers, headers.map(() => "---"), ...rows].map(row => `| ${row.map(cell => cell.replace(/\|/g, "\\|").replace(/[\r\n]+/g, " ")).join(" | ")} |`).join("\n");
  const outputs: Record<string, string> = {
    "communities.csv": writeCsv(["name", "url", "type", "topic", "est_size", "public_readable", "has_api_or_rss", "allows_self_promo", "source_file"], result.communities),
    "subreddits.csv": writeCsv(["subreddit", "members", "topic", "buyer_intent", "self_promo_rule", "example_url"], result.subreddits),
    "directories.csv": writeCsv(["name", "submit_url", "category", "cost", "dofollow", "requirements"], result.directories),
    "coverage.csv": writeCsv(["name", "url", "collector_coverage", "evidence", "buyer_requests", "public_readable", "has_api_or_rss", "score", "buyer_evidence"], coverageRows),
    "manifest.json": JSON.stringify({ version: 1, revision, inputs: files.map(file => ({ file, sha256: hashes[file], rows: input[file].length })),
      counts: { communities: result.communities.length, subreddits: result.subreddits.length, directories: result.directories.length },
      firecrawl: { calls: 0, credits: 0, limit: 300 }, probes: [...new Map(checks.map(check => [check.url, check])).values()],
      communities: result.evidence, directories: result.directoryEvidence }, null, 2) + "\n",
    "README.md": `# Local CSV import\n\nInput revision: \`${revision}\`. Generated output may contain private input values. Keep all outputs and caches outside public commits.\n\n## Rerun\n\nRun \`pnpm exec tsx scripts/discovery/ingest.ts --source-dir=<local-input-directory> --output-dir=<private-output-directory> --revision=<40-character-input-revision>\` from the repository root. Inputs: \`${files.join("\`, \`")}\`. Every input row requires source and checked_date. No bundled research inputs are provided.\n\nThe default is offline. Add \`--check-feeds\` only when authorised to make public-network GET requests for missing feed/API values. Requests are sequential and limited to one per second, including redirects. URL and connection-time DNS checks reject private networks. Failed checks remain unknown. Receipts, not response bodies, are cached under the output directory's .cache. Identical inputs and cache produce stable offline output.\n\n## Counts\n\n${table(["Input", "Rows"], files.map(file => [file, String(input[file].length)]))}\n\nOutput: ${result.communities.length} communities, ${result.subreddits.length} subreddits, ${result.directories.length} directories. Domain keys deduplicate communities and directories; Reddit keys use the lower-case subreddit. Shared hosts collapse distinct audiences; the manifest preserves names and source record references. Conflicting known values become unknown.\n\n## Cost and limitations\n\nNo paid provider client is present. Firecrawl: 0 calls, 0 credits. Retained HTTP receipts record ${[...new Map(checks.map(check => [check.url, check])).values()].reduce((sum, check) => sum + check.requests, 0)} requests. This is a local research utility, not production coverage verification or permission to promote, submit, post or contact anyone.\n\nCoverage labels describe collector code capabilities, not any workspace's live configuration. Ranking is a heuristic: 10 × min(5, distinct request examples) + 2 for reported public readability (excluding Discord landing pages) + 1 for reported/probed API or RSS. No matched requests means unknown intent, not no demand. Promotion classifiers may conflict; original rules still require human review.\n\n## Community candidates (up to 20)\n\n${table(["Community", "Score", "Observed requests", "Coverage"], ranked.slice(0, 20).map(row => [row.name, row.score, row.buyer_requests, row.collector_coverage]))}\n\n## New coverage candidates (up to 20)\n\n${table(["Candidate", "Score", "Readable", "API/RSS", "Work needed"], newLanes.map(row => [row.name, row.score, row.public_readable, row.has_api_or_rss, row.collector_coverage]))}\n\n## Subreddit candidates (up to 20)\n\n${table(["Subreddit", "Score", "Observed requests", "Example"], rankedSubs.map(row => [row.name, row.score, row.buyer_requests, row.buyer_evidence.split("; ")[0]]))}\n\n## Directory candidates (up to 20)\n\nSort reported free-first, then reported dofollow, then name. These fields do not prove buyer demand.\n\n${table(["Directory", "Cost", "Dofollow", "Submission URL"], rankedDirs.map(row => [row.name, row.cost, row.dofollow, row.submit_url]))}\n`,
  };
  for (const [file, text] of Object.entries(outputs)) await writeFile(join(outputDir, file), text);
  return { ...result, newLanes, requests: probe.requests };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => !/^(--source-dir=|--output-dir=|--revision=|--check-feeds$)/.test(arg))) throw new Error("Unknown argument");
  const option = (name: string) => args.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
  const source = option("source-dir");
  if (!source) throw new Error("Pass --source-dir=<local input directory>");
  const result = await ingest(resolve(source), resolve(option("output-dir") ?? "data/discovery"), option("revision") ?? "", args.includes("--check-feeds"));
  console.log(JSON.stringify({ communities: result.communities.length, subreddits: result.subreddits.length, directories: result.directories.length, http_requests: result.requests, firecrawl_calls: 0, firecrawl_credits: 0 }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error instanceof Error ? error.message : "Discovery ingestion failed"); process.exitCode = 1; });
}
