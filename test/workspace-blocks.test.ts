import { describe, expect, it } from "vitest";

import { blockListSchema, blockSchema, parseBlocks, redditThreadBlocks, subredditFromUrl } from "@/lib/workspace/blocks";
import { rankingDistribution, referringDomainsOverTime, seoCardBlocks } from "@/app/seo/seo-blocks";

const thread = {
  type: "reddit_thread", subreddit: "SaaS", title: "How do you find your first customers?",
  url: "https://www.reddit.com/r/SaaS/comments/abc/first_customers/", score: 42,
  comments: [{ body: "Talk to people where they already hang out.", score: 12 }],
};

describe("block schema", () => {
  it("accepts a valid reddit_thread, table and chart", () => {
    expect(blockSchema.safeParse(thread).success).toBe(true);
    expect(blockSchema.safeParse({ type: "table", title: "Backlinks", columns: ["Domain", "Rank"], rows: [["a.com", 10], ["b.com", null]] }).success).toBe(true);
    expect(blockSchema.safeParse({ type: "chart", kind: "line", title: "Referring domains", points: [{ label: "2026-01", value: 3 }] }).success).toBe(true);
  });

  it("rejects unsafe links, ragged tables, unknown chart kinds and unknown types", () => {
    expect(blockSchema.safeParse({ ...thread, url: "javascript:alert(1)" }).success).toBe(false);
    expect(blockSchema.safeParse({ type: "table", title: "T", columns: ["A", "B"], rows: [["only one"]] }).success).toBe(false);
    expect(blockSchema.safeParse({ type: "chart", kind: "pie", title: "C", points: [{ label: "x", value: 1 }] }).success).toBe(false);
    expect(blockSchema.safeParse({ type: "chart", kind: "bar", title: "C", points: [{ label: "x", value: Number.NaN }] }).success).toBe(false);
    expect(blockSchema.safeParse({ type: "script", code: "alert(1)" }).success).toBe(false);
  });

  it("falls back to text for a block that fails validation and keeps the valid ones", () => {
    const blocks = parseBlocks([thread, { type: "table", title: "Broken table", columns: [], rows: [] }, "junk"]);
    expect(blocks).toHaveLength(3);
    expect(blocks[0]!.type).toBe("reddit_thread");
    expect(blocks[1]).toEqual({ type: "text", text: "Broken table (this visual couldn't be displayed)" });
    expect(blocks[2]).toEqual({ type: "text", text: "This visual couldn't be displayed." });
    expect(parseBlocks("not an array")).toEqual([]);
  });

  it("requires every block to validate when saving", () => {
    expect(blockListSchema.safeParse([thread]).success).toBe(true);
    expect(blockListSchema.safeParse([thread, { type: "chart" }]).success).toBe(false);
    expect(blockListSchema.safeParse([]).success).toBe(false);
  });
});

describe("redditThreadBlocks", () => {
  it("builds conversation cards from Reddit evidence only", () => {
    const blocks = redditThreadBlocks([{
      title: "Opportunity",
      evidence: [
        { title: "Need a tool for this", urlCanonical: "https://reddit.com/r/startups/comments/1/x/", platform: "reddit", contentMd: "Body", existingReplies: ["Try X", " "], score: 7 },
        { title: "HN post", urlCanonical: "https://news.ycombinator.com/item?id=1", platform: "hn", contentMd: "Body" },
      ],
    }]);
    expect(blocks).toEqual([expect.objectContaining({ subreddit: "startups", score: 7, comments: [{ body: "Try X", score: null }] })]);
  });

  it("reads the subreddit from the URL", () => {
    expect(subredditFromUrl("https://old.reddit.com/r/Entrepreneur/comments/1/")).toBe("Entrepreneur");
    expect(subredditFromUrl("https://example.com/")).toBeNull();
  });
});

describe("SEO card blocks", () => {
  it("maps referring domains to a table and a running-total line chart", () => {
    const rows = [
      { domain: "a.com", rank: 10, backlinks: 2, firstSeen: "2026-01-04" },
      { domain: "b.com", rank: 20, backlinks: 1, firstSeen: "2026-01-20" },
      { domain: "c.com", rank: 30, backlinks: 5, firstSeen: "2026-03-02" },
    ];
    expect(referringDomainsOverTime(rows)).toEqual([{ label: "2026-01", value: 2 }, { label: "2026-03", value: 3 }]);
    const blocks = seoCardBlocks({ tool: "referring_domains", title: "Referring domains", data: rows });
    expect(blocks.map((block) => block.type)).toEqual(["table", "chart"]);
  });

  it("maps ranked keywords to a table and a position bar chart", () => {
    const rows = [{ keyword: "a", position: 2 }, { keyword: "b", position: 8 }, { keyword: "c", position: 99 }];
    expect(rankingDistribution(rows).map((point) => point.value)).toEqual([1, 1, 0, 0, 1]);
    expect(seoCardBlocks({ tool: "ranked_keywords", title: "Rankings", data: rows }).map((block) => block.type)).toEqual(["table", "chart"]);
  });

  it("ignores cards it does not map", () => {
    expect(seoCardBlocks({ tool: "google_serp", title: "SERP", data: {} })).toEqual([]);
  });
});
