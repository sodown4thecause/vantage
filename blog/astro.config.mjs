import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';

// SITE_URL (e.g. https://blog.example.com) drives canonicals, sitemap, RSS and
// JSON-LD. Builds fail without it so a deploy can never publish placeholder
// URLs; only `astro dev` falls back to localhost.
const isDev = process.argv.includes('dev');
const site = process.env.SITE_URL || (isDev ? 'http://localhost:4321' : undefined);

if (!site) {
  throw new Error('SITE_URL is required to build the blog, e.g. SITE_URL=https://blog.example.com npm run build');
}

export default defineConfig({
  site,
  output: 'static',
  trailingSlash: 'always',
  integrations: [mdx(), sitemap()],
});
