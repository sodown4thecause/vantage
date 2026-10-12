export type TocEntry = { id: string; text: string; depth: number };

export type FaqEntry = { question: string; answer: string };

/** One compiled post. Produced by scripts/build-blog.mjs from content/blog/<slug>.md. */
export type Post = {
  slug: string;
  title: string;
  description: string;
  /** YYYY-MM-DD */
  date: string;
  /** YYYY-MM-DD; equals `date` when the post was never revised. */
  updated: string;
  author: string;
  tags: string[];
  image: string | null;
  imageAlt: string | null;
  /** Short answer-first bullets shown above the article (and quoted by answer engines). */
  takeaways: string[];
  faq: FaqEntry[];
  readingMinutes: number;
  toc: TocEntry[];
  /** Rendered at build time from the author's own Markdown in this repo. */
  html: string;
};
