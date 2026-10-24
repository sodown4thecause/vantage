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
import { SITE_DESCRIPTION, SITE_NAME, SOURCES, absoluteUrl } from "@/lib/site";

import styles from "./home.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { absolute: "Vantage: the go-to-market workspace for AI and developer tools" },
  description: "Find the conversations worth joining. Explore search research previews, with link building and content workflows coming soon. You write every reply; Vantage never posts for you.",
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
    title: "Pick from three next moves",
    body: "Choose a useful conversation, ask for context or save an idea in your workspace.",
  },
  {
    title: "Reply, publish or save",
    body: "You write every reply and publish it yourself. Vantage never posts, comments or votes on your behalf. In-app content publishing is coming soon.",
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
      name: SITE_NAME,
      url: absoluteUrl("/"),
    },
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      "@id": absoluteUrl("/#website"),
      name: SITE_NAME,
      url: absoluteUrl("/"),
      publisher: { "@id": absoluteUrl("/#organization") },
    },
    {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: SITE_NAME,
      url: absoluteUrl("/"),
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      description: SITE_DESCRIPTION,
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
            the conversations worth joining, shows where you rank in Google and AI
            answers <span className={styles.badge}>Preview</span>, and turns it into content <span className={styles.badge}>Coming soon</span>, so you don’t need five subscriptions to launch.
          </p>
          <p className={styles.claimNote}>Available now: conversation discovery and search research tools. <span className={styles.badge}>Preview</span> Ongoing Google rankings and AI citation tracking. <span className={styles.badge}>Coming soon</span> Content workflows.</p>
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
          <p className={styles.claimNote}>That’s the direction. Search reporting is a preview; link building and content workflows are coming soon.</p>
          <div className={styles.tiles}>
            <article><h3>Social listening</h3><p>Up to five ranked conversations a day. You write every reply; Vantage never posts.</p></article>
            <article><h3>SEO <span className={styles.badge}>Preview</span></h3><p>Keywords, rankings and backlinks research, in plain English. Connected Search Console and ongoing ranking reports are coming soon.</p></article>
            <article><h3>AI search visibility <span className={styles.badge}>Preview</span></h3><p>Research whether ChatGPT, Perplexity or Google AI cite you. Ongoing citation tracking is not live.</p></article>
            <article><h3>Link building <span className={styles.badge}>Coming soon</span></h3><p>A place to plan how people discover and link to your work.</p></article>
            <article><h3>Content and social <span className={styles.badge}>Coming soon</span></h3><p>Turn useful research into drafts. You decide what to publish and where.</p></article>
          </div>
          <Link href="/tour" className={styles.secondary}>Explore the sample workspace →</Link>
        </section>

        <figure className={styles.preview} aria-labelledby="preview-caption">
          <figcaption id="preview-caption" className={styles.previewCaption}>
            <span><span className={styles.statusDot} />A look inside your workspace</span>
            <span>Static preview · sample data</span>
          </figcaption>
          <div className={styles.previewBody}>
            <div className={styles.previewSidebar} aria-hidden="true">
              <div className={styles.previewBrand}>c<span>contextfor.dev</span></div>
              <p>Acme workspace</p>
              <div className={styles.selectedNav}>◈ <span>GTM workspace</span></div>
              <div>☷ <span>Queue</span><small>3</small></div>
              <div>⌁ <span>Sources</span></div>
              <div>◎ <span>Profile</span></div>
              <div className={styles.sidebarBottom}><span className={styles.avatar}>A</span>Acme Analytics</div>
            </div>
            <div className={styles.previewMain}>
              <div className={styles.previewTopbar}><span>GTM workspace</span><span>Acme Analytics</span></div>
              <div className={styles.previewColumns}>
                <div className={styles.previewConversation}>
                  <div className={styles.previewAnswer}>
                    <span className={styles.assistantMark} aria-hidden="true">c</span>
                    <p className={styles.responseLabel}>Your next move</p>
                    <h2>Start with a useful conversation.</h2>
                    <p>There’s a founder looking for a simpler way to track brand mentions. The problem fits your product, and the thread is still active.</p>
                    <p className={styles.actionLabel}>Three ways forward</p>
                    <ol className={styles.nextActions}>
                      <li><span>01</span><div>Review the conversation<small>Read the source and check the fit.</small></div><span aria-hidden="true">↗</span></li>
                      <li><span>02</span><div>Find the right angle<small>Lead with an answer, not a pitch.</small></div><span aria-hidden="true">→</span></li>
                      <li><span>03</span><div>Keep your queue focused<small>Review the next relevant conversation.</small></div><span aria-hidden="true">→</span></li>
                    </ol>
                  </div>
                  <div className={styles.composer}>
                    <span>Ask about your next move…</span>
                    <div><small>Sample workspace · not interactive</small><span aria-hidden="true">↑</span></div>
                  </div>
                  <p className={styles.previewDisclaimer}>You decide what to say. Nothing is posted for you.</p>
                </div>
                <aside className={styles.evidence} aria-label="Illustrative source evidence">
                  <p className={styles.actionLabel}>The context</p>
                  <div className={styles.evidenceHeading}><span className={styles.sourceIcon}>r</span><div>Reddit<small>Illustrative forum conversation</small></div></div>
                  <h3>Looking for a simpler way to track mentions</h3>
                  <blockquote>“How are other small teams keeping track of where people mention their product? I’m trying to move beyond checking everything manually.”</blockquote>
                  <div className={styles.evidenceSignal}><span>Product fit</span><strong>Strong</strong></div>
                  <div className={styles.evidenceSignal}><span>Intent</span><strong>Asking for a solution</strong></div>
                  <p className={styles.evidenceNote}>An illustrative example, not a live lead or a customer quote.</p>
                </aside>
              </div>
            </div>
          </div>
        </figure>

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
