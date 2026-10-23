import Link from "next/link";

import { JsonLd } from "@/components/json-ld";
import { Shell } from "@/components/shell";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/server";
import { getCurrentWorkspace } from "@/lib/auth/workspace";
import { formatDate, getAllPosts } from "@/lib/blog";
import { createWorkspaceForCurrentUser } from "@/lib/db/actions";
import { getLatestMonitoringProfile } from "@/lib/profile/repository";
import { SITE_DESCRIPTION, SITE_NAME, SOURCES, absoluteUrl } from "@/lib/site";

import styles from "./home.module.css";

export const dynamic = "force-dynamic";

async function startWorkspace(form: FormData) {
  "use server";
  const workspace = await createWorkspaceForCurrentUser(String(form.get("name") ?? ""));
  if (!workspace) throw new Error("Workspace could not be created.");
  redirect(`/onboarding?workspaceId=${encodeURIComponent(workspace.id)}`);
}

const STEPS: { title: string; body: string }[] = [
  {
    title: "Describe your product once",
    body: "Paste your URL or a few lines about what you build and who it is for. That profile drives every ranking.",
  },
  {
    title: "It reads the places your buyers talk",
    body: "Collectors check each source on a schedule, drop duplicates and score every conversation for fit, intent, evidence, momentum and timing.",
  },
  {
    title: "You get a short list, and you reply",
    body: "Up to five conversations a day, in your queue and in an email at the hour you choose. Each one links to the posts that justify it. You write the reply.",
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
    q: "Does contextfor.dev post replies for me?",
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
    a: "Yes. Create a free account to set up a workspace, connect sources and get your daily list. Paid plans with more sources and faster scans are on the way.",
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
          <p className={styles.eyebrow}>Your go-to-market workspace</p>
          <h1 id="home-heading">Find the conversations<br />worth showing up for.</h1>
          <p className={styles.intro}>
            A quieter way to find your next customers. contextfor.dev reads the
            places they talk and brings you up to five relevant conversations a day,
            with the evidence behind each one. You write every reply.
          </p>
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
                <Link href="/auth/sign-up" className={styles.primary}>Create a free account <span aria-hidden="true">↗</span></Link>
                <Link href="/tour" className={styles.secondary}>Explore the workspace <span aria-hidden="true">→</span></Link>
              </div>
              <p className={styles.signIn}>Already have an account? <Link href="/auth/sign-in">Sign in</Link></p>
            </>
          )}
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
          <div className={styles.sectionHeading}><p className={styles.eyebrow}>A focused daily workflow</p><h2 id="how-heading">Less searching. More context.</h2></div>
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
          <div><p className={styles.eyebrow}>Start with the right context</p><h2>Your next conversation is a better place to start.</h2><p>A short list. The evidence behind it. The reply is yours.</p></div>
          {!session?.user && <Link href="/auth/sign-up" className={styles.primary}>Create a free account <span aria-hidden="true">↗</span></Link>}
        </section>
      </div>
    </Shell>
  );
}
