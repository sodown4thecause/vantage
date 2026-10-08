# Vantage blog

Static Astro site served by Cloudflare Workers (static assets). Independent of the Next.js app in the repo root; it has its own `package.json` and lockfile (npm).

Requires Node >= 22.12.

```bash
cd blog
npm ci
npm run dev                                  # http://localhost:4321
SITE_URL=https://blog.example.com npm run build
npm test                                     # builds fixtures and asserts on output
SITE_URL=https://blog.example.com npm run deploy
```

`SITE_URL` is required for `build`, `preview` and `deploy` (it feeds canonicals, sitemap, RSS and JSON-LD); the build fails without it.

Posts are Markdown/MDX in `src/content/posts/` (subfolders allowed). The frontmatter schema is in `src/content.config.ts`. Add a `faq:` list to emit visible Q&A plus `FAQPage` JSON-LD.
