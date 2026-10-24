import Link from "next/link";
import type { Metadata } from "next";

import { JsonLd } from "@/components/json-ld";
import { Shell } from "@/components/shell";
import { ProductTourBox } from "@/components/product-tour-box";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/server";
import { getCurrentWorkspace } from "@/lib/auth/workspace";
import { formatDate, getAllPosts } from "@/lib/blog";
import { createWorkspaceForCurrentUser } from "@/lib/db/actions";
import { getLatestMonitoringProfile } from "@/lib/profile/repository";
import { SOURCES, absoluteUrl } from "@/lib/site";

import styles from "./home.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { absolute: "Vantage: the go-to-market workspace for AI and developer tools" },
  description: "Find the conversations worth joining. Search research and content drafting are coming soon. You write every reply; Vantage never posts for you.",
};

async function startWorkspace(form: FormData) {
  "use server";
  const workspace = await createWorkspaceForCurrentUser(String(form.get("name") ?? ""));
  if (!workspace) throw new Error("Workspace could not be created.");
  redirect(`/onboarding?workspaceId=${encodeURIComponent(workspace.id)}`);
}

const STEPS: { title: string; body: string }[] = [
  {
    title: "Paste your URL",
    body: "We draft your profile, you confirm. Your product and audience guide what we find.",
  },
  {
    title: "Review five conversations",
    body: "Review your daily picks and the sources behind them. Your local-hour digest keeps the list close.",
  },
  {
    title: "Copy, open and reply",
    body: "Copy your reply, open the source and decide what to say. Vantage never posts, comments or votes on your behalf.",
  },
];

const SCORES: [string, string][] = [
  ["Fit", "How closely the poster's problem matches your product."],
  ["Intent", "Whether they are asking for a solution or just venting."],
  ["Evidence", "How many posts and sources back the opportunity."],
  ["Momentum", "Whether the conversation is still growing."],
  ["Timing", "How recent it is, so a reply still lands."],
];

const NEVER: [string, string][] = [
  ["Post, comment or DM for you", "Every reply goes out from your own account, written by you."],
  ["Pass off sample data as real leads", "Anything from fixtures is labelled as sample data and kept out of your live queue."],
  ["Bury you in alerts", "The daily list stops at five. A thin day gets a shorter list, not filler."],
];

const FAQ: { q: string; a: string }[] = [
  {
    q: "Does Vantage post replies for me?",
    a: "No. It finds and ranks conversations, and can suggest an approach, but it never posts, comments or sends messages on your behalf. You write and send every reply from your own account.",
  },
  {
    q: "Which sites does it read?",
    a: `${SOURCES.slice(0, -1).join(", ")}, plus any RSS feeds you add. You choose which sources each workspace watches and can pause any of them.`,
  },
  {
    q: "How many conversations will I get?",
    a: "Up to five a day. They appear in your queue, and the daily digest emails them at the hour you pick. If fewer conversations clear the bar, you get fewer.",
  },
  {
    q: "How are conversations ranked?",
    a: "Each one gets five scores: fit with your product, buying intent, the evidence behind it, momentum, and timing. The list is ordered by those scores, and each opportunity shows them so you can see why it ranked.",
  },
  {
    q: "Is there a free plan?",
    a: "Yes. Start free to set up a workspace and explore relevant conversations. See pricing for current plan limits and upgrade options.",
  },
];

