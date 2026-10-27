import type { Metadata } from "next";
import Link from "next/link";

import { PageHead, Shell } from "@/components/shell";
import { absoluteUrl } from "@/lib/site";

const PATH = "/reddit-rss-shutdown";
const TITLE = "Reddit RSS ends 13 November 2026: keep your Reddit monitoring running";
const DESCRIPTION =
  "Reddit stops RSS feeds on 13 November 2026 and closes its public Data API by March 2027. contextfor.dev finds Reddit threads through public web search, not RSS or the Reddit API, so your monitoring keeps working.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: absoluteUrl(PATH) },
  openGraph: { title: TITLE, description: DESCRIPTION, url: absoluteUrl(PATH) },
};

const ANNOUNCEMENT_URL =
  "https://www.reddit.com/r/modnews/comments/1wubgvt/continuing_our_infrastructure_updates_whats";
const API_TIMELINE_URL =
  "https://www.reddit.com/r/redditdev/comments/1wubcvf/moving_data_api_apps_to_the_developer_platform";
const GUMMYSEARCH_URL = "https://gummysearch.com/closing-time/";

const TIMELINE: { date: string; what: string }[] = [
  { date: "31 October 2026", what: "Reddit stops accepting new requests for public Data API access." },
  { date: "13 November 2026", what: "Reddit RSS feeds stop. Subreddit, search and user feeds go quiet in every reader and automation." },
  { date: "12 January 2027", what: "Reddit starts removing API access for apps that haven't registered with its Developer Platform." },
  { date: "March 2027", what: "Remaining public Data API access closes." },
];

const FAQ: { q: string; a: string }[] = [
  {
    q: "Does contextfor.dev use Reddit RSS or the Reddit Data API?",
    a: "No. We find Reddit threads through public web search, then read the public thread. Neither the 13 November RSS shutdown nor the March 2027 API closure changes how we find conversations.",
  },
  {
    q: "Is it as instant as an RSS feed?",
    a: "Not quite. A thread shows up once search has indexed it, which is usually within hours. In exchange you get a short, ranked list instead of every new post.",
  },
  {
    q: "Can I import my OPML file or Zapier flows?",
    a: "Not yet. Paste the subreddits and keywords from your old feeds or zaps into your product profile and sources. It takes a few minutes.",
  },
  {
    q: "Can I still add RSS feeds?",
    a: "Yes, for anything that isn't Reddit: blogs, Substack, changelogs and newsletters. Reddit feed URLs will stop returning posts after 13 November, so add those subreddits as Reddit sources instead.",
  },
  {
    q: "I used GummySearch. What carries over?",
    a: "Your audiences become subreddits and keywords here, and the Reddit side runs alongside Hacker News, X, YouTube, Product Hunt and more. Export your GummySearch data before your access ends.",
  },
  {
    q: "Will it post or reply for me?",
    a: "Never. contextfor.dev finds and ranks conversations and can brief a reply. You write and post every reply yourself, from your own account.",
  },
];

const faqJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: FAQ.map(({ q, a }) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })),
};

