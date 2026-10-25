import type { PublicHeroExample } from "@/lib/public/hero-examples";

export function HeroExamples({ examples }: { examples: PublicHeroExample[] }) {
  if (examples.length === 0) return null;
  return <section aria-labelledby="hero-examples-heading">
    <h2 id="hero-examples-heading">Real conversation examples</h2>
    <p>Selected and approved by Vantage. These illustrate existing picks, not a live scan for your product.</p>
    <ul>{examples.map((example) => <li key={example.sourceUrl}>
      <p>{example.platform} · {example.community} · <time dateTime={example.postedAt}>{example.postedAt.slice(0, 10)}</time></p>
      <h3><a href={example.sourceUrl} target="_blank" rel="noopener noreferrer">{example.title}</a></h3>
      <blockquote><a href={example.sourceUrl} target="_blank" rel="noopener noreferrer">“{example.excerpt}”</a></blockquote>
    </li>)}</ul>
  </section>;
}
