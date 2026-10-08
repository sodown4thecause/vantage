import type { APIContext } from 'astro';

// All crawlers (search and AI) are allowed; add Disallow rules here to opt out of specific bots.
export function GET({ site }: APIContext) {
  return new Response(
    `User-agent: *\nAllow: /\n\nSitemap: ${new URL('sitemap-index.xml', site).href}\n`,
    { headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
  );
}
