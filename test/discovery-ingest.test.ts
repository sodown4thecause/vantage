import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseCsv, writeCsv } from "@/scripts/discovery/csv";
import { coverage, files, ingest, normalise } from "@/scripts/discovery/ingest";

const provenance = { source: "test API snapshot", checked_date: "2000-01-01" };
const seed = { ...provenance, name: "r/Synthetic_Lane_01", url: "https://www.reddit.com/r/Synthetic_Lane_01/", platform: "Reddit", tool: "Synthetic editor", members: "123", readable_without_login: "yes", rss_or_api: "yes", self_promo_rule: "unclear" };
const inputs = () => ({
  [files[0]]: [seed],
  [files[1]]: [{ ...provenance, community: "r/synthetic_lane_01", title: "Looking for an alternative", text_excerpt: "", url: "https://www.reddit.com/r/synthetic_lane_01/comments/example/" }],
  [files[2]]: [{ ...provenance, community: "r/SYNTHETIC_LANE_01", rules_url: "https://www.reddit.com/r/synthetic_lane_01/about/rules/", policy_clef: "never", regex_policy: "allowed_with_disclosure", quote: "Read the rules" }],
  [files[3]]: [{ ...provenance, name: "Example", submit_url: "https://www.example.com/submit", category: "ai", cost: "free", dofollow: "unknown", requirements: "unknown", evidence_url: "https://example.com/" }],
});

describe("discovery CSV", () => {
  it("round-trips BOM, CRLF, commas, quotes and multiline fields", () => {
    const rows = [{ name: 'a, "quoted" name', notes: "first\nsecond", empty: "" }];
    expect(parseCsv("\uFEFF" + writeCsv(["name", "notes", "empty"], rows).replace(/\n/g, "\r\n"))).toEqual(rows);
  });
  it.each(['a,a\n1,2\n', 'a,b\n1\n', 'a\n"unfinished', 'a\n"closed"suffix'])("rejects malformed CSV %s", (text) => {
    expect(() => parseCsv(text)).toThrow();
  });
});

describe("discovery normalisation", () => {
  it("joins case-insensitive subreddits, dedupes examples and preserves rule conflicts", () => {
    const input = inputs();
    input[files[1]].push(input[files[1]][0]);
    const result = normalise(input);
    expect(result.communities).toHaveLength(1);
    expect(result.communities[0]).toMatchObject({ name: "r/synthetic_lane_01", est_size: "123", allows_self_promo: "unknown" });
    expect(result.subreddits[0]).toMatchObject({ subreddit: "synthetic_lane_01", buyer_intent: "1 observed request(s) in dated pilot; not prevalence" });
    expect(result.subreddits[0].self_promo_rule).toContain("never (classifier); allowed_with_disclosure (regex)");
    expect(result.evidence[0].references).toHaveLength(4);
    expect(coverage(result.communities[0]).status).toBe("existing capability");
  });
  it("dedupes domains but preserves all provenance and conflicting numeric claims", () => {
    const input = inputs();
    input[files[0]].push({ ...seed, name: "Forum one", platform: "GitHub Discussions", url: "https://github.com/example-owner/example-repo-one/discussions", members: "100" },
      { ...seed, name: "Forum two", platform: "GitHub Discussions", url: "https://www.github.com/example-owner/example-repo-two/discussions", members: "200" });
    input[files[3]].push({ ...input[files[3]][0], submit_url: "https://example.com/submit/", cost: "paid" });
    const result = normalise(input);
    expect(result.communities).toHaveLength(2);
    const github = result.communities.find(row => row.type === "GitHub Discussions")!;
    expect(github.est_size).toBe("unknown");
    expect(coverage(github).status).toBe("new collector needed");
    expect(result.evidence.find(row => row.key === "github.com")?.names).toEqual(["Forum one", "Forum two"]);
    expect(result.directories).toHaveLength(1);
    expect(result.directories[0].cost).toBe("unknown");
  });
  it("does not invent member counts, topics or readability from rule-only rows", () => {
    const input = inputs();
    input[files[2]].push({ ...input[files[2]][0], community: "r/Other" });
    expect(normalise(input).communities.find(row => row.name === "r/other")).toMatchObject({ est_size: "unknown", topic: "unknown", public_readable: "unknown", has_api_or_rss: "unknown" });
  });
  it("rejects rows without provenance and non-HTTP seed URLs", () => {
    const input = inputs();
    input[files[0]][0] = { ...seed, source: "unknown" };
    expect(() => normalise(input)).toThrow("provenance");
    input[files[0]][0] = { ...seed, url: "file:///secret" };
    expect(() => normalise(input)).toThrow("URL");
  });
});

describe("offline ingestion", () => {
  const dirs: string[] = [];
  afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
  it("produces identical outputs without network or paid providers", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vantage-discovery-")); dirs.push(dir);
    const input = inputs();
    for (const file of files) await writeFile(join(dir, file), writeCsv(Object.keys(input[file][0]), input[file]));
    const output = join(dir, "output");
    const result = await ingest(dir, output, "a".repeat(40), false);
    expect(result.requests).toBe(0);
    const generated = ["communities.csv", "subreddits.csv", "directories.csv", "coverage.csv", "manifest.json", "README.md"];
    const before = await Promise.all(generated.map(file => readFile(join(output, file), "utf8")));
    await ingest(dir, output, "a".repeat(40), false);
    expect(await Promise.all(generated.map(file => readFile(join(output, file), "utf8")))).toEqual(before);
    expect(JSON.parse(before[4]).firecrawl).toEqual({ calls: 0, credits: 0, limit: 300 });
  });
});
