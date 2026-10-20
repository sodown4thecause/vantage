import Link from "next/link";

import { Glyph } from "@/components/glyph";
import { JsonLd } from "@/components/json-ld";
import { Shell } from "@/components/shell";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/server";
import { getCurrentWorkspace } from "@/lib/auth/workspace";
import { formatDate, getAllPosts } from "@/lib/blog";
import { createWorkspaceForCurrentUser } from "@/lib/db/actions";
import { getLatestMonitoringProfile } from "@/lib/profile/repository";
import { SITE_DESCRIPTION, SITE_NAME, SOURCES, absoluteUrl } from "@/lib/site";

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
    redirect(`/${profile ? "queue" : "onboarding"}?workspaceId=${encodeURIComponent(workspace.id)}`);
  }
  const example = { fit: 0.86, intent: 0.78, evidence: 0.64, momentum: 0.45, timing: 0.9 };
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
      <div className="relative isolate grid items-center gap-x-14 gap-y-12 lg:grid-cols-[1.15fr_1fr]">
        <div aria-hidden="true" className="aurora" />
        <section className="space-y-7">
          <p className="eyebrow">Social listening for developer tools</p>
          <h1 className="display text-5xl sm:text-6xl lg:text-7xl">
            Up to five conversations worth joining, every day.
          </h1>
          <p className="max-w-[48ch] text-lg leading-snug text-ridge">
            contextfor.dev reads Reddit, Hacker News, X and more for people
            asking for what you build. You get a short ranked list with the
            posts that prove it. You write the reply. It never posts for you.
          </p>
          {session?.user ? (
            <form action={startWorkspace} className="max-w-md space-y-3">
              <label htmlFor="workspace-name" className="block font-semibold">
                Name your workspace
              </label>
              <input
                id="workspace-name"
                name="name"
                required
                maxLength={100}
                autoComplete="organization"
                placeholder="Acme Analytics"
                className="w-full rounded-md border border-contour bg-sheet px-3.5 py-3"
              />
              <button className="btn">Create workspace</button>
            </form>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-3">
                <Link href="/auth/sign-up" className="btn btn-lg">
                  Create a free account
                </Link>
                <Link href="#how-it-works" className="btn btn-lg btn-quiet">
                  See how it works
                </Link>
              </div>
              <p className="text-sm text-ridge">
                Already have an account? <Link href="/auth/sign-in" className="link">Sign in</Link>
              </p>
            </div>
          )}
        </section>

        <aside aria-label="Example opportunity" className="panel space-y-5 p-6 sm:p-8">
          <div className="mx-auto w-full max-w-[22rem]">
            <Glyph features={example} size={352} labels animate />
          </div>
          <div className="space-y-2 border-t border-contour pt-4">
            <p className="eyebrow">Example opportunity</p>
            <p className="text-xl font-semibold leading-snug tracking-tight">
              Founder asks for a cheaper way to track brand mentions in AI answers
            </p>
            <p className="max-w-[52ch] text-ridge">
              Posted 3 hours ago in a thread with 40 replies. The scores show
              why it ranked: a strong fit with your product, a clear request,
              and good timing.
            </p>
          </div>
        </aside>
      </div>

      <section aria-labelledby="sources-heading" className="mt-20 border-y border-contour/60 py-7">
        <h2 id="sources-heading" className="eyebrow mb-4">
          Where it listens
        </h2>
        <ul className="flex flex-wrap gap-x-3 gap-y-2">
          {SOURCES.map((s) => (
            <li
              key={s}
              className="rounded-full border border-contour px-3.5 py-1.5 text-[0.9375rem] text-ridge transition-colors hover:border-ridge hover:text-ink"
            >
              {s}
            </li>
          ))}
        </ul>
      </section>

      <section id="how-it-works" aria-labelledby="how-heading" className="mt-20 scroll-mt-8">
        <h2 id="how-heading" className="display mb-10 text-3xl sm:text-4xl">
          How it works
        </h2>
        <ol className="hair-grid sm:grid-cols-3">
          {STEPS.map((step, i) => (
            <li key={step.title} className="hair-cell space-y-3">
              <span aria-hidden="true" className="block font-mono text-sm tracking-widest text-sage">
                {String(i + 1).padStart(2, "0")}
              </span>
              <h3 className="text-xl font-semibold leading-snug tracking-tight">{step.title}</h3>
              <p className="text-ridge">{step.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="scores-heading" className="mt-20 grid gap-x-12 gap-y-8 border-t border-contour/60 pt-10 sm:grid-cols-2">
        <div className="space-y-3">
          <h2 id="scores-heading" className="display text-3xl sm:text-4xl">What the five scores mean</h2>
          <p className="max-w-[40ch] text-ridge">
            Every opportunity carries all five, drawn as the shape you see above,
            so you can tell at a glance why it made the list.
          </p>
        </div>
        <dl className="space-y-4">
          {SCORES.map(([term, def]) => (
            <div key={term} className="grid grid-cols-[6.5rem_1fr] gap-4 border-b border-contour/60 pb-4 last:border-0">
              <dt className="font-medium">{term}</dt>
              <dd className="text-ridge">{def}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="never-heading" className="panel mt-20 px-6 py-10 sm:px-10">
        <p className="eyebrow mb-3">Boundaries</p>
        <h2 id="never-heading" className="display mb-8 text-3xl sm:text-4xl">
          What it will never do
        </h2>
        <dl className="grid gap-8 sm:grid-cols-3">
          {NEVER.map(([term, def]) => (
            <div key={term} className="space-y-2 border-l-2 border-signal pl-4">
              <dt className="text-lg font-medium leading-snug">{term}</dt>
              <dd className="text-ridge">{def}</dd>
            </div>
          ))}
        </dl>
      </section>

      {latest.length > 0 && (
        <section aria-labelledby="blog-heading" className="mt-20">
          <div className="mb-6 flex flex-wrap items-baseline justify-between gap-4">
            <h2 id="blog-heading" className="display text-3xl sm:text-4xl">From the blog</h2>
            <Link href="/blog" className="link font-semibold">All posts</Link>
          </div>
          <ul className="divide-y divide-contour/60 border-y border-contour/60">
            {latest.map((post) => (
              <li key={post.slug} className="grid gap-1 py-5 sm:grid-cols-[9rem_1fr] sm:gap-6">
                <time dateTime={post.date} className="text-sm text-ridge sm:pt-1">
                  {formatDate(post.date)}
                </time>
                <div className="space-y-1">
                  <Link href={`/blog/${post.slug}`} className="text-xl font-medium leading-snug tracking-tight transition-colors hover:text-signal">
                    {post.title}
                  </Link>
                  <p className="max-w-[64ch] text-ridge">{post.description}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section id="faq" aria-labelledby="faq-heading" className="mt-20 grid scroll-mt-8 gap-x-12 gap-y-6 sm:grid-cols-[1fr_1.6fr]">
        <h2 id="faq-heading" className="display text-3xl sm:text-4xl">Questions</h2>
        <div className="divide-y divide-contour/60 border-y border-contour/60">
          {FAQ.map(({ q, a }) => (
            <details key={q} className="faq group py-4">
              <summary className="flex cursor-pointer list-none items-start justify-between gap-4 text-lg font-medium leading-snug">
                {q}
                <span aria-hidden="true" className="faq-icon mt-1 text-signal">+</span>
              </summary>
              <p className="mt-3 max-w-[60ch] text-ridge">{a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="panel relative isolate mt-20 overflow-hidden px-6 py-14 text-center sm:px-10">
        <div aria-hidden="true" className="aurora" />
        <h2 className="display mx-auto max-w-[20ch] text-4xl sm:text-5xl">
          Tomorrow morning, five conversations worth your time.
        </h2>
        {!session?.user && (
          <Link href="/auth/sign-up" className="btn btn-lg mt-7">
            Create a free account
          </Link>
        )}
      </section>
    </Shell>
  );
}