export default function RedditRssShutdownPage() {
  return (
    <Shell section="how">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />
      <PageHead
        title="Reddit RSS ends on 13 November. Your Reddit monitoring doesn't have to."
        lede="If a feed reader, a Zapier or n8n flow, or GummySearch is how you keep up with Reddit, it's about to go quiet. contextfor.dev finds Reddit threads through public web search, not RSS or the Reddit API, so it keeps working."
      />

      <div className="flex flex-wrap gap-3">
        <Link href="/auth/sign-up" className="btn">Create a free account</Link>
        <Link href="/tour" className="underline underline-offset-4">Tour the workspace</Link>
      </div>

      <section aria-labelledby="whats-changing" className="mt-12">
        <h2 id="whats-changing" className="text-2xl font-bold">What Reddit is changing, and when</h2>
        <ol className="mt-4 space-y-3">
          {TIMELINE.map((t) => (
            <li key={t.date} className="rounded-lg border border-contour p-4">
              <p className="font-bold">{t.date}</p>
              <p className="text-ridge">{t.what}</p>
            </li>
          ))}
        </ol>
        <p className="mt-4 text-sm text-ridge">
          Sources: Reddit&apos;s <a href={ANNOUNCEMENT_URL} className="underline">r/modnews announcement</a> (30 September 2026) and its{" "}
          <a href={API_TIMELINE_URL} className="underline">r/redditdev API timeline</a>. Reddit says there is no replacement for RSS outside communities you moderate.
        </p>
      </section>

      <section aria-labelledby="who-breaks" className="mt-12">
        <h2 id="who-breaks" className="text-2xl font-bold">What stops working</h2>
        <ul className="mt-4 list-disc space-y-2 pl-6">
          <li><strong>Feed readers</strong> subscribed to subreddit, search or user feeds (anything ending in <code>.rss</code>).</li>
          <li><strong>Zapier, n8n and Make flows</strong> that start from a Reddit RSS trigger: keyword alerts to Slack, leads into a sheet, mentions into your inbox.</li>
          <li><strong>Home-made scripts</strong> that poll Reddit feeds or the public API for keywords.</li>
          <li>
            <strong>GummySearch setups.</strong> GummySearch <a href={GUMMYSEARCH_URL} className="underline">closed on 30 November 2025</a>, and the last lifetime-deal access ends on 30 November 2026.
          </li>
        </ul>
      </section>

      <section aria-labelledby="how-we-find" className="mt-12">
        <h2 id="how-we-find" className="text-2xl font-bold">How contextfor.dev finds Reddit threads</h2>
        <p className="mt-4">
          We find threads through public web search and read the public page. There are no RSS URLs and no Reddit API keys to break. Every thread is scored for fit, intent, evidence, momentum and timing, and lands in a short ranked list in your queue.
        </p>
        <p className="mt-4">
          Reddit sources refresh when you press <strong>Scan now</strong>, and on your first scan. Scheduled scans and the daily email cover your other sources, so press Scan now whenever you want fresh Reddit threads.
        </p>
        <p className="mt-4">
          Reddit is one source. The same list covers Hacker News, X, YouTube, Product Hunt, GitHub, Stack Overflow and your own non-Reddit RSS feeds, so you stop stitching together one alert per site.
        </p>
      </section>

      <section aria-labelledby="switch" className="mt-12">
        <h2 id="switch" className="text-2xl font-bold">Switch before 13 November</h2>
        <ol className="mt-4 list-decimal space-y-2 pl-6">
          <li>Write down the subreddits and keywords your feeds, zaps or GummySearch audiences watch.</li>
          <li><Link href="/auth/sign-up" className="underline">Create a free account</Link> and paste your product&apos;s URL. Onboarding suggests topics, competitors and communities.</li>
          <li>Add your subreddits and keywords as sources.</li>
          <li>Read your first ranked conversations. Press Scan now when you want fresh Reddit threads, and turn off the old flow once you&apos;re happy.</li>
        </ol>
      </section>

      <section aria-labelledby="faq" className="mt-12">
        <h2 id="faq" className="text-2xl font-bold">Questions</h2>
        <dl className="mt-4 space-y-6">
          {FAQ.map(({ q, a }) => (
            <div key={q}>
              <dt className="font-bold">{q}</dt>
              <dd className="mt-1 text-ridge">{a}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="mt-12 rounded-lg border border-contour p-6">
        <h2 className="text-xl font-bold">Keep watching Reddit after 13 November</h2>
        <p className="mt-2 text-ridge">Free to start. You write every reply; we never post for you.</p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link href="/auth/sign-up" className="btn">Create a free account</Link>
          <Link href="/pricing" className="underline underline-offset-4">See pricing</Link>
        </div>
      </section>
    </Shell>
  );
}
