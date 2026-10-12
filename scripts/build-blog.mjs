#!/usr/bin/env node
/**
 * Compiles content/blog/*.md into lib/blog/posts.generated.ts.
 *
 * Posts are rendered to HTML here, at build time, so the Worker ships plain
 * strings: no filesystem access at runtime (Workers has none) and no Markdown
 * parser in the bundle.
 *
 *   node scripts/build-blog.mjs          write the generated module
 *   node scripts/build-blog.mjs --check  exit 1 if the module is out of date
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Marked } from "marked";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const CONTENT_DIR = join(ROOT, "content", "blog");
export const OUTPUT_FILE = join(ROOT, "lib", "blog", "posts.generated.ts");

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const WORDS_PER_MINUTE = 225;
const DEFAULT_AUTHOR = "The contextfor.dev team";

/** Strips matching quotes and unescapes the YAML subset we accept. */
function scalar(raw) {
  const v = raw.trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1).replace(/\\"/g, '"');
  }
  if (v === "true") return true;
  if (v === "false") return false;
  return v;
}

function inlineList(raw) {
  const inner = raw.trim().slice(1, -1).trim();
  if (!inner) return [];
  return inner.split(",").map((s) => scalar(s)).filter((s) => s !== "");
}

/**
 * Parses the frontmatter subset used by posts: `key: value`, `key: [a, b]`,
 * block lists (`- item`) and block lists of flat objects (`- q: ...` / `  a: ...`).
 * @param {string} source
 * @returns {{ data: Record<string, any>, body: string }}
 */
export function parseFrontmatter(source) {
  const text = source.replace(/^﻿/, "").replace(/\r\n/g, "\n");
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text);
  if (!match) throw new Error("missing frontmatter (the file must start with a --- block)");
  const [, head, body] = match;
  /** @type {Record<string, any>} */
  const data = {};
  let listKey = null;
  let current = null;
  for (const line of head.split("\n")) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const top = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (top) {
      const [, key, value] = top;
      current = null;
      if (value === "") {
        data[key] = [];
        listKey = key;
      } else {
        data[key] = value.trim().startsWith("[") ? inlineList(value) : scalar(value);
        listKey = null;
      }
      continue;
    }
    if (!listKey) throw new Error(`cannot parse frontmatter line: ${line.trim()}`);
    const item = /^\s+-\s+(.*)$/.exec(line);
    if (item) {
      const pair = /^([A-Za-z][\w-]*):\s+(.*)$/.exec(item[1]);
      if (pair) {
        current = { [pair[1]]: scalar(pair[2]) };
        data[listKey].push(current);
      } else {
        current = null;
        data[listKey].push(scalar(item[1]));
      }
      continue;
    }
    const cont = /^\s+([A-Za-z][\w-]*):\s+(.*)$/.exec(line);
    if (cont && current) {
      current[cont[1]] = scalar(cont[2]);
      continue;
    }
    throw new Error(`cannot parse frontmatter line: ${line.trim()}`);
  }
  return { data, body };
}

export function slugify(text) {
  return text
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/&[a-z]+;|&#\d+;/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/[\s-]+/g, "-");
}

function plainText(html) {
  return html.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

/** Renders Markdown to HTML, giving h2/h3 stable ids and collecting them as a table of contents. */
export function renderMarkdown(markdown) {
  const toc = [];
  const used = new Map();
  const marked = new Marked({ gfm: true });
  marked.use({
    renderer: {
      heading({ tokens, depth }) {
        const inner = this.parser.parseInline(tokens);
        const text = plainText(inner);
        let id = slugify(text) || "section";
        const seen = used.get(id) ?? 0;
        used.set(id, seen + 1);
        if (seen) id = `${id}-${seen}`;
        if (depth === 2 || depth === 3) toc.push({ id, text, depth });
        return `<h${depth} id="${id}"><a href="#${id}" class="heading-anchor">${inner}</a></h${depth}>\n`;
      },
      link({ href, title, tokens }) {
        const inner = this.parser.parseInline(tokens);
        const external = /^https?:\/\//i.test(href) && !/^https?:\/\/(www\.)?contextfor\.dev(\/|$)/i.test(href);
        const t = title ? ` title="${title}"` : "";
        const rel = external ? ' rel="noopener" target="_blank"' : "";
        return `<a href="${href}"${t}${rel}>${inner}</a>`;
      },
    },
  });
  const html = marked.parse(markdown, { async: false });
  return { html, toc };
}

export function readingMinutes(markdown) {
  const words = markdown.replace(/```[\s\S]*?```/g, " ").split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / WORDS_PER_MINUTE));
}