export default async function Home() {
  const { data: session } = await auth.getSession();
  const workspace = session?.user ? await getCurrentWorkspace() : null;
  if (workspace) {
    const profile = await getLatestMonitoringProfile(workspace.id);
    redirect(`/${profile ? "workspace" : "onboarding"}?workspaceId=${encodeURIComponent(workspace.id)}`);
  }
  const latest = getAllPosts().slice(0, 3);

  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "Organization",
      "@id": absoluteUrl("/#organization"),
      name: "Vantage",
      url: absoluteUrl("/"),
    },
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      "@id": absoluteUrl("/#website"),
      name: "Vantage",
      url: absoluteUrl("/"),
      publisher: { "@id": absoluteUrl("/#organization") },
    },
    {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: "Vantage",
      url: absoluteUrl("/"),
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      description: "Vantage finds conversations worth joining. You write every reply; Vantage never posts for you.",
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD", description: "Free plan" },
      publisher: { "@id": absoluteUrl("/#organization") },
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: FAQ.map(({ q, a }) => ({
        "@type": "Question",
        name: q,
        acceptedAnswer: { "@type": "Answer", text: a },
      })),
    },
  ];

  return (
    <Shell wide>
      <JsonLd data={jsonLd} />
      <div className={styles.home}>
        <section className={styles.hero} aria-labelledby="home-heading">
          <p className={styles.eyebrow}>Launch is the new bottleneck.</p>
          <h1 id="home-heading">You can ship in a weekend. Getting noticed still takes a team.</h1>
          <p className={styles.intro}>
            Vantage is the go-to-market workspace for AI and developer tools. It finds
            conversations worth joining and puts the evidence in front of you. You write every reply.
          </p>
          <p className={styles.claimNote}>Search reporting and content drafting <span className={styles.badge}>Coming soon</span>.</p>
          <ProductTourBox />
          {session?.user ? (
            <form action={startWorkspace} className={styles.createForm}>
              <label htmlFor="workspace-name">Name your workspace</label>
              <div>
                <input id="workspace-name" name="name" required maxLength={100}
                  autoComplete="organization" placeholder="Acme Analytics" />
                <button className={styles.primary}>Create workspace <span aria-hidden="true">↗</span></button>
              </div>
            </form>
          ) : (
            <>
              <div className={styles.heroActions}>
                <Link href="/auth/sign-up" className={styles.primary}>Start free <span aria-hidden="true">↗</span></Link>
                <Link href="/pricing" className={styles.secondary}>See pricing <span aria-hidden="true">→</span></Link>
              </div>
              <p className={styles.signIn}>Already have an account? <Link href="/auth/sign-in">Sign in</Link></p>
            </>
          )}
        </section>

        <section className={styles.section} aria-labelledby="mission-heading">
          <div className={styles.sectionHeading}><p className={styles.eyebrow}>Our mission</p><h2 id="mission-heading">Everyone’s shipping. Few are launching.</h2></div>
          <p className={styles.mission}>AI agents made building fast. Distribution didn’t keep up. Launching still means stitching together a listening tool, an SEO suite, an AI-visibility tracker, a link-building service and a content calendar, then finding the hours to use them. Vantage puts it in one workspace run by an AI that knows your product.</p>
          <p className={styles.claimNote}>That’s the direction. Search reporting and content drafting are coming soon. Vantage never publishes for you.</p>
          <div className={styles.tiles}>
            <article><h3>Social listening</h3><p>Up to five ranked conversations a day. You write every reply; Vantage never posts.</p></article>
            <article><h3>SEO <span className={styles.badge}>Coming soon</span></h3><p>Keywords, rankings and Search Console reporting in plain English. These workflows are coming soon.</p></article>
            <article><h3>AI search visibility <span className={styles.badge}>Coming soon</span></h3><p>Citation reporting for AI answers is coming soon.</p></article>
            <article><h3>Content and social <span className={styles.badge}>Coming soon</span></h3><p>Turn useful research into drafts. You decide what to publish and where.</p></article>
          </div>
          <Link href="/tour" className={styles.secondary}>Explore the sample workspace →</Link>
        </section>

        <section aria-labelledby="sources-heading" className={styles.sources}>
          <h2 id="sources-heading">Context from the places your buyers talk</h2>
          <ul>{SOURCES.map((source) => <li key={source}>{source}</li>)}</ul>
        </section>

        <section id="how-it-works" aria-labelledby="how-heading" className={styles.section}>
          <div className={styles.sectionHeading}><p className={styles.eyebrow}>How it works</p><h2 id="how-heading">Three steps to your next move.</h2></div>
          <ol className={styles.steps}>
            {STEPS.map((step, i) => (
              <li key={step.title}><span className={styles.stepNumber}>{String(i + 1).padStart(2, "0")}</span><div><h3>{step.title}</h3><p>{step.body}</p></div></li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="scores-heading" className={styles.splitSection}>
          <div className={styles.sectionHeading}><p className={styles.eyebrow}>Evidence before outreach</p><h2 id="scores-heading">Know why it made the list.</h2><p>Every opportunity carries five scores and links to the posts behind it. Make your own call with the context in front of you.</p></div>
          <dl className={styles.definitionList}>{SCORES.map(([term, def]) => <div key={term}><dt>{term}</dt><dd>{def}</dd></div>)}</dl>
        </section>

        <section aria-labelledby="never-heading" className={styles.boundaries}>
          <div className={styles.sectionHeading}><p className={styles.eyebrow}>Built with boundaries</p><h2 id="never-heading">Your voice. Your judgment.</h2></div>
          <dl className={styles.boundaryList}>{NEVER.map(([term, def]) => <div key={term}><dt><span aria-hidden="true">—</span>{term}</dt><dd>{def}</dd></div>)}</dl>
        </section>

        {latest.length > 0 && (
          <section aria-labelledby="blog-heading" className={styles.section}>
            <div className={styles.sectionHeader}><h2 id="blog-heading">Notes from the field</h2><Link href="/blog">All posts <span aria-hidden="true">↗</span></Link></div>
            <ul className={styles.posts}>{latest.map((post) => <li key={post.slug}><time dateTime={post.date}>{formatDate(post.date)}</time><div><Link href={`/blog/${post.slug}`}>{post.title}<span aria-hidden="true">↗</span></Link><p>{post.description}</p></div></li>)}</ul>
          </section>
        )}

        <section id="faq" aria-labelledby="faq-heading" className={styles.splitSection}>
          <div className={styles.sectionHeading}><p className={styles.eyebrow}>A few details</p><h2 id="faq-heading">Questions, answered.</h2></div>
          <div className={styles.questions}>{FAQ.map(({ q, a }) => <details key={q}><summary>{q}<span aria-hidden="true">+</span></summary><p>{a}</p></details>)}</div>
        </section>

        <section className={styles.closing}>
          <div><h2>Ship it. Then let people know.</h2><p>The next move is yours.</p></div>
          {!session?.user && <Link href="/auth/sign-up" className={styles.primary}>Start free <span aria-hidden="true">↗</span></Link>}
        </section>
      </div>
    </Shell>
  );
}
