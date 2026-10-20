import Link from "next/link";

import { Wordmark } from "@/components/wordmark";
import { dataForSeoAvailable } from "@/lib/dataforseo/config";
import { seoModels } from "@/lib/seo-agent/model-config";

type NavKey = "queue" | "seo" | "sources" | "profile" | "plan" | "digest";
type PublicKey = "how" | "tour" | "pricing" | "blog" | "launch";

const PUBLIC_NAV: { key: PublicKey; label: string; href: string }[] = [
  { key: "how", label: "How it works", href: "/#how-it-works" },
  { key: "tour", label: "Tour", href: "/tour" },
  { key: "pricing", label: "Pricing", href: "/pricing" },
  { key: "blog", label: "Blog", href: "/blog" },
  { key: "launch", label: "Launch catalog", href: "/launch" },
];

export function Shell({
  children,
  workspaceId,
  active,
  section,
  wide = false,
  signedIn = false,
}: {
  children: React.ReactNode;
  workspaceId?: string;
  active?: NavKey;
  /** Highlights a public nav item on marketing pages. */
  section?: PublicKey;
  wide?: boolean;
  signedIn?: boolean;
}) {
  const q = workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : "";
  // Read per render, never at module scope: the SEO item appears only once DataForSEO can serve lookups and the agent
  // has its gateway key.
  const seo: { key: NavKey; label: string; href: string }[] = dataForSeoAvailable() && seoModels() !== null
    ? [{ key: "seo", label: "SEO", href: `/seo${q}` }]
    : [];
  const nav: { key: NavKey; label: string; href: string }[] = [
    { key: "queue", label: "Queue", href: `/queue${q}` },
    ...seo,
    { key: "sources", label: "Sources", href: `/settings/sources${q}` },
    { key: "profile", label: "Profile", href: `/onboarding${q}` },
    { key: "plan", label: "Plan", href: `/settings/plan${q}` },
    { key: "digest", label: "Digest", href: `/settings/digest${q}` },
  ];

  return (
    <div className="flex min-h-screen flex-1 flex-col">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      {/* Sticky only where the nav fits on one row: a wrapped header would eat
          a phone's viewport and hide anchored headings. */}
      <header className="relative z-10 border-b border-contour/60 bg-paper/85 backdrop-blur-md lg:sticky lg:top-0">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-x-8 gap-y-2 px-5 py-3 sm:px-8">
          <Link href="/" aria-label="contextfor.dev home">
            <Wordmark />
          </Link>
          {workspaceId ? (
            <nav aria-label="Workspace" className="-mx-3 flex flex-wrap gap-1 text-[0.9375rem]">
              {nav.map((n) => (
                <Link
                  key={n.key}
                  href={n.href}
                  aria-current={active === n.key ? "page" : undefined}
                  className={
                    "rounded px-3 py-1.5 font-medium transition-colors " +
                    (active === n.key ? "bg-ink text-paper" : "text-ridge hover:text-ink")
                  }
                >
                  {n.label}
                </Link>
              ))}
              {/* Never prefetched: loading the sign-out view ends the session. */}
              <Link href="/auth/sign-out" prefetch={false} className="rounded px-3 py-1.5 font-medium text-ridge transition-colors hover:text-ink">
                Sign out
              </Link>
            </nav>
          ) : (
            <nav aria-label="Site" className="-mx-3 flex flex-wrap items-center gap-1 text-[0.9375rem]">
              {PUBLIC_NAV.map((n) => (
                <Link
                  key={n.key}
                  href={n.href}
                  aria-current={section === n.key ? "page" : undefined}
                  className={
                    "rounded px-3 py-1.5 font-medium transition-colors " +
                    (section === n.key ? "text-ink underline decoration-signal decoration-2 underline-offset-[6px]" : "text-ridge hover:text-ink")
                  }
                >
                  {n.label}
                </Link>
              ))}
              {signedIn ? (
                <Link href="/auth/sign-out" prefetch={false} className="rounded px-3 py-1.5 font-medium text-ridge hover:text-ink">Sign out</Link>
              ) : (
                <>
                  <Link href="/auth/sign-in" className="rounded px-3 py-1.5 font-medium text-ridge hover:text-ink">
                    Sign in
                  </Link>
                  <Link href="/auth/sign-up" className="btn ml-1">
                    Create a free account
                  </Link>
                </>
              )}
            </nav>
          )}
        </div>
      </header>
      <main id="main" className={`mx-auto w-full flex-1 px-5 py-10 sm:px-8 sm:py-14 ${wide ? "max-w-6xl" : "max-w-3xl"}`}>
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}

function SiteFooter() {
  return (
    <footer className="border-t border-contour/60">
      <div className="mx-auto grid w-full max-w-6xl gap-8 px-5 py-10 text-[0.9375rem] sm:grid-cols-[1.4fr_1fr_1fr] sm:px-8">
        <div className="space-y-2">
          <Wordmark />
          <p className="max-w-[36ch] text-ridge">
            Conversations worth joining, with the posts that prove it. You write every reply.
          </p>
        </div>
        <nav aria-label="Product" className="space-y-2">
          <p className="font-semibold">Product</p>
          <ul className="space-y-1.5 text-ridge">
            <li><Link className="hover:text-ink" href="/#how-it-works">How it works</Link></li>
            <li><Link className="hover:text-ink" href="/#faq">Questions</Link></li>
            <li><Link className="hover:text-ink" href="/auth/sign-up">Create a free account</Link></li>
          </ul>
        </nav>
        <nav aria-label="Resources" className="space-y-2">
          <p className="font-semibold">Resources</p>
          <ul className="space-y-1.5 text-ridge">
            <li><Link className="hover:text-ink" href="/blog">Blog</Link></li>
            <li><a className="hover:text-ink" href="/blog/rss.xml">RSS feed</a></li>
            <li><Link className="hover:text-ink" href="/launch">Where to launch a developer tool</Link></li>
          </ul>
        </nav>
      </div>
    </footer>
  );
}

export function PageHead({ title, lede }: { title: string; lede?: string }) {
  return (
    <div className="mb-8 space-y-3">
      <h1 className="display text-4xl sm:text-5xl lg:text-[3.25rem]">{title}</h1>
      {lede && <p className="max-w-[56ch] text-lg leading-snug text-ridge">{lede}</p>}
    </div>
  );
}