function requireString(data, key, file) {
  const v = data[key];
  if (typeof v !== "string" || !v.trim()) throw new Error(`${file}: "${key}" is required`);
  return v.trim();
}

/** Validates one post file and returns the record stored in the generated module. */
export function compilePost(file, source) {
  const slug = file.replace(/\.md$/, "");
  if (!SLUG_RE.test(slug)) throw new Error(`${file}: file name must be a lowercase-hyphenated slug`);
  const { data, body } = parseFrontmatter(source);
  const title = requireString(data, "title", file);
  const description = requireString(data, "description", file);
  const date = requireString(data, "date", file);
  if (!DATE_RE.test(date) || Number.isNaN(Date.parse(date))) throw new Error(`${file}: "date" must be YYYY-MM-DD`);
  const updated = typeof data.updated === "string" && data.updated ? data.updated : date;
  if (!DATE_RE.test(updated) || Number.isNaN(Date.parse(updated))) throw new Error(`${file}: "updated" must be YYYY-MM-DD`);
  const tags = Array.isArray(data.tags) ? [...new Set(data.tags.map((t) => slugify(String(t))).filter(Boolean))] : [];
  const takeaways = Array.isArray(data.takeaways) ? data.takeaways.map(String) : [];
  const faq = Array.isArray(data.faq)
    ? data.faq.map((entry, i) => {
        if (!entry || typeof entry !== "object" || !entry.q || !entry.a) throw new Error(`${file}: faq item ${i + 1} needs "q" and "a"`);
        return { question: String(entry.q), answer: String(entry.a) };
      })
    : [];
  const { html, toc } = renderMarkdown(body);
  return {
    slug,
    title,
    description,
    date,
    updated,
    author: typeof data.author === "string" && data.author ? data.author : DEFAULT_AUTHOR,
    tags,
    image: typeof data.image === "string" && data.image ? data.image : null,
    imageAlt: typeof data.imageAlt === "string" && data.imageAlt ? data.imageAlt : null,
    takeaways,
    faq,
    readingMinutes: readingMinutes(body),
    toc,
    html,
    draft: data.draft === true,
  };
}

/** Compiles every post in `dir`, newest first, drafts excluded. */
export function buildPosts(dir = CONTENT_DIR) {
  if (!existsSync(dir)) return [];
  const posts = readdirSync(dir)
    .filter((f) => f.endsWith(".md") && !f.startsWith("_") && f !== "README.md")
    .sort()
    .map((f) => compilePost(f, readFileSync(join(dir, f), "utf8")))
    .filter((p) => !p.draft)
    .map((p) => {
      delete p.draft;
      return p;
    });
  posts.sort((a, b) => (a.date === b.date ? a.slug.localeCompare(b.slug) : b.date.localeCompare(a.date)));
  return posts;
}

export function renderModule(posts) {
  return [
    "// Generated by scripts/build-blog.mjs from content/blog/*.md. Do not edit by hand;",
    "// run `pnpm blog:build` after adding or changing a post.",
    'import type { Post } from "./types";',
    "",
    `export const posts: Post[] = ${JSON.stringify(posts, null, 2)};`,
    "",
  ].join("\n");
}

function main() {
  const check = process.argv.includes("--check");
  const posts = buildPosts();
  const next = renderModule(posts);
  const current = existsSync(OUTPUT_FILE) ? readFileSync(OUTPUT_FILE, "utf8") : "";
  if (check) {
    if (current !== next) {
      console.error("lib/blog/posts.generated.ts is out of date. Run `pnpm blog:build` and commit the result.");
      process.exit(1);
    }
    console.log("blog: generated module is up to date");
    return;
  }
  if (current !== next) writeFileSync(OUTPUT_FILE, next);
  console.log(`blog: compiled ${posts.length} post(s)`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (err) {
    console.error(`blog: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
