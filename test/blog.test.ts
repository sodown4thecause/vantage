import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { OUTPUT_FILE, buildPosts, compilePost, parseFrontmatter, renderMarkdown, renderModule } from "../scripts/build-blog.mjs";
import { GET as llms } from "@/app/llms.txt/route";
import robots from "@/app/robots";
import { GET as rss } from "@/app/blog/rss.xml/route";
import * as postPage from "@/app/blog/[slug]/page";
import * as tagPage from "@/app/blog/tag/[tag]/page";
import { getAdjacentPosts, getAllPosts, getAllTags, getPost, getRelatedPosts } from "@/lib/blog";

const minimal = (extra = "", body = "Hello.") =>
  `---\ntitle: "A title"\ndescription: A description\ndate: 2026-01-02\n${extra}---\n${body}\n`;

describe("blog frontmatter", () => {
  it("parses scalars, inline lists, block lists and lists of objects", () => {
    const { data, body } = parseFrontmatter(
      [
        "---",
        'title: "Quoted: with colon"',
        "draft: true",
        "tags: [one, 'two', \"three\"]",
        "takeaways:",
        "  - First point",
        "  - Second point",
        "faq:",
        "  - q: Why?",
        "    a: Because.",
        "  - q: How?",
        "    a: Like this.",
        "---",
        "Body text",
      ].join("\n"),
    );
    expect(data.title).toBe("Quoted: with colon");
    expect(data.draft).toBe(true);
    expect(data.tags).toEqual(["one", "two", "three"]);
    expect(data.takeaways).toEqual(["First point", "Second point"]);
    expect(data.faq).toEqual([{ q: "Why?", a: "Because." }, { q: "How?", a: "Like this." }]);
    expect(body).toBe("Body text");
  });

  it("rejects files without frontmatter or required fields", () => {
    expect(() => compilePost("no-front.md", "# Just markdown")).toThrow(/frontmatter/);
    expect(() => compilePost("x.md", "---\ndescription: d\ndate: 2026-01-01\n---\n")).toThrow(/"title" is required/);
    expect(() => compilePost("x.md", "---\ntitle: t\ndescription: d\ndate: 01/02/2026\n---\n")).toThrow(/YYYY-MM-DD/);
    expect(() => compilePost("Bad Name.md", minimal())).toThrow(/slug/);
    expect(() => compilePost("x.md", minimal("faq:\n  - q: only a question\n"))).toThrow(/faq item 1/);
  });

  it("defaults updated, author and normalises tags into URL-safe slugs", () => {
    const post = compilePost("x.md", minimal("tags: [Community Marketing, reddit, reddit]\n"));
    expect(post.updated).toBe("2026-01-02");
    expect(post.author).toBe("The contextfor.dev team");
    expect(post.tags).toEqual(["community-marketing", "reddit"]);
    expect(post.readingMinutes).toBe(1);
  });
});

describe("blog markdown rendering", () => {
  it("gives headings unique anchor ids and builds a table of contents", () => {
    const { html, toc } = renderMarkdown("## What is it?\n\ntext\n\n### Details\n\n## What is it?\n");
    expect(html).toContain('<h2 id="what-is-it">');
    expect(html).toContain('<h2 id="what-is-it-1">');
    expect(toc).toEqual([
      { id: "what-is-it", text: "What is it?", depth: 2 },
      { id: "details", text: "Details", depth: 3 },
      { id: "what-is-it-1", text: "What is it?", depth: 2 },
    ]);
  });

  it("opens external links safely and keeps internal links in the tab", () => {
    const { html } = renderMarkdown("[ext](https://example.com) [int](/blog) [own](https://contextfor.dev/launch)");
    expect(html).toContain('<a href="https://example.com" rel="noopener" target="_blank">ext</a>');
    expect(html).toContain('<a href="/blog">int</a>');
    expect(html).toContain('<a href="https://contextfor.dev/launch">own</a>');
  });
});

describe("generated posts module", () => {
  it("is in sync with content/blog (run `pnpm blog:build` if this fails)", () => {
    expect(readFileSync(OUTPUT_FILE, "utf8")).toBe(renderModule(buildPosts()));
  });

  it("lists posts newest first with unique slugs", () => {
    const posts = getAllPosts();
    expect(posts.length).toBeGreaterThan(0);
    expect(new Set(posts.map((p) => p.slug)).size).toBe(posts.length);
    const dates = posts.map((p) => p.date);
    expect([...dates].sort().reverse()).toEqual(dates);
    for (const p of posts) expect(p.description.length).toBeLessThanOrEqual(160);
  });

  it("resolves posts, tags, related and adjacent posts", () => {
    const [newest, older] = getAllPosts();
    expect(getPost(newest.slug)).toBe(newest);
    expect(getPost("does-not-exist")).toBeNull();
    expect(getAllTags().length).toBeGreaterThan(0);
    expect(getRelatedPosts(newest).every((p) => p.slug !== newest.slug)).toBe(true);
    expect(getAdjacentPosts(newest.slug).newer).toBeNull();
    if (older) expect(getAdjacentPosts(newest.slug).older).toBe(older);
  });
});

describe("blog dynamic routes", () => {
  it("renders posts and tag pages per Worker request instead of relying on prerendered paths", () => {
    expect(postPage.dynamic).toBe("force-dynamic");
    expect("generateStaticParams" in postPage).toBe(false);
    expect("dynamicParams" in postPage).toBe(false);
    expect(tagPage.dynamic).toBe("force-dynamic");
    expect("generateStaticParams" in tagPage).toBe(false);
    expect("dynamicParams" in tagPage).toBe(false);
  });
});

describe("SEO routes", () => {
  it("serves a valid RSS feed with every post", async () => {
    const res = rss();
    expect(res.headers.get("content-type")).toContain("application/rss+xml");
    const body = await res.text();
    expect(body.startsWith('<?xml version="1.0"')).toBe(true);
    for (const p of getAllPosts()) expect(body).toContain(`/blog/${p.slug}</link>`);
  });

  it("serves llms.txt linking every post", async () => {
    const body = await llms().text();
    expect(body.startsWith("# contextfor.dev")).toBe(true);
    for (const p of getAllPosts()) expect(body).toContain(`/blog/${p.slug})`);
  });

  it("keeps app surfaces out of the index and allows answer engines on public pages", () => {
    const { rules, sitemap } = robots();
    const list = Array.isArray(rules) ? rules : [rules];
    for (const rule of list) {
      expect(rule.allow).toBe("/");
      expect(rule.disallow).toEqual(expect.arrayContaining(["/api/", "/queue", "/settings/"]));
      expect(rule.disallow).not.toContain("/blog");
    }
    expect(list.some((r) => Array.isArray(r.userAgent) && r.userAgent.includes("GPTBot"))).toBe(true);
    expect(sitemap).toMatch(/\/sitemap\.xml$/);
  });
});
