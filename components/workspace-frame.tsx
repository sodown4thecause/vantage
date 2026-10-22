import Link from "next/link";

import { Wordmark } from "@/components/wordmark";

import s from "./workspace-frame.module.css";

export type WorkspaceSection = "workspace" | "queue" | "seo" | "geo" | "content" | "sources" | "profile" | "plan" | "digest" | "review";

const TITLES: Record<WorkspaceSection, string> = {
  workspace: "GTM", queue: "Opportunities", seo: "SEO", geo: "GEO", content: "Content",
  sources: "Sources", profile: "Product profile", plan: "Plan & settings", digest: "Daily digest", review: "Review queue",
};

export function WorkspaceFrame({ children, title, subtitle = "Your growth workspace", workspaceId, active = "workspace", focused = false, wide = false, navigation, tools, setup, demo = false, seoEnabled = true }: {
  children: React.ReactNode;
  title?: string;
  subtitle?: string;
  workspaceId?: string;
  active?: WorkspaceSection;
  focused?: boolean;
  wide?: boolean;
  navigation?: React.ReactNode;
  tools?: React.ReactNode;
  setup?: React.ReactNode;
  demo?: boolean;
  seoEnabled?: boolean;
}) {
  const q = workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : "";
  // The product interview runs inside the workspace; /onboarding stays as a direct-URL fallback only.
  const setupHref = `/workspace${q}${q ? "&" : "?"}setup=1`;
  const tabs: { key: WorkspaceSection; label: string; icon: string; href: string }[] = [
    { key: "workspace", label: "GTM", icon: "◈", href: `/workspace${q}` },
    ...(seoEnabled ? [
      { key: "seo" as const, label: "SEO", icon: "⌕", href: `/seo${q}` },
      { key: "geo" as const, label: "GEO", icon: "◎", href: `/seo${q}${q ? "&" : "?"}focus=geo` },
    ] : []),
    { key: "content", label: "Content", icon: "▤", href: `/content${q}` },
  ];
  const links: { key: WorkspaceSection; label: string; href: string }[] = [
    { key: "queue", label: "Opportunities", href: `/queue${q}` },
    { key: "sources", label: "Sources", href: `/settings/sources${q}` },
    { key: "profile", label: "Product profile", href: setupHref },
    { key: "digest", label: "Daily digest", href: `/settings/digest${q}` },
  ];
  return <div className={s.frame}>
    <a href="#main" className="skip-link">Skip to content</a>
    <aside className={s.sidebar} aria-label="Workspace navigation">
      <Link href="/" className={s.brand} aria-label="contextfor.dev home"><Wordmark /></Link>
      <div className={s.primary}>
        <p className={s.label}>Your workspace</p>
        {navigation ?? <nav className={s.nav} aria-label="Workspace">{tabs.map((tab) => <Link key={tab.key} href={tab.href} aria-current={active === tab.key ? "page" : undefined}><span aria-hidden="true">{tab.icon}</span>{tab.label}</Link>)}</nav>}
      </div>
      <div className={s.tools}>
        <p className={s.label}>GTM tools</p>
        {tools ?? <nav className={s.nav} aria-label="GTM tools">{links.map((link) => <Link key={link.key} href={link.href} aria-current={active === link.key ? "page" : undefined}>{link.label}</Link>)}</nav>}
      </div>
      <div className={s.setup}>{setup ?? <section aria-label="Workspace next steps"><span className={s.spark} aria-hidden="true">✳</span><h2>Finish setting up</h2><p>Make your workspace work for you.</p><Link href={demo ? "/auth/sign-up" : setupHref}>Set up your product →</Link><Link href={demo ? "/auth/sign-up" : `/settings/sources${q}`}>Find your first leads →</Link><p className={s.pending}>Search Console and the blog workflow are coming next.</p></section>}</div>
      <div className={s.account}>{demo ? <><Link href="/auth/sign-up">Try it for yourself</Link><Link href="/">Home</Link></> : <><Link href={`/settings/plan${q}`} aria-current={active === "plan" ? "page" : undefined}>Plan & settings</Link><Link href="/auth/sign-out" prefetch={false}>Sign out</Link></>}</div>
    </aside>
    <main className={s.main} id="main">
      <header className={s.topbar}><div><strong>{title ?? TITLES[active]}</strong><span> / {subtitle}</span></div><span>{demo ? "Sample workspace" : "contextfor.dev"}</span></header>
      <div className={focused ? s.focused : `${s.page} ${wide ? s.wide : ""}`}>{children}</div>
    </main>
  </div>;
}
