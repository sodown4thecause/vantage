import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const text = z.string().trim().min(1);

const posts = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/posts' }),
  schema: z.object({
    title: text.max(70),
    description: z.string().trim().min(50).max(160),
    pubDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    author: text.default('Vantage Team'),
    tags: z.array(text).default([]),
    draft: z.boolean().default(false),
    // FAQ pairs render as visible Q&A and emit FAQPage JSON-LD (good for AEO/GEO).
    faq: z.array(z.object({ q: text, a: text })).min(1).optional(),
  }),
});

export const collections = { posts };
