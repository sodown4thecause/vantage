import Link from "next/link";

import { Wordmark } from "@/components/wordmark";
import { dataForSeoAvailable } from "@/lib/dataforseo/config";
import { seoModels } from "@/lib/seo-agent/model-config";
import { WorkspaceFrame, type WorkspaceSection } from "@/components/workspace-frame";

import s from "./shell.module.css";

type NavKey = WorkspaceSection;
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
}: {
  children: React.ReactNode;
  workspaceId?: string;
  active?: NavKey;
  /** Highlights a public nav item on marketing pages. */
  section?: PublicKey;
  wide?: boolean;
}) {
  if (workspaceId) return <WorkspaceFrame workspaceId={workspaceId} active={active} wide={wide} seoEnabled={dataForSeoAvailable() && seoModels() !== null}>{children}</WorkspaceFrame>;

  return (
    <div className={s.site}>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <header className={s.header}>
        <div className={s.headerInner}>
          <Link href="/" aria-label="contextfor.dev home">
            <Wordmark />
          </Link>
            <nav aria-label="Site" className={s.nav}>
              {PUBLIC_NAV.map((n) => (
                <Link
                  key={n.key}
                  href={n.href}
                  aria-current={section === n.key ? "page" : undefined}
                >
                  {n.label}
                </Link>
              ))}
              <Link href="/auth/sign-in">
                Sign in
              </Link>
              <Link href="/auth/sign-up" className="btn">
                Get started →
              </Link>
            </nav>
        </div>
      </header>
      <main id="main" className={`${s.content} ${wide ? s.wide : ""}`}>
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}

function SiteFooter() {
  return (
    <footer className={s.footer}>
      <div className={s.footerInner}>
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
    <div className={s.pageHead}>
      <h1>{title}</h1>
      {lede && <p>{lede}</p>}
    </div>
  );
}
