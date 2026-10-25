import { PgDialect } from "drizzle-orm/pg-core";
import { getTableColumns } from "drizzle-orm";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ select: vi.fn(), from: vi.fn(), where: vi.fn(), order: vi.fn(), limit: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ getDb: () => ({ select: mocks.select }) }));

import { HeroExamples } from "@/components/hero-examples";
import { ProductTourBox } from "@/components/product-tour-box";
import { heroExample } from "@/lib/db/schema";
import { approvedHeroExamples, validHeroExcerpt } from "@/lib/public/hero-examples";

const fields = ["platform", "community", "title", "sourceUrl", "excerpt", "postedAt"];
const example = { platform: "reddit", community: "r/synthetic", title: "Synthetic source", sourceUrl: "https://example.com/thread", excerpt: "Synthetic quoted text", postedAt: "2026-10-20T00:00:00.000Z" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.select.mockReturnValue({ from: mocks.from });
  mocks.from.mockReturnValue({ where: mocks.where });
  mocks.where.mockReturnValue({ orderBy: mocks.order });
  mocks.order.mockReturnValue({ limit: mocks.limit });
  mocks.limit.mockResolvedValue([]);
});

describe("public-safe approved examples", () => {
  it("has no workspace, opportunity, score, draft or wholesale payload columns", () => {
    expect(Object.keys(getTableColumns(heroExample))).toEqual(["id", ...fields, "approvedBy", "approvedAt"]);
  });

  it("selects only display fields and excludes every row without both approval fields", async () => {
    expect(await approvedHeroExamples()).toEqual([]);
    expect(Object.keys(mocks.select.mock.calls[0][0])).toEqual(fields);
    expect(mocks.from).toHaveBeenCalledWith(heroExample);
    const predicate = new PgDialect().sqlToQuery(mocks.where.mock.calls[0][0]);
    expect(predicate.sql).toBe('("hero_example"."approved_by" is not null and "hero_example"."approved_at" is not null)');
    expect(predicate.params).toEqual([]);
    expect(mocks.limit).toHaveBeenCalledWith(3);
    expect(renderToStaticMarkup(<HeroExamples examples={await approvedHeroExamples()} />)).toBe("");
  });

  it("returns only permitted display fields, never account details or identifiers", async () => {
    mocks.limit.mockResolvedValue([{ ...example, postedAt: new Date(example.postedAt), approvedBy: "private-actor", approvedAt: new Date(), id: "private-id", workspaceId: "private-workspace", score: 1, drafts: "private" }]);
    const rows = await approvedHeroExamples();
    expect(rows).toEqual([example]);
    const html = renderToStaticMarkup(<HeroExamples examples={rows} />);
    expect(html).toContain("Synthetic quoted text");
    expect(html).toContain('href="https://example.com/thread"');
    expect(html).not.toContain("private");
    expect(html).not.toContain("score");
  });

  it("discards an unsafe source URL rather than rendering it", async () => {
    mocks.limit.mockResolvedValue([{ ...example, sourceUrl: "javascript:alert(1)", postedAt: new Date() }]);
    expect(await approvedHeroExamples()).toEqual([]);
  });

  it("hides the empty examples block while keeping email capture visible", () => {
    expect(renderToStaticMarkup(<HeroExamples examples={[]} />)).toBe("");
    const html = renderToStaticMarkup(<ProductTourBox />);
    expect(html).toContain('id="lead-email"');
    expect(html).toContain("Save my interest");
    expect(html).toContain("nothing is sent");
    expect(html).not.toContain('id="hero-examples-heading"');
    expect(html).not.toContain("Synthetic source");
  });

  it("requires a non-empty exact quote of at most 25 words", () => {
    expect(validHeroExcerpt("", "text")).toBe(false);
    expect(validHeroExcerpt("text", "Text")).toBe(false);
    expect(validHeroExcerpt("a b", "a\nb")).toBe(false);
    expect(validHeroExcerpt("text", "some text here")).toBe(true);
  });
});
