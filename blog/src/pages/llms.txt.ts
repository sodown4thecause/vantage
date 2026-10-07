import { getCollection } from 'astro:content';
import type { APIContext } from 'astro';

// llms.txt: a plain-text index of posts for LLM crawlers and agents.
export async function GET({ site }: APIContext) {
  const posts = (await getCollection('posts', (p) => !p.data.draft)).sort(
    (a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf(),
  );
  const lines = posts.map(
    (p) => `- [${p.data.title}](${new URL(`/posts/${p.id}/`, site).href}): ${p.data.description}`,
  );
  return new Response(
    `# Vantage Blog\n\n> Insights and playbooks from the Vantage team.\n\n## Posts\n\n${lines.join('\n')}\n`,
    { headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
  );
}
